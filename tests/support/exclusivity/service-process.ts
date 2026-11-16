import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

import { openSqliteDatabase, type SqliteDatabase } from '../../../packages/database/src/index';
import { createUser } from '../../../packages/shared-types/src/index';
import { createLocalService, LocalServiceStartupError } from '../../../services/local-api/src/local-service';
import { createJsonLogger } from '../../../services/local-api/src/logger';

/*
 * Processo de ensaio E1.07-X: compõe o serviço local real sobre uma base temporária e responde a
 * comandos por stdin (uma palavra por linha). Escreve em stdout os registos JSON do serviço e
 * eventos `{"probe": ...}` do ensaio. Só dados fictícios; o token de sessão nunca sai do processo.
 */
export interface ServiceProcessOptions {
  readonly databasePath: string;
  readonly instanceId: string;
  readonly lockTimeoutMs?: number;
  readonly onMissingDatabase: 'create' | 'fail';
  readonly onPendingMigrations: 'apply' | 'fail';
}

const options = JSON.parse(process.env['KIL_EXCLUSIVITY_CHILD'] ?? '{}') as ServiceProcessOptions;
const emit = (event: Readonly<Record<string, unknown>>): void => {
  process.stdout.write(`${JSON.stringify(event)}\n`);
};

const PASSWORD = 'frase fictícia do ensaio de exclusividade';
let connection: SqliteDatabase | undefined;
const service = createLocalService(
  {
    databasePath: options.databasePath,
    environment: 'test',
    instanceId: options.instanceId,
    logLevel: 'info',
    startupPolicy: { onMissingDatabase: options.onMissingDatabase, onPendingMigrations: options.onPendingMigrations },
  },
  {
    ...(options.lockTimeoutMs === undefined ? {} : { databaseLockTimeoutMs: options.lockTimeoutMs }),
    logger: createJsonLogger({ instanceId: options.instanceId, level: 'info', sink: (line) => process.stdout.write(`${line}\n`) }),
    openDatabase: (openOptions) => {
      connection = openSqliteDatabase(openOptions);
      return connection;
    },
    passwordHashing: { parameters: { memoryKiB: 19456, parallelism: 1, passes: 2 } },
    protectedDirectories: [],
  },
);

const start = async (): Promise<boolean> => {
  const started = performance.now();
  try {
    await service.start();
    emit({ probe: 'ready', startMs: Math.round(performance.now() - started), state: service.state });
    return true;
  } catch (error) {
    emit({
      probe: 'failed',
      reason: error instanceof LocalServiceStartupError ? error.reason : 'not-a-startup-error',
      startMs: Math.round(performance.now() - started),
      state: service.state,
    });
    return false;
  }
};

let token: string | undefined;
let sessionId: string | undefined;

const handlers: Readonly<Record<string, () => Promise<void>>> = {
  provision: async () => {
    const user = createUser({
      createdAt: new Date().toISOString(),
      displayName: 'Identidade Fictícia',
      email: 'ensaio@kil-business.test',
      id: randomUUID(),
      phone: '+000 900 000 000',
      status: 'ACTIVE',
      username: `ensaio.${randomUUID().slice(0, 8)}`,
    });
    await service.identityProvisioning.users.create(user);
    await service.identityProvisioning.credentials.create(user.id, PASSWORD);
    const authenticated = await service.authentication.authenticate(user.username, PASSWORD);
    if (!authenticated.ok) throw new Error('Autenticação esperada.');
    const created = await service.sessions.create(authenticated.identity);
    if (!created.ok) throw new Error('Sessão esperada.');
    token = created.session.token;
    sessionId = created.session.sessionId;
    emit({ probe: 'provisioned', sessionId, userId: user.id });
  },
  validate: async () => {
    const result = await service.sessions.validate(token ?? '');
    emit({ ok: result.ok, probe: 'validated', reason: result.ok ? null : result.reason });
  },
  snapshot: () => {
    const database = connection;
    if (database === undefined || !database.open) throw new Error('Sem ligação.');
    emit({
      credentials: database.prepare('SELECT user_id, credential_version FROM password_credentials ORDER BY user_id').all(),
      integrity: database.pragma('integrity_check', { simple: true }),
      migrations: database.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all(),
      probe: 'snapshot',
      sessions: database.prepare('SELECT id, revoked_at, revocation_reason FROM local_sessions ORDER BY id').all(),
      users: database.prepare('SELECT id, security_version FROM users ORDER BY id').all(),
    });
    return Promise.resolve();
  },
  resources: () => {
    emit({ active: process.getActiveResourcesInfo(), probe: 'resources' });
    return Promise.resolve();
  },
  restart: async () => {
    await service.stop();
    await start();
  },
  stop: async () => {
    await service.stop();
    emit({ probe: 'stopped', state: service.state });
    process.exit(0);
  },
  crash: () => {
    // Falha inesperada: excepção não tratada, sem `stop()`.
    setImmediate(() => {
      throw new Error('Falha simulada do ensaio.');
    });
    return Promise.resolve();
  },
};

if (!(await start())) {
  await service.stop();
  process.exit(1);
}

for await (const line of createInterface({ input: process.stdin })) {
  const handler = handlers[line.trim()];
  if (handler === undefined) continue;
  try {
    await handler();
  } catch (error) {
    emit({ error: error instanceof Error ? error.name : 'unknown', probe: 'command-failed' });
  }
}
