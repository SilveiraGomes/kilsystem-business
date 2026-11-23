import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MIGRATIONS, openSqliteDatabase, type OpenSqliteOptions, type SqliteDatabase } from '../packages/database/src/index';
import { createBranch } from '../packages/shared-types/src/index';
import { LOCAL_SERVICE_EXIT_CODES, runLocalServiceCli } from '../services/local-api/src/cli';
import {
  LOCAL_SERVICE_ENV,
  loadLocalServiceConfigFromEnv,
  LocalServiceConfigError,
  parseLocalServiceConfig,
} from '../services/local-api/src/config';
import {
  createLocalService,
  LOCAL_SERVICE_TRANSITIONS,
  LocalServiceStartupError,
  LocalServiceStateError,
  LocalServiceStopError,
  type LocalService,
  type LocalServiceState,
} from '../services/local-api/src/local-service';
import { createJsonLogger } from '../services/local-api/src/logger';
import { resolveProtectedDirectories } from '../services/local-api/src/protected-directories';
import { branchInput, contextFor, newCompany } from './support/fixtures';
import {
  createServiceUnderTest,
  PROTECTED_DIRECTORIES,
  REPOSITORY_ROOT,
  serviceConfig,
  type ServiceUnderTest,
} from './support/local-service-harness';
import { createTemporaryDatabase, type TemporaryDatabase } from './support/sqlite-harness';

// Derivados da lista de migrações (E1.07-A acrescentou a versão 2).
const ALL_VERSIONS = MIGRATIONS.map((migration) => migration.version);
const LATEST_VERSION = MIGRATIONS.length;

const deferred = ():{ readonly promise: Promise<void>; readonly resolve: () => void } => {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const captureConfigError = (action: () => unknown): LocalServiceConfigError => {
  try {
    action();
  } catch (error) {
    if (error instanceof LocalServiceConfigError) return error;
    throw error;
  }
  throw new Error('Era esperada uma LocalServiceConfigError.');
};

const stateChanges = (harness: ServiceUnderTest): readonly string[] =>
  harness
    .records()
    .filter((record) => record['event'] === 'service.state_changed')
    .map((record) => `${String(record['from'])}->${String(record['to'])}`);

const expectNotReady = async (service: LocalService, state: LocalServiceState): Promise<void> => {
  const context = contextFor(newCompany().tenantId);
  await expect(service.companies.findById(context, newCompany().id)).rejects.toMatchObject({
    name: 'LocalServiceStateError',
    reason: 'not-ready',
    state,
  });
  await expect(service.branches.listByCompany(context, newCompany().id)).rejects.toBeInstanceOf(
    LocalServiceStateError,
  );
  await expect(service.companies.create(context, newCompany())).rejects.toBeInstanceOf(LocalServiceStateError);
  expect(() => service.transaction(() => undefined)).toThrow(LocalServiceStateError);
};

const countMigrations = (filename: string): number => {
  const connection = openSqliteDatabase({ filename, fileMustExist: true });
  try {
    return connection.prepare('SELECT count(*) FROM schema_migrations').pluck().get() as number;
  } finally {
    connection.close();
  }
};

const env = (databasePath: string, overrides: Readonly<Record<string, string | undefined>> = {}) => ({
  [LOCAL_SERVICE_ENV.databasePath]: databasePath,
  [LOCAL_SERVICE_ENV.environment]: 'test',
  [LOCAL_SERVICE_ENV.instanceId]: 'cli-test',
  [LOCAL_SERVICE_ENV.logLevel]: 'info',
  [LOCAL_SERVICE_ENV.onMissingDatabase]: 'create',
  [LOCAL_SERVICE_ENV.onPendingMigrations]: 'apply',
  ...overrides,
});

describe('Local service lifecycle (E1.05)', () => {
  let temporary: TemporaryDatabase;
  const running: LocalService[] = [];

  const track = (harness: ServiceUnderTest): ServiceUnderTest => {
    running.push(harness.service);
    return harness;
  };

  const newService = (overrides: Readonly<Record<string, unknown>> = {}): ServiceUnderTest =>
    track(createServiceUnderTest(serviceConfig(temporary.filename, overrides)));

  beforeEach(() => {
    temporary = createTemporaryDatabase();
  });

  afterEach(async () => {
    for (const service of running.splice(0)) await service.stop();
    // Em Windows, `rmSync` falha se alguma ligação ao ficheiro tiver ficado aberta.
    temporary.dispose();
  });

  describe('state machine', () => {
    it('documents the allowed transitions', () => {
      expect(LOCAL_SERVICE_TRANSITIONS).toEqual({
        FAILED: ['STARTING', 'STOPPED'],
        READY: ['STOPPING'],
        STARTING: ['READY', 'FAILED'],
        STOPPED: ['STARTING'],
        STOPPING: ['STOPPED', 'FAILED'],
      });
    });

    it('starts with a valid configuration and records every transition', async () => {
      const harness = newService();

      expect(harness.service.state).toBe('STOPPED');
      await harness.service.start();
      expect(harness.service.state).toBe('READY');
      await harness.service.stop();

      expect(harness.service.state).toBe('STOPPED');
      expect(stateChanges(harness)).toEqual([
        'STOPPED->STARTING',
        'STARTING->READY',
        'READY->STOPPING',
        'STOPPING->STOPPED',
      ]);
      for (const record of harness.records()) {
        expect(record).toMatchObject({ instanceId: 'test-instance' });
        expect(typeof record['time']).toBe('string');
      }
    });
  });

  describe('startup', () => {
    it('opens SQLite with foreign keys and applies the versioned migrations', async () => {
      const harness = newService();

      await harness.service.start();

      expect(existsSync(temporary.filename)).toBe(true);
      expect(harness.service.startupReport).toEqual({
        appliedMigrations: ALL_VERSIONS,
        createdDatabase: true,
        schemaVersion: LATEST_VERSION,
      });
      const [connection] = harness.connections;
      expect(connection?.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(connection?.prepare('SELECT version FROM schema_migrations').pluck().all()).toEqual(ALL_VERSIONS);
    });

    it('opens a single connection when start is called repeatedly', async () => {
      const harness = newService();

      await Promise.all([harness.service.start(), harness.service.start()]);
      await harness.service.start();

      expect(harness.service.state).toBe('READY');
      expect(harness.connections).toHaveLength(1);
      expect(stateChanges(harness)).toEqual(['STOPPED->STARTING', 'STARTING->READY']);
    });

    it('shares an in-flight start and waits for it before stopping', async () => {
      const gate = deferred();
      const harness = track(
        createServiceUnderTest(serviceConfig(temporary.filename), async (options: OpenSqliteOptions) => {
          await gate.promise;
          return openSqliteDatabase(options);
        }),
      );

      const first = harness.service.start();
      const second = harness.service.start();
      expect(harness.service.state).toBe('STARTING');
      await expectNotReady(harness.service, 'STARTING');
      const stopping = harness.service.stop();
      gate.resolve();
      await Promise.all([first, second, stopping]);

      expect(harness.service.state).toBe('STOPPED');
      expect(harness.connections).toHaveLength(1);
      expect(harness.connections[0]?.open).toBe(false);
    });

    it('applies each migration only once across restarts', async () => {
      const harness = newService();
      await harness.service.start();
      await harness.service.stop();
      await harness.service.start();

      expect(harness.service.startupReport).toEqual({
        appliedMigrations: [],
        createdDatabase: false,
        schemaVersion: LATEST_VERSION,
      });
      await harness.service.stop();
      const strict = newService({ startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'fail' } });
      await strict.service.start();
      await strict.service.stop();

      expect(countMigrations(temporary.filename)).toBe(MIGRATIONS.length);
    });
  });

  describe('shutdown', () => {
    it('is idempotent and closes the connection', async () => {
      const harness = newService();
      await harness.service.start();

      await Promise.all([harness.service.stop(), harness.service.stop()]);
      await harness.service.stop();

      expect(harness.service.state).toBe('STOPPED');
      expect(harness.connections.every((connection) => !connection.open)).toBe(true);
      expect(harness.records().filter((record) => record['event'] === 'service.stopped')).toHaveLength(1);
      expect(existsSync(`${temporary.filename}-wal`)).toBe(false);
    });

    it('is a no-op before the first start', async () => {
      const harness = newService();

      await harness.service.stop();

      expect(harness.service.state).toBe('STOPPED');
      expect(harness.connections).toHaveLength(0);
    });
  });

  describe('release independent of the log (E1.07-D3-R1-C3, RV-C2M-01/03)', () => {
    /**
     * Serviço cujo registo lança nas linhas escolhidas. Fica fora de `running`: o `stop()` destes
     * serviços pode rejeitar de propósito, e cada teste termina-os ele próprio.
     */
    const faultyService = (
      failLine: (line: string) => boolean,
      open: (options: OpenSqliteOptions) => SqliteDatabase = openSqliteDatabase,
      overrides: Readonly<Record<string, unknown>> = {},
    ) => {
      const lines: string[] = [];
      const connections: SqliteDatabase[] = [];
      const service = createLocalService(serviceConfig(temporary.filename, overrides), {
        logger: createJsonLogger({
          instanceId: 'release-test',
          level: 'debug',
          sink: (line) => {
            if (failLine(line)) throw new Error('registo indisponível');
            lines.push(line);
          },
        }),
        openDatabase: (options) => {
          const connection = open(options);
          connections.push(connection);
          return connection;
        },
        protectedDirectories: PROTECTED_DIRECTORIES,
      });
      return { connections, events: () => lines.map((line) => (JSON.parse(line) as { event: string }).event), service };
    };

    /** Uma ligação nova obtém de imediato a posse exclusiva da base (sem espera): ninguém a detém. */
    const reopensExclusively = (): boolean => {
      try {
        openSqliteDatabase({ busyTimeoutMs: 0, exclusive: true, fileMustExist: true, filename: temporary.filename }).close();
        return true;
      } catch {
        return false;
      }
    };

    const rejection = (promise: Promise<void>): Promise<unknown> => promise.then(() => undefined, (error: unknown) => error);

    it.each([
      ['before the release (transition to STOPPING)', '"to":"STOPPING"'],
      ['after the release (transition to STOPPED)', '"to":"STOPPED"'],
      ['after the release (service.stopped)', '"service.stopped"'],
    ])('[L-C3-01] a failing record %s never keeps the database: STOPPED, closed, record-failed', async (_name, marker) => {
      const { connections, service } = faultyService((line) => line.includes(marker));
      await service.start();
      expect(reopensExclusively()).toBe(false);

      const failure = await rejection(service.stop());

      expect(failure).toBeInstanceOf(LocalServiceStopError);
      expect(failure).toMatchObject({ name: 'LocalServiceStopError', reason: 'record-failed' });
      expect((failure as LocalServiceStopError).causes).toHaveLength(1);
      expect(service.state).toBe('STOPPED');
      expect(connections.map((connection) => connection.open)).toEqual([false]);
      expect(reopensExclusively()).toBe(true);
      await expectNotReady(service, 'STOPPED');
      // Idempotente depois da falha, e a mesma instância volta a arrancar e a parar.
      await service.stop();
      await service.start();
      expect(service.state).toBe('READY');
      await rejection(service.stop());
      expect(service.state).toBe('STOPPED');
      expect(reopensExclusively()).toBe(true);
    });

    it('[L-C3-02] a close that throws without closing is release-failed and FAILED, distinct from a released database', async () => {
      const realCloses: (() => void)[] = [];
      const { events, service } = faultyService(
        () => false,
        (options) => {
          const connection = openSqliteDatabase(options);
          const close = connection.close.bind(connection);
          realCloses.push(() => {
            close();
          });
          return Object.assign(connection, {
            close: () => {
              throw new Error('falha ao fechar');
            },
          });
        },
      );
      await service.start();

      const failure = await rejection(service.stop());

      expect(failure).toMatchObject({ name: 'LocalServiceStopError', reason: 'release-failed' });
      expect(service.state).toBe('FAILED');
      expect(events().slice(-2)).toEqual(['service.state_changed', 'service.stop_failed']);
      // O serviço não finge ter libertado a base: ela continua detida pela ligação que não fechou.
      expect(reopensExclusively()).toBe(false);
      await service.stop();
      expect(service.state).toBe('STOPPED');
      for (const close of realCloses) close();
      expect(reopensExclusively()).toBe(true);
    });

    it('[L-C3-03] a failing record on the startup failure path still releases, reaches FAILED and reports the startup failure', async () => {
      // Base vazia, sem migrações, com a política `fail`: o arranque obtém a posse e só depois falha.
      openSqliteDatabase({ filename: temporary.filename }).close();
      const strict = { startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'fail' } };
      const cases: readonly (readonly [string, string, string, number])[] = [
        ['service.starting', '"service.starting"', 'unexpected', 0],
        ['transition to FAILED', '"to":"FAILED"', 'pending-migrations', 1],
        ['service.start_failed', '"service.start_failed"', 'pending-migrations', 1],
      ];
      for (const [name, marker, reason, opened] of cases) {
        const { connections, service } = faultyService((line) => line.includes(marker), openSqliteDatabase, strict);

        await expect(service.start(), name).rejects.toMatchObject({ name: 'LocalServiceStartupError', reason });
        expect(service.state, name).toBe('FAILED');
        expect(connections.map((connection) => connection.open), name).toEqual(Array.from({ length: opened }, () => false));
        expect(reopensExclusively(), name).toBe(true);
        await service.stop();
        expect(service.state, name).toBe('STOPPED');
      }
    });
  });

  describe('startup failures', () => {
    const tamperChecksum = (filename: string): void => {
      const connection = openSqliteDatabase({ filename });
      connection.prepare("UPDATE schema_migrations SET checksum = 'alterado'").run();
      connection.close();
    };

    const createEmptyDatabase = (filename: string): void => {
      openSqliteDatabase({ filename }).close();
    };

    it('fails without creating a file when the database is missing and the policy forbids it', async () => {
      const harness = newService({ startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'apply' } });

      await expect(harness.service.start()).rejects.toMatchObject({ reason: 'database-missing' });

      expect(harness.service.state).toBe('FAILED');
      expect(harness.service.lastFailure).toBe('database-missing');
      expect(harness.connections).toHaveLength(0);
      expect(existsSync(temporary.filename)).toBe(false);
    });

    it.each([
      ['migration-integrity', (filename: string) => {
        const setup = openSqliteDatabase({ filename });
        setup.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT, checksum TEXT, applied_at TEXT); INSERT INTO schema_migrations VALUES (1, 'x', 'alterado', 'agora')");
        setup.close();
      }],
      ['pending-migrations', createEmptyDatabase],
    ] as const)('fails with %s and leaves no open connection', async (reason, prepare) => {
      prepare(temporary.filename);
      const harness = newService({ startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'fail' } });

      await expect(harness.service.start()).rejects.toMatchObject({ name: 'LocalServiceStartupError', reason });

      expect(harness.service.state).toBe('FAILED');
      expect(harness.connections).toHaveLength(1);
      expect(harness.connections.every((connection) => !connection.open)).toBe(true);
      expect(existsSync(`${temporary.filename}-wal`)).toBe(false);
      expect(() => rmSync(temporary.filename)).not.toThrow();
    });

    it('fails with migration integrity on a tampered database and closes the connection', async () => {
      const setup = newService();
      await setup.service.start();
      await setup.service.stop();
      tamperChecksum(temporary.filename);
      const harness = newService();

      const failure = await harness.service.start().catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(LocalServiceStartupError);
      expect(failure).toMatchObject({ reason: 'migration-integrity' });
      expect(harness.connections.every((connection) => !connection.open)).toBe(true);
      expect(harness.records()).toContainEqual(
        expect.objectContaining({
          causeReason: 'migration-checksum-mismatch',
          event: 'service.start_failed',
          reason: 'migration-integrity',
        }),
      );
    });

    it('reports a failure to open the database', async () => {
      const harness = track(
        createServiceUnderTest(serviceConfig(temporary.filename), () => {
          throw new Error('falha simulada na abertura');
        }),
      );

      await expect(harness.service.start()).rejects.toMatchObject({ reason: 'database-open-failed' });
      expect(harness.service.state).toBe('FAILED');
    });

    it('does not create missing directories', async () => {
      const nested = path.join(temporary.directory, 'inexistente', 'kil.sqlite');
      const harness = track(createServiceUnderTest(serviceConfig(nested)));

      await expect(harness.service.start()).rejects.toMatchObject({ reason: 'database-open-failed' });

      expect(existsSync(path.dirname(nested))).toBe(false);
    });

    it('rejects an invalid location at startup even if the config was not parsed', async () => {
      const valid = serviceConfig(temporary.filename);
      const forged = { ...valid, databasePath: path.join(REPOSITORY_ROOT, 'data', 'forjada.sqlite') };
      const harness = track(createServiceUnderTest(forged));

      await expect(harness.service.start()).rejects.toMatchObject({ reason: 'invalid-location' });

      expect(harness.connections).toHaveLength(0);
      expect(existsSync(forged.databasePath)).toBe(false);
    });

    it('stops cleanly after a failed start', async () => {
      const harness = newService({ startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'apply' } });
      await expect(harness.service.start()).rejects.toBeInstanceOf(LocalServiceStartupError);

      await harness.service.stop();
      await harness.service.stop();

      expect(harness.service.state).toBe('STOPPED');
      expect(stateChanges(harness)).toEqual(['STOPPED->STARTING', 'STARTING->FAILED', 'FAILED->STOPPED']);
    });

    it('recovers when the cause of a failed start is removed', async () => {
      const harness = newService({ startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'apply' } });
      await expect(harness.service.start()).rejects.toMatchObject({ reason: 'database-missing' });

      const provisioner = newService();
      await provisioner.service.start();
      await provisioner.service.stop();
      await harness.service.start();

      expect(harness.service.state).toBe('READY');
      expect(harness.service.lastFailure).toBeUndefined();
      expect(stateChanges(harness)).toEqual(['STOPPED->STARTING', 'STARTING->FAILED', 'FAILED->STARTING', 'STARTING->READY']);
    });
  });

  describe('operations', () => {
    it('refuses repository operations outside READY', async () => {
      const harness = newService();
      await expectNotReady(harness.service, 'STOPPED');

      await harness.service.start();
      await harness.service.stop();
      await expectNotReady(harness.service, 'STOPPED');

      const failing = newService({ startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'apply' } });
      rmSync(temporary.filename);
      await expect(failing.service.start()).rejects.toBeInstanceOf(LocalServiceStartupError);
      await expectNotReady(failing.service, 'FAILED');
    });

    it('keeps data after the service restarts, including in a new instance', async () => {
      const first = newService();
      await first.service.start();
      const company = newCompany();
      const context = contextFor(company.tenantId);
      const branch = createBranch(branchInput(company, { code: 'SEDE', sectorType: 'FUEL_STATION' }));
      first.service.transaction(({ branches, companies }) => {
        companies.create(context, company);
        branches.create(context, branch);
      });
      await first.service.stop();

      await first.service.start();
      await expect(first.service.companies.findById(context, company.id)).resolves.toEqual(company);
      await first.service.stop();

      const second = newService();
      await second.service.start();
      await expect(second.service.branches.listByCompany(context, company.id)).resolves.toEqual([branch]);
    });

    it('preserves tenant isolation through the service', async () => {
      const harness = newService();
      await harness.service.start();
      const companyA = newCompany();
      const companyB = newCompany();
      await harness.service.companies.create(contextFor(companyA.tenantId), companyA);
      await harness.service.companies.create(contextFor(companyB.tenantId), companyB);

      const contextB = contextFor(companyB.tenantId);
      await expect(harness.service.companies.findById(contextB, companyA.id)).resolves.toBeUndefined();
      await expect(harness.service.companies.delete(contextB, companyA.id)).rejects.toMatchObject({
        name: 'RecordNotFoundError',
      });
      await expect(
        harness.service.companies.findById(contextFor(companyA.tenantId), companyA.id),
      ).resolves.toEqual(companyA);
    });
  });

  describe('configuration', () => {
    const options = { protectedDirectories: PROTECTED_DIRECTORIES };

    it.each([
      ['relative path', 'data/kil.sqlite', 'location-not-absolute'],
      ['repository path', path.join(REPOSITORY_ROOT, 'kil.sqlite'), 'location-inside-protected-directory'],
      ['build artefact path', path.join(REPOSITORY_ROOT, 'services', 'local-api', 'dist', 'kil.db'), 'location-inside-protected-directory'],
      ['wrong extension', path.join(tmpdir(), 'kil.txt'), 'location-invalid-extension'],
    ])('rejects a %s for the database', (_label, databasePath, reason) => {
      const error = captureConfigError(() => serviceConfig(databasePath));

      expect(error).toMatchObject({ field: 'databasePath', reason });
    });

    it.each(Object.entries(LOCAL_SERVICE_ENV).filter(([key]) => key !== 'logLevel'))(
      'requires %s (%s)',
      (_key, variable) => {
        const error = captureConfigError(() =>
          loadLocalServiceConfigFromEnv(env(temporary.filename, { [variable]: undefined }), options),
        );

        expect(error.reason).toMatch(/obrigatóri/);
      },
    );

    it('defaults only the log level', () => {
      const config = loadLocalServiceConfigFromEnv(
        env(temporary.filename, { [LOCAL_SERVICE_ENV.logLevel]: undefined }),
        options,
      );

      expect(config).toEqual({
        databasePath: path.resolve(temporary.filename),
        environment: 'test',
        instanceId: 'cli-test',
        logLevel: 'info',
        startupPolicy: { onMissingDatabase: 'create', onPendingMigrations: 'apply' },
      });
      expect(Object.isFrozen(config)).toBe(true);
    });

    it.each([
      [LOCAL_SERVICE_ENV.environment, 'staging', 'environment'],
      [LOCAL_SERVICE_ENV.logLevel, 'verbose', 'logLevel'],
      [LOCAL_SERVICE_ENV.onMissingDatabase, 'maybe', 'startupPolicy.onMissingDatabase'],
      [LOCAL_SERVICE_ENV.onPendingMigrations, 'skip', 'startupPolicy.onPendingMigrations'],
      [LOCAL_SERVICE_ENV.instanceId, 'linha\n{"forjado":true}', 'instanceId'],
      [LOCAL_SERVICE_ENV.instanceId, 'x'.repeat(65), 'instanceId'],
    ])('rejects %s=%j', (variable, value, field) => {
      const error = captureConfigError(() =>
        loadLocalServiceConfigFromEnv(env(temporary.filename, { [variable]: value }), options),
      );

      expect(error.field).toBe(field);
    });

    it.each([
      [{ sql: 'DROP TABLE companies' }, 'sql'],
      [{ migrations: [] }, 'migrations'],
      [{ startupPolicy: { onMissingDatabase: 'create', onPendingMigrations: 'apply', pragma: 'x' } }, 'startupPolicy.pragma'],
    ])('rejects unsupported configuration keys such as %j', (extra, field) => {
      const error = captureConfigError(() => serviceConfig(temporary.filename, extra));

      expect(error.field).toBe(field);
    });

    it('rejects a missing configuration object', () => {
      expect(captureConfigError(() => parseLocalServiceConfig(undefined, options)).field).toBe('config');
    });

    it('does not load .env.example automatically', () => {
      expect(existsSync(path.join(REPOSITORY_ROOT, '.env.example'))).toBe(true);

      expect(() => loadLocalServiceConfigFromEnv({}, options)).toThrow(LocalServiceConfigError);
    });

    it('protects the service package and the monorepo root', () => {
      const directories = resolveProtectedDirectories(path.join(REPOSITORY_ROOT, 'services', 'local-api', 'dist'));

      expect(directories).toEqual([
        path.join(REPOSITORY_ROOT, 'services', 'local-api'),
        path.resolve(REPOSITORY_ROOT),
      ]);
    });
  });

  describe('structured logging', () => {
    it('never writes the NIF, company names or the full database path', async () => {
      const harness = newService();
      await harness.service.start();
      const company = newCompany({ legalName: 'Empresa Sigilosa, Lda.', nif: 'NIF-TESTE-7777' });
      await harness.service.companies.create(contextFor(company.tenantId), company);
      await harness.service.stop();
      const output = harness.lines.join('\n');

      expect(output).not.toContain('NIF-TESTE-7777');
      expect(output).not.toContain('Empresa Sigilosa');
      expect(output).not.toContain(temporary.directory);
      expect(output).not.toContain(JSON.stringify(temporary.directory).slice(1, -1));
      expect(harness.records()).toContainEqual(
        expect.objectContaining({ databaseFile: path.basename(temporary.filename), event: 'service.starting' }),
      );
    });

    it('redacts sensitive keys and filters by level', () => {
      const lines: string[] = [];
      const logger = createJsonLogger({ instanceId: 'redaction', level: 'warn', sink: (line) => lines.push(line) });

      logger.log('info', 'ignored', { value: 1 });
      logger.log('warn', 'kept', { companyNif: 'NIF-1', password: 'x', reason: 'ok' });

      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
        companyNif: '[REDACTED]',
        event: 'kept',
        level: 'warn',
        password: '[REDACTED]',
        reason: 'ok',
      });
    });
  });

  describe('runs without Electron', () => {
    const serviceSources = path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src');
    const sources = (directory: string): readonly string[] =>
      readdirSync(directory, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(ts|tsx|cts)$/.test(entry.name))
        .map((entry) => path.join(entry.parentPath, entry.name));

    it('executes in plain Node.js', () => {
      expect(process.versions.electron).toBeUndefined();
      expect(process.versions.node).toBeDefined();
    });

    it('does not import Electron, HTTP or network modules in the lifecycle code', () => {
      const forbidden = /from '(electron|fastify|node:(http|https|http2|net|tls|dgram|child_process))'/;
      const lifecycle = sources(serviceSources).filter((file) => path.basename(file) !== 'app.ts');

      expect(lifecycle.length).toBeGreaterThanOrEqual(6);
      for (const file of lifecycle) expect(readFileSync(file, 'utf8')).not.toMatch(forbidden);
      const manifest = readFileSync(path.join(REPOSITORY_ROOT, 'services', 'local-api', 'package.json'), 'utf8');
      expect(manifest).not.toContain('electron');
    });

    it('is not reachable from the desktop application', () => {
      const desktop = sources(path.join(REPOSITORY_ROOT, 'apps', 'desktop', 'src'));

      for (const file of desktop) {
        expect(readFileSync(file, 'utf8')).not.toMatch(/better-sqlite3|@kil-business\/(database|local-api)|local-api/);
      }
    });

    it('starts and stops through the CLI with --check', async () => {
      const lines: string[] = [];
      const code = await runLocalServiceCli(
        ['--check'],
        env(temporary.filename),
        { sink: (line) => lines.push(line), waitForShutdownSignal: () => Promise.reject(new Error('não usado')) },
        { protectedDirectories: PROTECTED_DIRECTORIES },
      );

      expect(code).toBe(LOCAL_SERVICE_EXIT_CODES.ok);
      const events = lines.map((line) => (JSON.parse(line) as { event: string }).event);
      expect(events).toContain('service.ready');
      expect(events.at(-1)).toBe('service.stopped');
    });

    it('waits for the shutdown signal in run mode, then stops', async () => {
      const lines: string[] = [];
      const signal = deferred();
      const execution = runLocalServiceCli(
        [],
        env(temporary.filename),
        {
          sink: (line) => lines.push(line),
          waitForShutdownSignal: async () => {
            await signal.promise;
            return 'SIGINT';
          },
        },
        { protectedDirectories: PROTECTED_DIRECTORIES },
      );
      await expect.poll(() => lines.some((line) => line.includes('service.waiting_for_shutdown'))).toBe(true);
      expect(lines.some((line) => line.includes('service.stopped'))).toBe(false);

      signal.resolve();

      await expect(execution).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.ok);
      expect(lines.at(-1)).toContain('service.stopped');
    });

    it.each([
      [{}, LOCAL_SERVICE_EXIT_CODES.invalidConfiguration, 'service.config_invalid'],
      ['unknown-argument', LOCAL_SERVICE_EXIT_CODES.invalidConfiguration, 'service.arguments_invalid'],
      ['missing-database', LOCAL_SERVICE_EXIT_CODES.startupFailed, 'service.start_failed'],
    ] as const)('returns a failure exit code for %j', async (scenario, expectedCode, expectedEvent) => {
      const lines: string[] = [];
      const environment =
        scenario === 'missing-database'
          ? env(temporary.filename, { [LOCAL_SERVICE_ENV.onMissingDatabase]: 'fail' })
          : typeof scenario === 'string'
            ? env(temporary.filename)
            : scenario;
      const args = scenario === 'unknown-argument' ? ['--sql=DROP'] : ['--check'];

      const code = await runLocalServiceCli(
        args,
        environment,
        { sink: (line) => lines.push(line), waitForShutdownSignal: () => Promise.resolve('SIGINT') },
        { protectedDirectories: PROTECTED_DIRECTORIES },
      );

      expect(code).toBe(expectedCode);
      expect(lines.join('\n')).toContain(expectedEvent);
      expect(existsSync(temporary.filename)).toBe(false);
    });
  });
});
