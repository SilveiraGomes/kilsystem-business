import { createHash } from 'node:crypto';
import dns from 'node:dns';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSqliteSessionStore,
  inspectMigrations,
  MIGRATIONS,
  migrationChecksum,
  openSqliteDatabase,
  PersistenceError,
  runMigrations,
  type SqliteDatabase,
} from '../packages/database/src/index';
import {
  DEFAULT_SESSION_POLICY,
  DomainValidationError,
  parseSessionId,
  parseSessionPolicy,
  RecordConflictError,
  RecordNotFoundError,
  SESSION_POLICY_LIMITS,
  SESSION_REVOCATION_REASONS,
  type User,
  type UserId,
} from '../packages/shared-types/src/index';
import {
  isAuthenticatedIdentity,
  type AuthenticatedIdentity,
} from '../services/local-api/src/authentication/local-authenticator';
import { createPasswordHasher, type Argon2idDerive } from '../services/local-api/src/authentication/password-hashing';
import {
  createLocalService,
  LocalServiceStartupError,
  LocalServiceStateError,
  type LocalService,
} from '../services/local-api/src/local-service';
import { createJsonLogger } from '../services/local-api/src/logger';
import {
  createLocalSessions,
  type IssuedSession,
  type SessionBackend,
} from '../services/local-api/src/sessions/local-sessions';
import { createSessionClock } from '../services/local-api/src/sessions/session-clock';
import {
  digestSessionToken,
  generateSessionToken,
  SESSION_TOKEN_BYTES,
  SESSION_TOKEN_LENGTH,
} from '../services/local-api/src/sessions/session-token';
import {
  createTestClock,
  deferred,
  OTHER_TEST_PASSWORD,
  TEST_HASHING_PARAMETERS,
  TEST_PASSWORD,
  UNICODE_TEST_PASSWORD,
  type TestClock,
} from './support/authentication-fixtures';
import { branchInput, contextFor, newCompany, newId } from './support/fixtures';
import { newCompanyMembership, newUser, uniqueUsername } from './support/identity-fixtures';
import {
  createServiceUnderTest,
  inspectDatabase,
  PROTECTED_DIRECTORIES,
  REPOSITORY_ROOT,
  serviceConfig,
  type ServiceTestDependencies,
  type ServiceUnderTest,
} from './support/local-service-harness';
import { createTemporaryDatabase, type TemporaryDatabase } from './support/sqlite-harness';

/*
 * E1.07-C — sessões locais, validade, revogação e continuidade da identidade. Os testes estão
 * numerados S01–S58 pela ordem da secção 17 da autorização; a correspondência entre requisitos e
 * testes está em docs/tasks/E1.07-C.md. Todos os dados são fictícios.
 */

const REQUIRED = { ok: false, reason: 'authentication-required' };
const LIMIT = { ok: false, reason: 'session-limit-reached' };
const INVALID = { ok: false, reason: 'invalid-session' };
const AUTH_INVALID = { ok: false, reason: 'invalid-credentials' };
const SECOND = 1000;
const START = Date.parse('2026-11-16T08:00:00.000Z');
const iso = (milliseconds: number): string => new Date(milliseconds).toISOString();

/** Somas das migrações 1 a 3 publicadas no checkpoint ab22404 (E1.07-B); nunca podem mudar. */
const PUBLISHED_CHECKSUMS: readonly { readonly version: number; readonly checksum: string }[] = [
  { checksum: 'c70164d253bed3637177a1a434282a3fb9e4d16c294134dd2f6ec61dbf734b61', version: 1 },
  { checksum: 'b05636332e82baa7250873473b7c91fd0a571ec07e2b90b7ee2d236fd9bfc2d0', version: 2 },
  { checksum: '340d886e73aae09527f46db3e3dbecfa9afc7b9fafa126e0267cea9d1d1a1f53', version: 3 },
];

/** Soma da migração 4 publicada em 0eb1e75 (E1.07-C); nunca pode mudar (E1.07-C-R1). */
const PUBLISHED_V4_CHECKSUM = '95e09724388a7dce7e6c5588a55f3c35ee98f7a7202356885720dd7d1cdedf6e';

interface SessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly token_digest: Buffer;
  readonly security_version: number;
  readonly credential_version: number;
  readonly service_run_id: string;
  readonly created_at: string;
  readonly last_activity_at: string;
  readonly absolute_expires_at: string;
  readonly revoked_at: string | null;
  readonly revocation_reason: string | null;
}

const sha256 = (data: Buffer): Buffer => createHash('sha256').update(data).digest();

/** Derivação nativa que pode reter a próxima chamada, para alterar o estado a meio. */
const heldDerive = () => {
  let armed = false;
  const gate = deferred();
  const started = deferred();
  const derive: Argon2idDerive = async (input) => {
    if (armed) {
      armed = false;
      started.resolve();
      await gate.promise;
    }
    const { argon2Sync } = await import('node:crypto');
    return argon2Sync('argon2id', {
      memory: input.parameters.memoryKiB,
      message: input.message,
      nonce: input.nonce,
      parallelism: input.parameters.parallelism,
      passes: input.parameters.passes,
      tagLength: input.tagLength,
    });
  };
  return {
    derive,
    holdNext: (): void => {
      armed = true;
    },
    release: (): void => gate.resolve(),
    started: started.promise,
  };
};

const expectNotReady = async (operation: () => Promise<unknown>): Promise<void> => {
  await expect(operation()).rejects.toMatchObject({ name: LocalServiceStateError.name, reason: 'not-ready' });
};

describe('Local sessions (E1.07-C)', () => {
  let temporary: TemporaryDatabase;
  let clock: TestClock;
  const running: { readonly service: LocalService }[] = [];
  const extraDatabases: TemporaryDatabase[] = [];

  const dependencies = (overrides: ServiceTestDependencies = {}): ServiceTestDependencies => ({
    clock: clock.now,
    monotonicClock: clock.monotonic,
    passwordHashing: { parameters: TEST_HASHING_PARAMETERS },
    ...overrides,
  });

  const newService = (overrides: ServiceTestDependencies = {}, filename = temporary.filename): ServiceUnderTest => {
    const harness = createServiceUnderTest(serviceConfig(filename), undefined, dependencies(overrides));
    running.push(harness);
    return harness;
  };

  const startedService = async (overrides: ServiceTestDependencies = {}): Promise<ServiceUnderTest> => {
    const harness = newService(overrides);
    await harness.service.start();
    return harness;
  };

  const provision = async (
    { service }: { readonly service: LocalService },
    password: string = TEST_PASSWORD,
  ): Promise<User> => {
    const user = newUser();
    await service.identityProvisioning.users.create(user);
    await service.identityProvisioning.credentials.create(user.id, password);
    return user;
  };

  const login = async (
    { service }: { readonly service: LocalService },
    user: User,
    password: string = TEST_PASSWORD,
  ): Promise<AuthenticatedIdentity> => {
    const result = await service.authentication.authenticate(user.username, password);
    if (!result.ok) throw new Error('Autenticação esperada.');
    return result.identity;
  };

  const openSession = async (
    harness: { readonly service: LocalService },
    user: User,
    password: string = TEST_PASSWORD,
  ): Promise<IssuedSession> => {
    const created = await harness.service.sessions.create(await login(harness, user, password));
    if (!created.ok) throw new Error(`Sessão esperada: ${created.reason}.`);
    return created.session;
  };

  const createTemporaryDatabaseConnection = (filename: string): SqliteDatabase => {
    if (filename === temporary.filename) return temporary.open();
    const other = extraDatabases.find((candidate) => candidate.filename === filename);
    if (other === undefined) throw new Error('Base de teste desconhecida.');
    return other.open();
  };

  const inspect = <T>(read: (database: SqliteDatabase) => T, filename = temporary.filename): T =>
    inspectDatabase(filename, () => createTemporaryDatabaseConnection(filename), read);

  const execute = (sql: string): void => {
    inspect((database) => {
      database.exec(sql);
    });
  };

  const sessionRow = (sessionId: string): SessionRow =>
    inspect((database) => database.prepare('SELECT * FROM local_sessions WHERE id = ?').get(sessionId) as SessionRow);

  const sessionCount = (where = '1 = 1'): number =>
    inspect((database) => database.prepare(`SELECT count(*) FROM local_sessions WHERE ${where}`).pluck().get() as number);

  const versionsOf = (userId: string): { readonly security: number; readonly credential: number } =>
    inspect((database) => ({
      credential: database
        .prepare('SELECT credential_version FROM password_credentials WHERE user_id = ?')
        .pluck()
        .get(userId) as number,
      security: database.prepare('SELECT security_version FROM users WHERE id = ?').pluck().get(userId) as number,
    }));

  beforeEach(() => {
    temporary = createTemporaryDatabase();
    clock = createTestClock();
  });

  afterEach(async () => {
    for (const harness of running.splice(0)) await harness.service.stop();
    temporary.dispose();
    for (const database of extraDatabases.splice(0)) database.dispose();
  });

  describe('authentication proofs', () => {
    it('[S01] issues an internal proof after a valid authentication, accepted once to create a session', async () => {
      const harness = await startedService();
      const user = await provision(harness);

      const identity = await login(harness, user);
      const created = await harness.service.sessions.create(identity);

      expect(isAuthenticatedIdentity(identity)).toBe(true);
      expect(Object.keys(identity).sort()).toEqual(['authenticatedAt', 'method', 'userId']);
      expect(created.ok).toBe(true);
      expect(created.ok && typeof created.session.token === 'string' && typeof created.session.sessionId === 'string').toBe(true);
    });

    it('[S02] rejects forged proofs, copies, foreign identities and identities from another service', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const identity = await login(harness, user);
      const forgeries: unknown[] = [
        { ...identity },
        { authenticatedAt: identity.authenticatedAt, method: 'password', userId: user.id },
        Object.freeze({ ...identity }),
        Object.create(identity) as unknown,
        null,
        undefined,
        user.id,
        JSON.parse(JSON.stringify(identity)) as unknown,
      ];

      for (const forged of forgeries) {
        await expect(harness.service.sessions.create(forged as AuthenticatedIdentity)).resolves.toEqual(REQUIRED);
      }
      expect(sessionCount()).toBe(0);
      // As tentativas forjadas não consumiram o comprovativo genuíno.
      await expect(harness.service.sessions.create(identity)).resolves.toMatchObject({ ok: true });

      // Um comprovativo emitido por outro serviço local (outra base) não é reconhecido aqui.
      const other = createTemporaryDatabase();
      extraDatabases.push(other);
      const foreign = newService({}, other.filename);
      await foreign.service.start();
      const stranger = await provision(foreign);
      const foreignIdentity = await login(foreign, stranger);
      await expect(harness.service.sessions.create(foreignIdentity)).resolves.toEqual(REQUIRED);
    });

    it('[S03] accepts the proof up to 60 seconds after the authentication', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const identity = await login(harness, user);

      clock.advanceSeconds(60);

      await expect(harness.service.sessions.create(identity)).resolves.toMatchObject({ ok: true });
    });

    it('[S04] rejects the proof once it has expired', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const identity = await login(harness, user);

      clock.advanceSeconds(61);

      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
      expect(sessionCount()).toBe(0);
    });

    it('[S05] uses each proof only once', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const identity = await login(harness, user);

      await expect(harness.service.sessions.create(identity)).resolves.toMatchObject({ ok: true });
      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
      expect(sessionCount()).toBe(1);
    });

    it('[S06] rejects reuse after logout and after a refused attempt', async () => {
      const harness = await startedService({ sessionPolicy: { maxActiveSessionsPerUser: 1 } });
      const user = await provision(harness);
      const identity = await login(harness, user);
      const created = await harness.service.sessions.create(identity);
      if (!created.ok) throw new Error('Sessão esperada.');

      await harness.service.sessions.logout(created.session.token);
      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);

      // Um comprovativo recusado pelo limite fica igualmente utilizado.
      const second = await openSession(harness, user);
      const refused = await login(harness, user);
      await expect(harness.service.sessions.create(refused)).resolves.toEqual(LIMIT);
      await harness.service.sessions.logout(second.token);
      await expect(harness.service.sessions.create(refused)).resolves.toEqual(REQUIRED);
    });

    it('[S07] lets only one of several concurrent consumptions create a session', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const identity = await login(harness, user);

      const results = await Promise.all(Array.from({ length: 6 }, () => harness.service.sessions.create(identity)));

      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual(Array.from({ length: 5 }, () => REQUIRED));
      expect(sessionCount()).toBe(1);
    });

    it('[S08] rejects the proof after the identity is suspended', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const identity = await login(harness, user);

      await harness.service.identityProvisioning.users.changeStatus(user.id, 'SUSPENDED', clock.now());

      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
    });

    it('[S09] rejects the proof after suspension and reactivation', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const identity = await login(harness, user);
      const { users } = harness.service.identityProvisioning;

      await users.changeStatus(user.id, 'SUSPENDED', clock.now());
      await users.changeStatus(user.id, 'ACTIVE', clock.now());

      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
      await expect(openSession(harness, user)).resolves.toHaveProperty('token');
    });

    it('[S10] rejects the proof after the credential is replaced', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const identity = await login(harness, user);

      await harness.service.identityProvisioning.credentials.replace(user.id, OTHER_TEST_PASSWORD);

      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
    });

    it('[S11] rejects the proof after a service restart', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const identity = await login(harness, user);

      await harness.service.stop();
      await harness.service.start();

      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
      expect(sessionCount()).toBe(0);
    });

    it('[S12] rejects the proof after the security version changes', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const identity = await login(harness, user);

      await harness.service.identityProvisioning.sessions.revokeUserSessions(user.id);

      expect(versionsOf(user.id)).toEqual({ credential: 1, security: 2 });
      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
    });
  });

  describe('sessions', () => {
    it('[S13] creates a session bound to identity, versions and run, returning only the necessary fields', async () => {
      const harness = await startedService();
      const user = await provision(harness);

      const created = await harness.service.sessions.create(await login(harness, user));
      if (!created.ok) throw new Error('Sessão esperada.');
      const { session } = created;

      expect(Object.isFrozen(created) && Object.isFrozen(session)).toBe(true);
      expect(Object.keys(session).sort()).toEqual(['absoluteExpiresAt', 'idleExpiresAt', 'sessionId', 'token']);
      expect(session.absoluteExpiresAt).toBe(iso(START + 43200 * SECOND));
      expect(session.idleExpiresAt).toBe(iso(START + 1800 * SECOND));
      const row = sessionRow(session.sessionId);
      expect(row).toMatchObject({
        absolute_expires_at: iso(START + 43200 * SECOND),
        created_at: iso(START),
        credential_version: 1,
        last_activity_at: iso(START),
        revocation_reason: null,
        revoked_at: null,
        security_version: 1,
        user_id: user.id,
      });
      expect(row.service_run_id).toMatch(/^[0-9a-f]{32}$/);
    });

    it('[S14] generates tokens from 32 cryptographically random bytes encoded in Base64URL', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const { token } = await openSession(harness, user);

      expect(SESSION_TOKEN_BYTES).toBe(32);
      expect(SESSION_TOKEN_LENGTH).toBe(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      const samples = Array.from({ length: 2000 }, () => generateSessionToken());
      expect(new Set(samples.map((sample) => sample.token)).size).toBe(samples.length);
      for (const sample of samples.slice(0, 50)) expect(Buffer.from(sample.token, 'base64url')).toHaveLength(32);

      const source = readFileSync(
        path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'sessions', 'session-token.ts'),
        'utf8',
      );
      expect(source).toMatch(/import \{[^}]*\brandomBytes\b[^}]*\} from 'node:crypto'/);
      expect(source).toContain('randomBytes(SESSION_TOKEN_BYTES)');
      expect(source).not.toMatch(/Math\.random|randomUUID\(|from 'jsonwebtoken'|from 'jose'/);
    });

    it('[S15] issues distinct tokens and session identifiers', async () => {
      const harness = await startedService();
      const sessions: IssuedSession[] = [];
      for (const user of [await provision(harness), await provision(harness)]) {
        for (let index = 0; index < 5; index += 1) sessions.push(await openSession(harness, user));
      }

      expect(new Set(sessions.map((session) => session.token)).size).toBe(10);
      expect(new Set(sessions.map((session) => session.sessionId)).size).toBe(10);
      expect(new Set(inspect((database) => database.prepare('SELECT hex(token_digest) FROM local_sessions').pluck().all())).size).toBe(10);
    });

    it('[S16] persists only the SHA-256 digest of the token', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);

      const row = sessionRow(session.sessionId);

      expect(row.token_digest).toHaveLength(32);
      expect(row.token_digest.equals(sha256(Buffer.from(session.token, 'base64url')))).toBe(true);
      expect(digestSessionToken(session.token)?.equals(row.token_digest)).toBe(true);
    });

    it('[S17] never stores the original token in the database', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const sessions = [await openSession(harness, user), await openSession(harness, user)];
      const textDump = inspect((database) =>
        JSON.stringify(
          ['users', 'password_credentials', 'local_sessions', 'authentication_throttle', 'schema_migrations'].map((table) =>
            database.prepare(`SELECT * FROM ${table}`).all(),
          ),
        ),
      );
      await harness.service.stop();

      const files = [temporary.filename, `${temporary.filename}-wal`].filter((file) => existsSync(file));
      const bytes = Buffer.concat(files.map((file) => readFileSync(file)));
      for (const { token } of sessions) {
        expect(textDump).not.toContain(token);
        expect(bytes.includes(Buffer.from(token, 'utf8'))).toBe(false);
        expect(bytes.includes(Buffer.from(token, 'base64url'))).toBe(false);
      }
    });

    it('[S18] rejects malformed tokens before any lookup', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const { token } = await openSession(harness, user);
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const last = token.at(-1) ?? 'A';
      const nonCanonical = token.slice(0, -1) + (alphabet[alphabet.indexOf(last) ^ 1] ?? 'A');
      const malformed: unknown[] = [
        undefined,
        null,
        42,
        {},
        [token],
        '',
        'a',
        `${token}A`,
        token.slice(1),
        `${token}=`,
        `${token.slice(0, -1)}+`,
        `${token.slice(0, -1)}/`,
        ` ${token.slice(1)}`,
        nonCanonical,
        'x'.repeat(1_000_000),
      ];
      for (const value of malformed) {
        expect(digestSessionToken(value)).toBeUndefined();
        await expect(harness.service.sessions.validate(value)).resolves.toEqual(INVALID);
        await expect(harness.service.sessions.registerActivity(value)).resolves.toEqual(INVALID);
        await expect(harness.service.sessions.logout(value)).resolves.toBeUndefined();
      }
      expect(nonCanonical).not.toBe(token);
      await expect(harness.service.sessions.validate(token)).resolves.toMatchObject({ ok: true });
    });

    it('[S19] rejects well-formed tokens that do not exist', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      await openSession(harness, user);

      const unknown = generateSessionToken().token;

      await expect(harness.service.sessions.validate(unknown)).resolves.toEqual(INVALID);
      await expect(harness.service.sessions.registerActivity(unknown)).resolves.toEqual(INVALID);
    });

    it('[S20] validates an active session without changing its activity or exposing internal fields', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      clock.advanceSeconds(120);

      const result = await harness.service.sessions.validate(session.token);

      expect(result).toEqual({
        ok: true,
        session: {
          absoluteExpiresAt: iso(START + 43200 * SECOND),
          idleExpiresAt: iso(START + 1800 * SECOND),
          sessionId: session.sessionId,
          userId: user.id,
        },
      });
      expect(sessionRow(session.sessionId).last_activity_at).toBe(iso(START));
    });

    it('[S21] expires a session after 30 minutes of inactivity', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);

      clock.advanceSeconds(1799);
      await expect(harness.service.sessions.validate(session.token)).resolves.toMatchObject({ ok: true });
      clock.advanceSeconds(1);

      await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      await expect(harness.service.sessions.registerActivity(session.token)).resolves.toEqual(INVALID);
      expect(sessionRow(session.sessionId).last_activity_at).toBe(iso(START));
    });

    it('[S22] expires a session 12 hours after its creation despite continuous activity', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);

      for (let step = 1; step <= 35; step += 1) {
        clock.advanceSeconds(1200);
        await expect(harness.service.sessions.registerActivity(session.token)).resolves.toMatchObject({ ok: true });
      }
      clock.advanceSeconds(1199);
      await expect(harness.service.sessions.registerActivity(session.token)).resolves.toMatchObject({ ok: true });
      clock.advanceSeconds(1);

      await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      await expect(harness.service.sessions.registerActivity(session.token)).resolves.toEqual(INVALID);
    });

    it('[S23] registers activity on a valid session, extending only the inactivity window', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      clock.advanceSeconds(600);

      const touched = await harness.service.sessions.registerActivity(session.token);

      expect(touched).toEqual({
        ok: true,
        session: {
          absoluteExpiresAt: iso(START + 43200 * SECOND),
          idleExpiresAt: iso(START + 2400 * SECOND),
          sessionId: session.sessionId,
          userId: user.id,
        },
      });
      expect(sessionRow(session.sessionId)).toMatchObject({
        absolute_expires_at: iso(START + 43200 * SECOND),
        last_activity_at: iso(START + 600 * SECOND),
      });
      clock.advanceSeconds(1700);
      await expect(harness.service.sessions.validate(session.token)).resolves.toMatchObject({ ok: true });
    });

    it('[S24] never extends a session beyond its absolute expiry nor through invalid attempts', async () => {
      const harness = await startedService({ sessionPolicy: { absoluteLifetimeSeconds: 3600 } });
      const user = await provision(harness);
      const session = await openSession(harness, user);
      clock.advanceSeconds(1700);
      await harness.service.sessions.registerActivity(session.token);
      clock.advanceSeconds(1700);

      const touched = await harness.service.sessions.registerActivity(session.token);

      // A janela de inactividade é cortada pela expiração absoluta.
      expect(touched).toMatchObject({ ok: true, session: { idleExpiresAt: iso(START + 3600 * SECOND) } });
      const before = sessionRow(session.sessionId);
      await harness.service.sessions.registerActivity(generateSessionToken().token);
      await harness.service.sessions.registerActivity(`${session.token.slice(0, -1)}!`);
      expect(sessionRow(session.sessionId)).toEqual(before);
      // Nem a escrita directa permite actividade posterior à expiração absoluta.
      expect(() =>
        execute(`UPDATE local_sessions SET last_activity_at = '${iso(START + 7200 * SECOND)}' WHERE id = '${session.sessionId}'`),
      ).toThrow(/CHECK constraint failed/);
      clock.advanceSeconds(200);
      await expect(harness.service.sessions.registerActivity(session.token)).resolves.toEqual(INVALID);
      expect(sessionRow(session.sessionId)).toEqual(before);
    });

    it('[S25] revokes the session on logout', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      clock.advanceSeconds(30);

      await harness.service.sessions.logout(session.token);

      await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      await expect(harness.service.sessions.registerActivity(session.token)).resolves.toEqual(INVALID);
      expect(sessionRow(session.sessionId)).toMatchObject({ revocation_reason: 'logout', revoked_at: iso(START + 30 * SECOND) });
    });

    it('[S26] repeats logout safely and idempotently', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      await harness.service.sessions.logout(session.token);
      const first = sessionRow(session.sessionId);
      clock.advanceSeconds(60);

      await expect(harness.service.sessions.logout(session.token)).resolves.toBeUndefined();
      await expect(harness.service.sessions.logout(generateSessionToken().token)).resolves.toBeUndefined();
      await expect(harness.service.sessions.logout('não é um token')).resolves.toBeUndefined();

      expect(sessionRow(session.sessionId)).toEqual(first);
    });

    it('[S27] revokes an individual session through the internal administration', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const first = await openSession(harness, user);
      const second = await openSession(harness, user);
      const administration = harness.service.identityProvisioning.sessions;

      await expect(administration.revokeSession(first.sessionId)).resolves.toBe(true);
      await expect(administration.revokeSession(first.sessionId)).resolves.toBe(false);

      await expect(harness.service.sessions.validate(first.token)).resolves.toEqual(INVALID);
      await expect(harness.service.sessions.validate(second.token)).resolves.toMatchObject({ ok: true });
      expect(sessionRow(first.sessionId).revocation_reason).toBe('administrative');
      expect(versionsOf(user.id)).toEqual({ credential: 1, security: 1 });
      await expect(administration.revokeSession('não-é-um-id' as never)).rejects.toBeInstanceOf(DomainValidationError);
    });

    it('[S28] revokes every session of a user', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const sessions = [await openSession(harness, user), await openSession(harness, user), await openSession(harness, user)];
      const administration = harness.service.identityProvisioning.sessions;

      await expect(administration.revokeUserSessions(user.id)).resolves.toBe(3);

      for (const session of sessions) {
        await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
        expect(sessionRow(session.sessionId).revocation_reason).toBe('user-sessions-revoked');
      }
      expect(versionsOf(user.id)).toEqual({ credential: 1, security: 2 });
      const fresh = await openSession(harness, user);
      await expect(harness.service.sessions.validate(fresh.token)).resolves.toMatchObject({ ok: true });
      await expect(administration.revokeUserSessions(newId() as UserId)).rejects.toBeInstanceOf(RecordNotFoundError);
    });

    it('[S29] isolates sessions between users', async () => {
      const harness = await startedService({ sessionPolicy: { maxActiveSessionsPerUser: 2 } });
      const alice = await provision(harness);
      const bruno = await provision(harness);
      const aliceSession = await openSession(harness, alice);
      const brunoSession = await openSession(harness, bruno);
      await openSession(harness, alice);

      await expect(harness.service.sessions.validate(aliceSession.token)).resolves.toMatchObject({ session: { userId: alice.id } });
      await expect(harness.service.sessions.validate(brunoSession.token)).resolves.toMatchObject({ session: { userId: bruno.id } });
      // O limite de uma identidade não afecta a outra.
      await expect(harness.service.sessions.create(await login(harness, alice))).resolves.toEqual(LIMIT);
      await expect(harness.service.sessions.create(await login(harness, bruno))).resolves.toMatchObject({ ok: true });

      await harness.service.identityProvisioning.sessions.revokeUserSessions(alice.id);
      await expect(harness.service.sessions.validate(brunoSession.token)).resolves.toMatchObject({ ok: true });
      const aliceAgain = await openSession(harness, alice);
      await harness.service.identityProvisioning.users.changeStatus(bruno.id, 'SUSPENDED', clock.now());
      await expect(harness.service.sessions.validate(aliceAgain.token)).resolves.toMatchObject({ ok: true });
      await harness.service.sessions.logout(aliceAgain.token);
      expect(sessionCount(`user_id = '${bruno.id}' AND revocation_reason = 'identity-status-changed'`)).toBe(2);
      expect(sessionCount(`user_id = '${alice.id}' AND revocation_reason = 'logout'`)).toBe(1);
    });

    it('[S30] refuses a sixth active session without revoking the others, counting only valid sessions', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const sessions: IssuedSession[] = [];
      for (let index = 0; index < 5; index += 1) sessions.push(await openSession(harness, user));

      await expect(harness.service.sessions.create(await login(harness, user))).resolves.toEqual(LIMIT);

      for (const session of sessions) await expect(harness.service.sessions.validate(session.token)).resolves.toMatchObject({ ok: true });
      expect(sessionCount('revoked_at IS NOT NULL')).toBe(0);
      await harness.service.sessions.logout(sessions[0]?.token);
      await expect(harness.service.sessions.create(await login(harness, user))).resolves.toMatchObject({ ok: true });
      // Sessões expiradas por inactividade deixam de contar, sem limpeza nem revogação explícita.
      clock.advanceSeconds(1800);
      for (let index = 0; index < 5; index += 1) await openSession(harness, user);
      expect(sessionCount('revoked_at IS NULL')).toBe(10);
    });

    it('[S31] applies the session limit atomically under concurrency', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const identities: AuthenticatedIdentity[] = [];
      for (let index = 0; index < 8; index += 1) identities.push(await login(harness, user));

      const results = await Promise.all(identities.map((identity) => harness.service.sessions.create(identity)));

      expect(results.filter((result) => result.ok)).toHaveLength(5);
      expect(results.filter((result) => !result.ok)).toEqual([LIMIT, LIMIT, LIMIT]);
      expect(sessionCount(`user_id = '${user.id}' AND revoked_at IS NULL`)).toBe(5);
    });
  });

  describe('security changes', () => {
    it('[S32] revokes active sessions when the identity is suspended, in the same statement', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const sessions = [await openSession(harness, user), await openSession(harness, user)];
      clock.advanceSeconds(10);

      await harness.service.identityProvisioning.users.changeStatus(user.id, 'SUSPENDED', clock.now());

      for (const session of sessions) {
        await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
        expect(sessionRow(session.sessionId)).toMatchObject({
          revocation_reason: 'identity-status-changed',
          revoked_at: iso(START + 10 * SECOND),
        });
      }
      expect(versionsOf(user.id).security).toBe(2);
    });

    it('[S33] revokes active sessions when the identity is deactivated', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);

      await harness.service.identityProvisioning.users.changeStatus(user.id, 'INACTIVE', clock.now());

      await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      expect(sessionRow(session.sessionId).revocation_reason).toBe('identity-status-changed');
      await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toEqual(AUTH_INVALID);
    });

    it('[S34] never restores old sessions on reactivation, and ignores changes without security impact', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const old = await openSession(harness, user);
      const { users } = harness.service.identityProvisioning;

      await users.changeStatus(user.id, 'SUSPENDED', clock.now());
      await users.changeStatus(user.id, 'ACTIVE', clock.now());

      await expect(harness.service.sessions.validate(old.token)).resolves.toEqual(INVALID);
      expect(versionsOf(user.id).security).toBe(3);
      const fresh = await openSession(harness, user);
      // Repetir o estado ACTIVE não é uma alteração de segurança: não revoga nem avança versões.
      await users.changeStatus(user.id, 'ACTIVE', clock.now());
      await expect(harness.service.sessions.validate(fresh.token)).resolves.toMatchObject({ ok: true });
      expect(versionsOf(user.id).security).toBe(3);
    });

    it('[S35] revokes sessions when the credential is replaced', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      clock.advanceSeconds(5);

      await harness.service.identityProvisioning.credentials.replace(user.id, OTHER_TEST_PASSWORD);

      await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      expect(sessionRow(session.sessionId)).toMatchObject({
        revocation_reason: 'credential-replaced',
        revoked_at: iso(START + 5 * SECOND),
      });
      expect(versionsOf(user.id)).toEqual({ credential: 2, security: 1 });
      await expect(openSession(harness, user, OTHER_TEST_PASSWORD)).resolves.toHaveProperty('token');
    });

    it('[S36] keeps versions and sessions consistent under concurrent credential replacements', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      const { credentials } = harness.service.identityProvisioning;

      const outcomes = await Promise.allSettled([
        credentials.replace(user.id, OTHER_TEST_PASSWORD),
        credentials.replace(user.id, UNICODE_TEST_PASSWORD),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(rejected?.reason).toBeInstanceOf(RecordConflictError);
      expect(versionsOf(user.id).credential).toBe(2);
      await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      const winner = outcomes[0]?.status === 'fulfilled' ? OTHER_TEST_PASSWORD : UNICODE_TEST_PASSWORD;
      const loser = winner === OTHER_TEST_PASSWORD ? UNICODE_TEST_PASSWORD : OTHER_TEST_PASSWORD;
      await expect(harness.service.authentication.authenticate(user.username, loser)).resolves.toEqual(AUTH_INVALID);
      await expect(openSession(harness, user, winner)).resolves.toHaveProperty('token');
    });

    it('[S37] issues no session when the identity status changes during issuance', async () => {
      const held = heldDerive();
      const harness = await startedService({ passwordHashing: { derive: held.derive, parameters: TEST_HASHING_PARAMETERS } });
      const user = await provision(harness);

      // a) durante a derivação: a autenticação é recusada e não há comprovativo.
      held.holdNext();
      const pending = harness.service.authentication.authenticate(user.username, TEST_PASSWORD);
      await held.started;
      await harness.service.identityProvisioning.users.changeStatus(user.id, 'SUSPENDED', clock.now());
      held.release();
      await expect(pending).resolves.toEqual(AUTH_INVALID);
      await harness.service.identityProvisioning.users.changeStatus(user.id, 'ACTIVE', clock.now());

      // b) entre o comprovativo e a criação, mesmo sem avanço da versão (trigger retirado só nesta
      // base de teste): a revalidação do estado recusa a criação e a validação.
      const session = await openSession(harness, user);
      const identity = await login(harness, user);
      execute('DROP TRIGGER users_status_change_revokes_sessions');
      execute(`UPDATE users SET status = 'SUSPENDED' WHERE id = '${user.id}'`);
      expect(versionsOf(user.id).security).toBe(3);
      expect(sessionRow(session.sessionId).revoked_at).toBeNull();

      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
      await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      await expect(harness.service.sessions.registerActivity(session.token)).resolves.toEqual(INVALID);
      expect(sessionCount()).toBe(1);
    });

    it('[S38] keeps validation consistent with concurrent revocation', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      const { sessions } = harness.service;
      clock.advanceSeconds(60);

      const results = await Promise.all([
        sessions.validate(session.token),
        sessions.logout(session.token),
        sessions.validate(session.token),
        sessions.registerActivity(session.token),
      ]);

      expect(results).toEqual([expect.objectContaining({ ok: true }), undefined, INVALID, INVALID]);
      expect(sessionRow(session.sessionId).last_activity_at).toBe(iso(START));

      // Revogação por outra ligação (E1.07-X): com a base detida em exclusivo, nenhuma outra ligação
      // chega a ler nem a escrever; a sessão só muda pela revogação confirmada na ligação do serviço.
      const other = await openSession(harness, user);
      expect(() => openSqliteDatabase({ busyTimeoutMs: 0, filename: temporary.filename })).toThrow(/locked/);
      await expect(sessions.validate(other.token)).resolves.toMatchObject({ ok: true });
      await harness.service.identityProvisioning.sessions.revokeSession(other.sessionId);
      await expect(sessions.validate(other.token)).resolves.toEqual(INVALID);
    });

    it('[S39] never leaves an old session usable when the revocation cannot be persisted', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);

      // a) a revogação falha: a alteração de segurança é desfeita na mesma transacção.
      execute(`CREATE TRIGGER test_block_revocation BEFORE UPDATE OF revoked_at ON local_sessions
        BEGIN SELECT RAISE(ABORT, 'revogação bloqueada no teste'); END`);
      await expect(
        harness.service.identityProvisioning.users.changeStatus(user.id, 'SUSPENDED', clock.now()),
      ).rejects.toMatchObject({ name: PersistenceError.name, reason: 'constraint' });
      await expect(harness.service.identityProvisioning.credentials.replace(user.id, OTHER_TEST_PASSWORD)).rejects.toBeInstanceOf(
        PersistenceError,
      );
      await expect(harness.service.sessions.logout(session.token)).rejects.toBeInstanceOf(PersistenceError);
      expect(inspect((database) => database.prepare('SELECT status FROM users WHERE id = ?').pluck().get(user.id))).toBe('ACTIVE');
      expect(versionsOf(user.id)).toEqual({ credential: 1, security: 1 });
      execute('DROP TRIGGER test_block_revocation');

      // b) o marcador de revogação não é escrito (trigger retirado): a versão da credencial avança
      // e a validação recusa a sessão na mesma.
      execute('DROP TRIGGER password_credentials_version_revokes_sessions');
      await harness.service.identityProvisioning.credentials.replace(user.id, OTHER_TEST_PASSWORD);
      expect(sessionRow(session.sessionId).revoked_at).toBeNull();
      expect(versionsOf(user.id).credential).toBe(2);
      await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      await expect(harness.service.sessions.registerActivity(session.token)).resolves.toEqual(INVALID);
    });

    it('[S40] rejects sessions with an incompatible security version regardless of the revocation marker', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const sessions: IssuedSession[] = [];
      for (let index = 0; index < 5; index += 1) sessions.push(await openSession(harness, user));
      execute('DROP TRIGGER users_security_version_revokes_sessions');

      execute(`UPDATE users SET security_version = security_version + 1 WHERE id = '${user.id}'`);

      expect(sessionCount('revoked_at IS NULL')).toBe(5);
      for (const session of sessions) {
        await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
        await expect(harness.service.sessions.registerActivity(session.token)).resolves.toEqual(INVALID);
      }
      // As sessões desactualizadas também não contam para o limite.
      await expect(openSession(harness, user)).resolves.toHaveProperty('token');
    });
  });

  describe('service lifecycle', () => {
    it('[S41] never yields a usable session when the service stops during creation', async () => {
      // a) criação e validação pedidas enquanto o serviço está em STOPPING. O registo da transição
      // STOPPING → STOPPED é emitido com o estado ainda em STOPPING e a ligação já libertada.
      const attempts: Promise<unknown>[] = [];
      const hook: { service?: LocalService; identity?: AuthenticatedIdentity } = {};
      const logger = createJsonLogger({
        instanceId: 'stopping',
        level: 'debug',
        sink: (line) => {
          const record = JSON.parse(line) as { event: string; to?: string };
          const { identity, service } = hook;
          if (record.event === 'service.state_changed' && record.to === 'STOPPED' && service && identity && attempts.length === 0) {
            attempts.push(service.sessions.create(identity).then(() => 'created', (error: unknown) => error));
            attempts.push(service.sessions.validate(generateSessionToken().token).then(() => 'validated', (error: unknown) => error));
          }
        },
      });
      const service = createLocalService(serviceConfig(temporary.filename), {
        clock: clock.now,
        logger,
        monotonicClock: clock.monotonic,
        passwordHashing: { parameters: TEST_HASHING_PARAMETERS },
        protectedDirectories: PROTECTED_DIRECTORIES,
      });
      hook.service = service;
      running.push({ service });
      await service.start();
      const user = await provision({ service });
      const identity = await login({ service }, user);
      hook.identity = identity;
      await service.stop();
      expect(attempts).toHaveLength(2);
      for (const outcome of await Promise.all(attempts)) {
        expect(outcome).toMatchObject({ name: LocalServiceStateError.name, reason: 'not-ready', state: 'STOPPING' });
      }
      await service.start();
      await expect(service.sessions.create(identity)).resolves.toEqual(REQUIRED);

      // b) criação pedida imediatamente antes do encerramento: a sessão não sobrevive ao reinício.
      const created = service.sessions.create(await login({ service }, user));
      await service.stop();
      const result = await created;
      if (!result.ok) throw new Error('Sessão esperada.');
      await service.start();
      await expect(service.sessions.validate(result.session.token)).resolves.toEqual(INVALID);

      // c) autenticação a meio quando o serviço encerra: sem comprovativo, sem sessão.
      const held = heldDerive();
      const heldHarness = newService({ passwordHashing: { derive: held.derive, parameters: TEST_HASHING_PARAMETERS } });
      await service.stop();
      await heldHarness.service.start();
      held.holdNext();
      const pending = heldHarness.service.authentication.authenticate(user.username, TEST_PASSWORD);
      await held.started;
      await heldHarness.service.stop();
      held.release();
      await expect(pending).rejects.toMatchObject({ reason: 'not-ready' });
      expect(sessionCount('revoked_at IS NULL')).toBe(0);
    });

    it('[S42] invalidates every session created before a restart, even without a revocation marker', async () => {
      const first = await startedService();
      const user = await provision(first);
      const session = await openSession(first, user);
      const runId = sessionRow(session.sessionId).service_run_id;
      await first.service.stop();

      const second = await startedService();

      await expect(second.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      expect(sessionRow(session.sessionId).revocation_reason).toBe('service-restarted');
      expect(second.records()).toContainEqual(
        expect.objectContaining({ event: 'service.sessions_reset', removedSessions: 0, revokedSessions: 1 }),
      );
      // Uma sessão de outro arranque que tenha ficado por revogar continua inutilizável.
      const orphan = generateSessionToken();
      inspect((database) =>
        createSqliteSessionStore(database).insertSession({
          absoluteExpiresAt: iso(START + 3600 * SECOND),
          createdAt: iso(START),
          credentialVersion: 1,
          id: parseSessionId(newId()),
          lastActivityAt: iso(START),
          revocationReason: undefined,
          revokedAt: undefined,
          securityVersion: 1,
          serviceRunId: runId,
          tokenDigest: orphan.digest,
          userId: user.id,
        }),
      );
      await expect(second.service.sessions.validate(orphan.token)).resolves.toEqual(INVALID);
      await expect(second.service.sessions.registerActivity(orphan.token)).resolves.toEqual(INVALID);
    });

    it('[S43] rejects proofs issued before a restart, including in a new service instance', async () => {
      const first = await startedService();
      const user = await provision(first);
      const identity = await login(first, user);
      await first.service.stop();

      const second = await startedService();

      await expect(second.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
      // E1.07-X: enquanto `second` detém a base, `first` não arranca sobre ela.
      await expect(first.service.start()).rejects.toMatchObject({ reason: 'database-locked' });
      await second.service.stop();
      await first.service.start();
      await expect(first.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
      expect(sessionCount()).toBe(0);
    });

    it('[S44] refuses stale references obtained in a previous run', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      const identity = await login(harness, user);
      const staleSessions = harness.service.sessions;
      const staleAdministration = harness.service.identityProvisioning.sessions;
      const operations = (sessions: typeof staleSessions, administration: typeof staleAdministration) => [
        () => sessions.create(identity),
        () => sessions.validate(session.token),
        () => sessions.registerActivity(session.token),
        () => sessions.logout(session.token),
        () => administration.revokeSession(session.sessionId),
        () => administration.revokeUserSessions(user.id),
        () => administration.expireSessions(),
        () => administration.cleanupSessions(),
      ];

      await harness.service.stop();
      for (const operation of operations(staleSessions, staleAdministration)) await expectNotReady(operation);
      await harness.service.start();
      for (const operation of operations(staleSessions, staleAdministration)) await expectNotReady(operation);

      expect(harness.service.sessions).not.toBe(staleSessions);
      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
      expect(sessionRow(session.sessionId).revocation_reason).toBe('service-restarted');
    });

    it('[S45] refuses every session operation outside READY', async () => {
      const failing = createServiceUnderTest(serviceConfig(temporary.filename), () => {
        throw new Error('abertura recusada no teste');
      }, dependencies());
      running.push(failing);
      const harness = newService();
      const all = (service: LocalService) => [
        () => service.sessions.create({} as AuthenticatedIdentity),
        () => service.sessions.validate(generateSessionToken().token),
        () => service.sessions.registerActivity(generateSessionToken().token),
        () => service.sessions.logout(generateSessionToken().token),
        () => service.identityProvisioning.sessions.revokeSession(newId() as never),
        () => service.identityProvisioning.sessions.revokeUserSessions(newId() as UserId),
        () => service.identityProvisioning.sessions.expireSessions(),
        () => service.identityProvisioning.sessions.cleanupSessions(),
      ];

      for (const operation of all(harness.service)) await expectNotReady(operation);
      await expect(failing.service.start()).rejects.toBeInstanceOf(LocalServiceStartupError);
      expect(failing.service.state).toBe('FAILED');
      for (const operation of all(failing.service)) await expectNotReady(operation);
      await harness.service.start();
      await harness.service.stop();
      for (const operation of all(harness.service)) await expectNotReady(operation);
    });

    it('[S46] expires earlier, never later, when the wall clock jumps forward', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      const identity = await login(harness, user);

      clock.set(iso(START + 2 * 3600 * SECOND));

      await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
    });

    it('[S47] does not extend any validity when the wall clock moves backwards', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      clock.advanceSeconds(1700);

      clock.set(iso(START - 3600 * SECOND));

      await expect(harness.service.sessions.registerActivity(session.token)).resolves.toMatchObject({ ok: true });
      expect(sessionRow(session.sessionId).last_activity_at).toBe(iso(START + 1700 * SECOND));
      const identity = await login(harness, user);
      const later = await openSession(harness, user);
      expect(sessionRow(later.sessionId).created_at >= iso(START + 1700 * SECOND)).toBe(true);
      clock.advanceSeconds(61);
      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
      clock.advanceSeconds(1739);
      await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      await expect(harness.service.sessions.validate(later.token)).resolves.toEqual(INVALID);
    });

    it('[S48] cleans up only ended sessions beyond the retention period, never active ones', async () => {
      const harness = await startedService();
      const alice = await provision(harness);
      const bruno = await provision(harness);
      const loggedOut = await openSession(harness, alice);
      await harness.service.sessions.logout(loggedOut.token);
      const abandoned = await openSession(harness, alice);
      clock.advanceSeconds(31 * 86400);
      const active = await openSession(harness, alice);
      const recent = await openSession(harness, bruno);
      await harness.service.sessions.logout(recent.token);

      await expect(harness.service.identityProvisioning.sessions.cleanupSessions()).resolves.toBe(1);

      expect(sessionCount(`id = '${loggedOut.sessionId}'`)).toBe(0);
      expect(sessionRow(abandoned.sessionId).revocation_reason).toBe('absolute-timeout');
      expect(sessionRow(recent.sessionId).revocation_reason).toBe('logout');
      await expect(harness.service.sessions.validate(active.token)).resolves.toMatchObject({ ok: true });
      clock.advanceSeconds(1800);
      await expect(harness.service.identityProvisioning.sessions.expireSessions()).resolves.toBe(1);
      expect(sessionRow(active.sessionId).revocation_reason).toBe('idle-timeout');
      await expect(harness.service.identityProvisioning.sessions.cleanupSessions()).resolves.toBe(0);
      expect(sessionCount()).toBe(3);
    });

    /*
     * E1.07-C-R1 (RV-01, PD-45): reprodução da revisão E1.07-C-M sobre o serviço. S47b é o teste
     * proposto pelo revisor, alargado às restantes expirações; S47c repete saltos nos dois
     * sentidos; S47d cobre o reinício.
     */
    it('[S47b] expires sessions and proofs normally after a 30-day forward jump followed by a correction', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const { sessions } = harness.service;
      const before = await openSession(harness, user);
      clock.set(iso(START + 30 * 86400 * SECOND));
      await expect(sessions.validate(before.token)).resolves.toEqual(INVALID);
      clock.set(iso(START + 5 * SECOND));

      // Comprovativo e sessão emitidos depois da correcção.
      const lateProof = await login(harness, user);
      const exactProof = await login(harness, user);
      const idle = await openSession(harness, user);
      const created = sessionRow(idle.sessionId).created_at;
      clock.advanceSeconds(60);
      await expect(sessions.create(exactProof)).resolves.toMatchObject({ ok: true });
      clock.advanceSeconds(1);
      await expect(sessions.create(lateProof)).resolves.toEqual(REQUIRED);

      // Inactividade: válida até 1 799 s, inválida aos 1 800 s, sem prolongamento por tentativas.
      clock.advanceSeconds(1799 - 61);
      await expect(sessions.validate(idle.token)).resolves.toMatchObject({ ok: true });
      clock.advanceSeconds(1);
      await expect(sessions.validate(idle.token)).resolves.toEqual(INVALID);
      await expect(sessions.registerActivity(idle.token)).resolves.toEqual(INVALID);
      expect(sessionRow(idle.sessionId).last_activity_at).toBe(created);
      // A sessão anterior ao salto (absoluta) e a inactiva (inactividade) ficam marcadas.
      await expect(harness.service.identityProvisioning.sessions.expireSessions()).resolves.toBe(2);
      expect(sessionRow(idle.sessionId).revocation_reason).toBe('idle-timeout');

      // Duração absoluta: 12 h depois da criação, mesmo com actividade contínua.
      const busy = await openSession(harness, user);
      for (let elapsed = 0; elapsed + 1500 < 43200; elapsed += 1500) {
        clock.advanceSeconds(1500);
        await expect(sessions.registerActivity(busy.token)).resolves.toMatchObject({ ok: true });
      }
      clock.advanceSeconds(43200 - 28 * 1500);
      await expect(sessions.validate(busy.token)).resolves.toEqual(INVALID);
      await expect(sessions.registerActivity(busy.token)).resolves.toEqual(INVALID);
      // A sessão `busy` e a criada com o comprovativo aos 60 s terminaram pela duração absoluta.
      await expect(harness.service.identityProvisioning.sessions.expireSessions()).resolves.toBe(2);
      expect(sessionRow(busy.sessionId).revocation_reason).toBe('absolute-timeout');
    });

    it('[S47c] never extends a validity across repeated forward and backward jumps', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      let previousCreation = '';
      for (const jumpSeconds of [3600, -7200, 86400, -2 * 86400, 30 * 86400, -30 * 86400, -365 * 86400]) {
        clock.set(iso(clock.now().getTime() + jumpSeconds * SECOND));
        const proof = await login(harness, user);
        const session = await openSession(harness, user);
        const created = sessionRow(session.sessionId).created_at;
        expect(created >= previousCreation).toBe(true);
        previousCreation = created;

        clock.advanceSeconds(61);
        await expect(harness.service.sessions.create(proof)).resolves.toEqual(REQUIRED);
        clock.advanceSeconds(1799 - 61);
        await expect(harness.service.sessions.validate(session.token)).resolves.toMatchObject({ ok: true });
        clock.advanceSeconds(1);
        await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      }
    });

    it('[S47d] keeps expiring normally after a restart, including a process started with the clock ahead', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const old = await openSession(harness, user);
      clock.set(iso(START + 30 * 86400 * SECOND));
      await expect(harness.service.sessions.validate(old.token)).resolves.toEqual(INVALID);
      clock.set(iso(START + 10 * SECOND));
      await harness.service.stop();
      await harness.service.start();
      await expect(harness.service.sessions.validate(old.token)).resolves.toEqual(INVALID);
      expect(sessionRow(old.sessionId).revocation_reason).toBe('service-restarted');
      const afterRestart = await openSession(harness, user);
      clock.advanceSeconds(1800);
      await expect(harness.service.sessions.validate(afterRestart.token)).resolves.toEqual(INVALID);
      await harness.service.stop();

      // Novo processo criado com o relógio de parede 30 dias adiantado, depois corrigido.
      clock.set(iso(START + 30 * 86400 * SECOND));
      const ahead = await startedService();
      clock.set(iso(START + 2000 * SECOND));
      const proof = await login(ahead, user);
      const session = await openSession(ahead, user);
      clock.advanceSeconds(61);
      await expect(ahead.service.sessions.create(proof)).resolves.toEqual(REQUIRED);
      clock.advanceSeconds(1799 - 61);
      await expect(ahead.service.sessions.validate(session.token)).resolves.toMatchObject({ ok: true });
      clock.advanceSeconds(1);
      await expect(ahead.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
    });

    /*
     * E1.07-C-R1 (RV-04, PD-47, D-125): o relógio de parede não decide sozinho eliminações
     * irreversíveis. O arranque já não elimina registos; a limpeza explícita usa o instante mais
     * antigo plausível. A expiração e o limite de sessões não mudam.
     */
    it('[S48b] never deletes ended sessions because of a one-year forward jump, at startup or during the run', async () => {
      const harness = await startedService({ sessionPolicy: { maxActiveSessionsPerUser: 2 } });
      const user = await provision(harness);
      const loggedOut = await openSession(harness, user);
      await harness.service.sessions.logout(loggedOut.token);
      const abandoned = await openSession(harness, user);
      const yearAhead = START + 366 * 86400 * SECOND;

      // Durante o arranque: a expiração é conservadora, a eliminação não acontece.
      clock.set(iso(yearAhead));
      await expect(harness.service.identityProvisioning.sessions.cleanupSessions()).resolves.toBe(0);
      expect(sessionRow(abandoned.sessionId).revocation_reason).toBe('absolute-timeout');
      expect(sessionCount()).toBe(2);

      // Reinício e novo processo com o relógio um ano adiantado: nada é eliminado no arranque.
      await harness.service.stop();
      await harness.service.start();
      expect(sessionCount()).toBe(2);
      await harness.service.stop();
      const ahead = await startedService({ sessionPolicy: { maxActiveSessionsPerUser: 2 } });
      expect(sessionCount()).toBe(2);
      const resets = [...harness.records(), ...ahead.records()].filter((record) => record['event'] === 'service.sessions_reset');
      expect(resets).toHaveLength(3);
      for (const reset of resets) expect(reset).toMatchObject({ removedSessions: 0, startupDeletion: 'suspended' });

      // O limite e a expiração continuam a funcionar com os registos retidos.
      const first = await openSession(ahead, user);
      await openSession(ahead, user);
      await expect(ahead.service.sessions.create(await login(ahead, user))).resolves.toEqual(LIMIT);
      clock.advanceSeconds(1800);
      await expect(ahead.service.sessions.validate(first.token)).resolves.toEqual(INVALID);
      await expect(openSession(ahead, user)).resolves.toHaveProperty('token');
    });

    it('[S48c] cleans up normally under controlled time in a new process after the retention period', async () => {
      const first = await startedService();
      const user = await provision(first);
      const loggedOut = await openSession(first, user);
      await first.service.sessions.logout(loggedOut.token);
      const kept = await openSession(first, user);
      await first.service.stop();

      clock.advanceSeconds(31 * 86400);
      const later = await startedService();
      expect(sessionCount()).toBe(2);
      // Só a sessão terminada há mais de 30 dias é eliminada; a revogada neste arranque fica retida.
      await expect(later.service.identityProvisioning.sessions.cleanupSessions()).resolves.toBe(1);
      expect(sessionCount(`id = '${loggedOut.sessionId}'`)).toBe(0);
      expect(sessionRow(kept.sessionId).revocation_reason).toBe('service-restarted');
    });
  });

  describe('migration and security', () => {
    /** Base E1.07-B (migrações 1 a 3) com dados fictícios, criada sem o código de E1.07-C. */
    const createE107bDatabase = async () => {
      const legacy = temporary.open();
      expect(runMigrations(legacy, MIGRATIONS.slice(0, 3))).toEqual({ applied: [1, 2, 3], currentVersion: 3 });
      const user = newUser();
      legacy
        .prepare(`INSERT INTO users (id, username, display_name, email, phone, status, created_at, updated_at)
          VALUES (?, ?, ?, NULL, NULL, 'ACTIVE', ?, ?)`)
        .run(user.id, user.username, user.displayName, user.createdAt, user.updatedAt);
      const hashed = await createPasswordHasher({ parameters: TEST_HASHING_PARAMETERS }).hash(TEST_PASSWORD);
      legacy
        .prepare(`INSERT INTO password_credentials (user_id, algorithm, algorithm_version, memory_kib, passes, parallelism,
          salt, hash, created_at, updated_at) VALUES (?, 'argon2id', 19, ?, ?, ?, ?, ?, ?, ?)`)
        .run(user.id, hashed.memoryKiB, hashed.passes, hashed.parallelism, hashed.salt, hashed.hash, user.createdAt, user.createdAt);
      legacy
        .prepare('INSERT INTO installation_bootstrap (id, initial_administrator_id, completed_at) VALUES (1, ?, ?)')
        .run(user.id, user.createdAt);
      const company = newCompany();
      legacy
        .prepare(`INSERT INTO companies (id, tenant_id, jurisdiction, legal_name, trade_name, nif, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`)
        .run(company.id, company.tenantId, company.jurisdiction, company.legalName, company.nif ?? null, company.status, company.createdAt, company.updatedAt);
      const branch = branchInput(company);
      legacy
        .prepare(`INSERT INTO branches (id, tenant_id, company_id, name, code, sector_type, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(branch.id, branch.tenantId, branch.companyId, branch.name, branch.code, branch.sectorType, branch.status, branch.createdAt, branch.createdAt);
      const membership = newCompanyMembership(user, company);
      legacy
        .prepare(`INSERT INTO company_memberships (id, user_id, tenant_id, company_id, scope, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(membership.id, user.id, company.tenantId, company.id, membership.scope, membership.status, membership.createdAt, membership.updatedAt);
      const snapshot = (database: SqliteDatabase) => ({
        branches: database.prepare('SELECT * FROM branches ORDER BY id').all(),
        companies: database.prepare('SELECT * FROM companies ORDER BY id').all(),
        credentials: database
          .prepare(`SELECT user_id, algorithm, algorithm_version, memory_kib, passes, parallelism, salt, hash, created_at, updated_at
            FROM password_credentials ORDER BY user_id`)
          .all(),
        memberships: database.prepare('SELECT * FROM company_memberships ORDER BY id').all(),
        throttle: database.prepare('SELECT * FROM authentication_throttle ORDER BY throttle_key').all(),
        bootstrap: database.prepare('SELECT * FROM installation_bootstrap').all(),
        users: database
          .prepare('SELECT id, username, display_name, email, phone, status, created_at, updated_at FROM users ORDER BY id')
          .all(),
      });
      const before = snapshot(legacy);
      legacy.close();
      return { before, snapshot, user };
    };

    const fileHash = (): string => createHash('sha256').update(readFileSync(temporary.filename)).digest('hex');

    it('[S49] migrates an E1.07-B database to version 4 preserving every record', async () => {
      const { before, snapshot } = await createE107bDatabase();

      const upgraded = temporary.open();
      // E1.07-C-R1: a migração 5 existe; este teste fixa explicitamente o esquema E1.07-C (1 a 4).
      expect(inspectMigrations(upgraded, MIGRATIONS.slice(0, 4))).toMatchObject({ appliedVersions: [1, 2, 3], pendingVersions: [4] });
      expect(runMigrations(upgraded, MIGRATIONS.slice(0, 4))).toEqual({ applied: [4], currentVersion: 4 });

      expect(snapshot(upgraded)).toEqual(before);
      expect(upgraded.prepare('SELECT DISTINCT security_version FROM users').pluck().all()).toEqual([1]);
      expect(upgraded.prepare('SELECT DISTINCT credential_version FROM password_credentials').pluck().all()).toEqual([1]);
      expect(upgraded.prepare('SELECT count(*) FROM local_sessions').pluck().get()).toBe(0);
      expect(runMigrations(upgraded, MIGRATIONS.slice(0, 4))).toEqual({ applied: [], currentVersion: 4 });
    });

    it('[S50] keeps migrations 1 to 3 exactly as published', async () => {
      await createE107bDatabase();
      const upgraded = temporary.open();
      runMigrations(upgraded);

      expect(MIGRATIONS.slice(0, 3).map((migration) => ({ checksum: migrationChecksum(migration), version: migration.version }))).toEqual(
        PUBLISHED_CHECKSUMS,
      );
      expect(upgraded.prepare('SELECT version, checksum FROM schema_migrations WHERE version < 4 ORDER BY version').all()).toEqual(
        PUBLISHED_CHECKSUMS,
      );
      expect(MIGRATIONS[3]).toMatchObject({ name: 'create_sessions_and_security_versions', version: 4 });
    });

    it('[S51] preserves credentials without re-hashing or requiring a password reset', async () => {
      const { before, snapshot } = await createE107bDatabase();
      const upgraded = temporary.open();
      runMigrations(upgraded);

      expect(snapshot(upgraded).credentials).toEqual(before.credentials);
      expect(before.credentials).toHaveLength(1);
    });

    it('[S52] refuses the pending migration under the strict policy and authenticates after applying it', async () => {
      const { user } = await createE107bDatabase();
      const hashBefore = fileHash();
      const strict = createServiceUnderTest(
        serviceConfig(temporary.filename, { startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'fail' } }),
        undefined,
        dependencies(),
      );
      running.push(strict);

      await expect(strict.service.start()).rejects.toMatchObject({ reason: 'pending-migrations' });
      expect(fileHash()).toBe(hashBefore);

      const harness = await startedService();
      // E1.07-C-R1: uma base E1.07-B recebe as migrações 4 e 5 (e, desde E1.07-D2, a 6).
      expect(harness.service.startupReport).toMatchObject({ appliedMigrations: [4, 5, 6, 7, 8, 9], schemaVersion: 9 });
      const session = await openSession(harness, user);
      await expect(harness.service.sessions.validate(session.token)).resolves.toMatchObject({ session: { userId: user.id } });
    });

    it('[S53] rolls back a failing migration and failing session transactions', async () => {
      await createE107bDatabase();
      const database = temporary.open();
      const broken = { ...MIGRATIONS[3], sql: `${MIGRATIONS[3]?.sql ?? ''}\nSELECT * FROM missing_table;` } as (typeof MIGRATIONS)[number];

      expect(() => runMigrations(database, [...MIGRATIONS.slice(0, 3), broken])).toThrow(/missing_table/);

      // E1.07-C-R1: com a migração 5, ficam pendentes a 4 (revertida) e a 5 (e, desde E1.07-D2, a 6).
      expect(inspectMigrations(database)).toMatchObject({ appliedVersions: [1, 2, 3], pendingVersions: [4, 5, 6, 7, 8, 9] });
      expect(database.prepare("SELECT count(*) FROM pragma_table_info('users') WHERE name = 'security_version'").pluck().get()).toBe(0);
      expect(database.prepare("SELECT count(*) FROM sqlite_master WHERE name = 'local_sessions'").pluck().get()).toBe(0);
      database.close();

      const harness = await startedService();
      const user = await provision(harness);
      inspect((database) => {
        const store = createSqliteSessionStore(database);
        expect(() =>
          store.transaction(() => {
            store.revokeUserSessions(user.id, iso(START), 'administrative');
            store.advanceSecurityVersion(user.id);
            throw new Error('falha simulada');
          }),
        ).toThrow('falha simulada');
      });
      expect(versionsOf(user.id).security).toBe(1);

      execute(`CREATE TRIGGER test_block_insert BEFORE INSERT ON local_sessions
        BEGIN SELECT RAISE(ABORT, 'inserção bloqueada no teste'); END`);
      const identity = await login(harness, user);
      await expect(harness.service.sessions.create(identity)).rejects.toBeInstanceOf(PersistenceError);
      execute('DROP TRIGGER test_block_insert');
      await expect(harness.service.sessions.create(identity)).resolves.toEqual(REQUIRED);
      expect(sessionCount()).toBe(0);
    });

    it('[S54] enforces referential integrity, immutable bindings and monotonic versions', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      await harness.service.sessions.logout((await openSession(harness, user)).token);
      const refused = (sql: string, pattern: RegExp = /constraint|cannot|immutable|final|never|requires/i): void => {
        expect(() => execute(sql)).toThrow(pattern);
      };

      refused(`INSERT INTO local_sessions (id, user_id, token_digest, security_version, credential_version, service_run_id,
        created_at, last_activity_at, absolute_expires_at) VALUES ('${newId()}', '${newId()}', randomblob(32), 1, 1,
        '${'a'.repeat(32)}', '${iso(START)}', '${iso(START)}', '${iso(START + SECOND)}')`, /FOREIGN KEY/);
      refused(`DELETE FROM users WHERE id = '${user.id}'`, /never deleted/);
      refused(`DELETE FROM password_credentials WHERE user_id = '${user.id}'`);
      for (const assignment of [
        `user_id = '${newId()}'`,
        'token_digest = randomblob(32)',
        'security_version = 2',
        'credential_version = 2',
        `service_run_id = '${'b'.repeat(32)}'`,
        `absolute_expires_at = '${iso(START + 86400 * SECOND)}'`,
        `created_at = '${iso(START - SECOND)}'`,
      ]) {
        refused(`UPDATE local_sessions SET ${assignment} WHERE id = '${session.sessionId}'`);
      }
      refused("UPDATE local_sessions SET revoked_at = NULL, revocation_reason = NULL WHERE revoked_at IS NOT NULL");
      refused(`UPDATE local_sessions SET revoked_at = '${iso(START)}' WHERE id = '${session.sessionId}'`);
      refused(`UPDATE local_sessions SET revoked_at = '${iso(START)}', revocation_reason = 'other' WHERE id = '${session.sessionId}'`);
      refused(`UPDATE users SET security_version = 0 WHERE id = '${user.id}'`);
      refused(`UPDATE password_credentials SET credential_version = 0 WHERE user_id = '${user.id}'`);
      refused(`UPDATE password_credentials SET hash = randomblob(32) WHERE user_id = '${user.id}'`);
      refused(`UPDATE password_credentials SET salt = randomblob(16) WHERE user_id = '${user.id}'`);

      expect(sessionCount()).toBe(2);
      inspect((database) => {
        expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(database.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
        const reasons = (database.prepare("SELECT sql FROM sqlite_master WHERE name = 'local_sessions'").pluck().get() as string)
          .match(/'([a-z-]+)'/g)
          ?.map((quoted) => quoted.slice(1, -1));
        expect(reasons).toEqual([...SESSION_REVOCATION_REASONS]);
      });
      await expect(harness.service.sessions.validate(session.token)).resolves.toMatchObject({ ok: true });
    });

    it('[S55] never writes tokens or digests to logs, results or errors', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const first = await openSession(harness, user);
      const second = await openSession(harness, user);
      const outputs: unknown[] = [
        await harness.service.sessions.validate(first.token),
        await harness.service.sessions.registerActivity(first.token),
        await harness.service.sessions.validate(`${first.token}x`),
      ];
      await harness.service.sessions.logout(first.token);
      await harness.service.identityProvisioning.sessions.revokeSession(second.sessionId);
      const failure = await harness.service.sessions.create({} as AuthenticatedIdentity);
      await harness.service.stop();
      const notReady = await harness.service.sessions.validate(first.token).catch((error: unknown) => error);
      await harness.service.start();
      await harness.service.stop();

      const errorText = notReady instanceof Error ? `${notReady.message} ${String(notReady.stack)}` : '';
      const output = [harness.lines.join('\n'), JSON.stringify([...outputs, failure]), errorText].join('\n');
      for (const { token } of [first, second]) {
        const raw = Buffer.from(token, 'base64url');
        for (const secret of [token, sha256(raw).toString('hex'), sha256(raw).toString('base64'), raw.toString('hex')]) {
          expect(output).not.toContain(secret);
        }
      }
      expect(harness.records().filter((record) => record['event'] === 'service.sessions_reset')).toHaveLength(2);
    });

    it('[S56] grants no company access, tenant context or permission through a session', async () => {
      const harness = await startedService();
      const company = newCompany();
      const context = contextFor(company.tenantId);
      await harness.service.companies.create(context, company);
      const user = await provision(harness);
      const { initialAdministratorId } = await harness.service.identityProvisioning.installation.initialise(
        { displayName: 'Administrador Fictício', id: newId(), username: uniqueUsername('admin') },
        UNICODE_TEST_PASSWORD,
      );
      const administrator = await harness.service.identityProvisioning.users.findById(initialAdministratorId);
      if (administrator === undefined) throw new Error('Administrador esperado.');

      for (const [identity, password] of [[user, TEST_PASSWORD], [administrator, UNICODE_TEST_PASSWORD]] as const) {
        const session = await openSession(harness, identity, password);
        const validation = await harness.service.sessions.validate(session.token);
        if (!validation.ok) throw new Error('Sessão válida esperada.');
        expect(Object.keys(validation.session).sort()).toEqual(['absoluteExpiresAt', 'idleExpiresAt', 'sessionId', 'userId']);
        await expect(harness.service.membershipScopes.evaluate(context, identity.id)).resolves.toEqual({
          eligible: false,
          reason: 'no-membership',
        });
      }
      const sources = readdirSync(path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'sessions'))
        .map((file) => readFileSync(path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'sessions', file), 'utf8'))
        .join('\n');
      expect(sources).not.toMatch(/TenantContext|tenantId|companyId|branchId|\bpermissions?\b|\broles?\b/);
    });

    it('[S57] is not reachable through HTTP, IPC, Electron, the CLI or the desktop', () => {
      const sourcesOf = (...segments: string[]): readonly string[] =>
        readdirSync(path.join(REPOSITORY_ROOT, ...segments), { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && /\.(ts|tsx|cts)$/.test(entry.name))
          .map((entry) => path.join(entry.parentPath, entry.name));
      const sessionFiles = [
        ...sourcesOf('services', 'local-api', 'src', 'sessions'),
        path.join(REPOSITORY_ROOT, 'packages', 'database', 'src', 'sqlite-session-store.ts'),
        path.join(REPOSITORY_ROOT, 'packages', 'shared-types', 'src', 'session.ts'),
      ];
      const forbidden = /from '(electron|fastify|node:(http|https|http2|net|tls|dgram|dns|child_process))'|\bfetch\(|ipcMain|ipcRenderer|listen\(/;
      expect(sessionFiles.length).toBeGreaterThanOrEqual(6);
      for (const file of sessionFiles) expect(readFileSync(file, 'utf8')).not.toMatch(forbidden);

      const exposed = [
        ...sourcesOf('apps', 'desktop', 'src'),
        ...sourcesOf('apps', 'admin-portal', 'src'),
        ...sourcesOf('services', 'central-api', 'src'),
        path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'app.ts'),
        path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'cli.ts'),
        path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'main.ts'),
      ];
      const sessionApi = /\.sessions\b|createLocalSessions|SessionAdministration|registerActivity|revokeUserSessions|local-sessions|sqlite-session-store|createSqliteSessionStore|session-token/;
      for (const file of exposed) expect(readFileSync(file, 'utf8')).not.toMatch(sessionApi);
    });

    it('[S58] works without network access and opens no ports', async () => {
      const connect = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => {
        throw new Error('rede proibida');
      });
      const listen = vi.spyOn(net.Server.prototype, 'listen').mockImplementation(() => {
        throw new Error('portas proibidas');
      });
      const lookup = vi.spyOn(dns, 'lookup').mockImplementation(() => {
        throw new Error('DNS proibido');
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('fetch proibido')));
      try {
        const harness = await startedService();
        const user = await provision(harness);
        const session = await openSession(harness, user);
        await expect(harness.service.sessions.registerActivity(session.token)).resolves.toMatchObject({ ok: true });
        await harness.service.sessions.logout(session.token);
        await harness.service.identityProvisioning.sessions.cleanupSessions();
        await harness.service.stop();
        await harness.service.start();
      } finally {
        connect.mockRestore();
        listen.mockRestore();
        lookup.mockRestore();
        fetchSpy.mockRestore();
      }

      expect(connect).not.toHaveBeenCalled();
      expect(listen).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    /*
     * E1.07-C-R1 (RV-05, PD-48): testes que detectam as mutações R4, R5, R6 e R9 da revisão
     * E1.07-C-M, cada uma isoladamente, pelo comportamento observável.
     */
    it('[S59] creates a session right after an automatic parameter recalculation (R4)', async () => {
      const first = await startedService();
      const user = await provision(first);
      await first.service.stop();

      const upgraded = await startedService({ passwordHashing: { parameters: { ...TEST_HASHING_PARAMETERS, passes: 3 } } });
      const identity = await login(upgraded, user);
      expect(versionsOf(user.id)).toEqual({ credential: 2, security: 1 });
      const created = await upgraded.service.sessions.create(identity);
      if (!created.ok) throw new Error(`Sessão esperada após o recálculo: ${created.reason}.`);
      expect(sessionRow(created.session.sessionId)).toMatchObject({ credential_version: 2, security_version: 1 });
      await expect(upgraded.service.sessions.validate(created.session.token)).resolves.toMatchObject({ ok: true });
      // A autenticação seguinte já não recalcula: a sessão existente mantém-se válida.
      await expect(openSession(upgraded, user)).resolves.toHaveProperty('token');
      expect(versionsOf(user.id)).toEqual({ credential: 2, security: 1 });
      await expect(upgraded.service.sessions.validate(created.session.token)).resolves.toMatchObject({ ok: true });
    });

    /** Insere directamente uma sessão (registo adulterado) com um token conhecido. */
    const insertForgedSession = (
      model: SessionRow,
      values: { readonly createdAt: string; readonly lastActivityAt: string; readonly absoluteExpiresAt: string },
    ): string => {
      const forged = generateSessionToken();
      inspect((database) =>
        database
          .prepare(`INSERT INTO local_sessions (id, user_id, token_digest, security_version, credential_version,
            service_run_id, created_at, last_activity_at, absolute_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(newId(), model.user_id, forged.digest, model.security_version, model.credential_version, model.service_run_id,
            values.createdAt, values.lastActivityAt, values.absoluteExpiresAt),
      );
      return forged.token;
    };

    it('[S60] never honours a stored absolute expiry beyond the policy ceiling (R5)', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const genuine = await openSession(harness, user);
      const token = insertForgedSession(sessionRow(genuine.sessionId), {
        absoluteExpiresAt: iso(START + 24 * 3600 * SECOND),
        createdAt: iso(START),
        lastActivityAt: iso(START),
      });

      await expect(harness.service.sessions.validate(token)).resolves.toMatchObject({
        ok: true,
        session: { absoluteExpiresAt: iso(START + 12 * 3600 * SECOND) },
      });
      for (let step = 0; step < 28; step += 1) {
        clock.advanceSeconds(1500);
        await expect(harness.service.sessions.registerActivity(token)).resolves.toMatchObject({ ok: true });
      }
      clock.advanceSeconds(43200 - 28 * 1500);
      await expect(harness.service.sessions.validate(token)).resolves.toEqual(INVALID);
      await expect(harness.service.sessions.registerActivity(token)).resolves.toEqual(INVALID);
    });

    it('[S61] rejects stored sessions dated after the effective instant (R6)', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      const model = sessionRow(session.sessionId);

      // Actividade adulterada para o futuro (aceite pelos triggers: avança e fica antes da expiração).
      execute(`UPDATE local_sessions SET last_activity_at = '${iso(START + 3600 * SECOND)}' WHERE id = '${session.sessionId}'`);
      await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
      await expect(harness.service.sessions.registerActivity(session.token)).resolves.toEqual(INVALID);
      // Sessão adulterada criada no futuro.
      const future = insertForgedSession(model, {
        absoluteExpiresAt: iso(START + 3600 * SECOND + 43200 * SECOND),
        createdAt: iso(START + 3600 * SECOND),
        lastActivityAt: iso(START + 3600 * SECOND),
      });
      await expect(harness.service.sessions.validate(future)).resolves.toEqual(INVALID);
    });

    it('[S62] refuses a proof issued after the current instant of an injected non-monotonic clock (R9)', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const identity = await login(harness, user);
      const versions = versionsOf(user.id);
      // Composição directa sem o serviço: este liberta a base antes (E1.07-X).
      await harness.service.stop();
      const database = temporary.open();
      try {
        const store = createSqliteSessionStore(database);
        const runId = 'c'.repeat(32);
        const instant = START + 10 * SECOND;
        let issuedAt = instant + SECOND;
        // Composição directa do módulo com um relógio que não respeita a monotonia: o comprovativo
        // foi emitido 1 s "depois" do instante corrente (idade negativa).
        const backend: SessionBackend = {
          acquire: () => ({ serviceRunId: runId, store }),
          now: Object.assign(() => instant, { earliestPlausible: () => instant }),
          policy: DEFAULT_SESSION_POLICY,
          proofs: {
            consume: (value: unknown) =>
              value === identity
                ? { credentialVersion: versions.credential, issuedAt, securityVersion: versions.security, serviceRunId: runId, userId: user.id }
                : undefined,
            register: () => undefined,
          },
        };
        const sessions = createLocalSessions(backend);

        await expect(sessions.create(identity)).resolves.toEqual(REQUIRED);
        expect(sessionCount()).toBe(0);
        // Controlo: o mesmo comprovativo emitido no instante corrente é aceite.
        issuedAt = instant;
        await expect(sessions.create(identity)).resolves.toMatchObject({ ok: true });
      } finally {
        database.close();
      }
    });

    /*
     * E1.07-C-R1 (RV-03, PD-46, D-126): a migração 5 impede reinserções que reponham versões de
     * segurança ou anulem revogações, em qualquer configuração de `foreign_keys` e
     * `recursive_triggers`. Escrita SQL directa sobre a base temporária do teste.
     */
    const PRAGMA_CONFIGURATIONS = [
      { foreignKeys: true, recursiveTriggers: false },
      { foreignKeys: true, recursiveTriggers: true },
      { foreignKeys: false, recursiveTriggers: false },
      { foreignKeys: false, recursiveTriggers: true },
    ] as const;

    const executeWith = (configuration: (typeof PRAGMA_CONFIGURATIONS)[number], sql: string): void => {
      inspect((database) => {
        database.pragma(`foreign_keys = ${configuration.foreignKeys ? 'ON' : 'OFF'}`);
        database.pragma(`recursive_triggers = ${configuration.recursiveTriggers ? 'ON' : 'OFF'}`);
        database.exec(sql);
      });
    };

    const credentialValues = (userId: string, version?: number): string =>
      `('${userId}', 'argon2id', 19, 19456, 2, 1, randomblob(16), randomblob(32), '${iso(START)}', '${iso(START)}'${
        version === undefined ? '' : `, ${version}`
      })`;
    const CREDENTIAL_COLUMNS =
      '(user_id, algorithm, algorithm_version, memory_kib, passes, parallelism, salt, hash, created_at, updated_at';

    it('[S63] refuses credential re-insertion through REPLACE, UPSERT, duplicate INSERT or DELETE then INSERT', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      await harness.service.identityProvisioning.credentials.replace(user.id, OTHER_TEST_PASSWORD);
      const session = await openSession(harness, user, OTHER_TEST_PASSWORD);
      expect(versionsOf(user.id)).toEqual({ credential: 2, security: 1 });
      const attacks = [
        `INSERT OR REPLACE INTO password_credentials ${CREDENTIAL_COLUMNS}) VALUES ${credentialValues(user.id)}`,
        `REPLACE INTO password_credentials ${CREDENTIAL_COLUMNS}) VALUES ${credentialValues(user.id)}`,
        `INSERT INTO password_credentials ${CREDENTIAL_COLUMNS}) VALUES ${credentialValues(user.id)}`,
        `INSERT INTO password_credentials ${CREDENTIAL_COLUMNS}) VALUES ${credentialValues(user.id)}
          ON CONFLICT (user_id) DO UPDATE SET credential_version = 1, hash = excluded.hash`,
        `INSERT OR REPLACE INTO password_credentials ${CREDENTIAL_COLUMNS}, credential_version) VALUES ${credentialValues(user.id, 9)}`,
        `DELETE FROM password_credentials WHERE user_id = '${user.id}';
          INSERT INTO password_credentials ${CREDENTIAL_COLUMNS}) VALUES ${credentialValues(user.id)}`,
      ];

      for (const configuration of PRAGMA_CONFIGURATIONS) {
        for (const sql of attacks) {
          // Transacção explícita: a ligação é fechada depois da recusa, o que anula qualquer passo parcial.
          expect(() => executeWith(configuration, `BEGIN; ${sql}; COMMIT;`)).toThrow(/re-inserted|never deleted/);
          expect(versionsOf(user.id)).toEqual({ credential: 2, security: 1 });
          expect(sessionRow(session.sessionId).revoked_at).toBeNull();
        }
      }
      await expect(harness.service.sessions.validate(session.token)).resolves.toMatchObject({ ok: true });
      await expect(login(harness, user, OTHER_TEST_PASSWORD)).resolves.toBeDefined();

      // Alterações legítimas continuam a funcionar: substituição avança a versão e revoga.
      await harness.service.identityProvisioning.credentials.replace(user.id, TEST_PASSWORD);
      expect(versionsOf(user.id)).toEqual({ credential: 3, security: 1 });
      expect(sessionRow(session.sessionId).revocation_reason).toBe('credential-replaced');
      await expect(openSession(harness, user)).resolves.toHaveProperty('token');
      const other = await provision(harness);
      expect(versionsOf(other.id)).toEqual({ credential: 1, security: 1 });
      inspect((database) => {
        expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(database.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
      });
    });

    it('[S64] refuses identity and session re-insertion, re-keying and revocation reversal', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const other = await provision(harness);
      await harness.service.identityProvisioning.users.changeStatus(user.id, 'SUSPENDED', clock.now());
      await harness.service.identityProvisioning.users.changeStatus(user.id, 'ACTIVE', clock.now());
      const active = await openSession(harness, user);
      const revoked = await openSession(harness, user);
      await harness.service.sessions.logout(revoked.token);
      expect(versionsOf(user.id)).toEqual({ credential: 1, security: 3 });
      const userValues = `('${user.id}', '${user.username}', 'Nome Fictício', NULL, NULL, 'ACTIVE', '${iso(START)}', '${iso(START)}')`;
      const userColumns = '(id, username, display_name, email, phone, status, created_at, updated_at)';
      const attacks = [
        `REPLACE INTO users ${userColumns} VALUES ${userValues}`,
        `INSERT OR REPLACE INTO users ${userColumns} VALUES ${userValues}`,
        `INSERT INTO users ${userColumns} VALUES ('${newId()}', '${user.username}', 'Outro', NULL, NULL, 'ACTIVE', '${iso(START)}', '${iso(START)}')`,
        `REPLACE INTO local_sessions SELECT id, user_id, token_digest, security_version, credential_version, service_run_id,
          created_at, last_activity_at, absolute_expires_at, NULL, NULL FROM local_sessions WHERE id = '${revoked.sessionId}'`,
        // PD-51: identificador novo com o digest da sessão revogada; só a cláusula do digest o recusa.
        `REPLACE INTO local_sessions SELECT '${newId()}', user_id, token_digest, security_version, credential_version,
          service_run_id, created_at, last_activity_at, absolute_expires_at, NULL, NULL
          FROM local_sessions WHERE id = '${revoked.sessionId}'`,
        `UPDATE users SET id = '${newId()}' WHERE id = '${user.id}'`,
        `UPDATE OR REPLACE password_credentials SET user_id = '${user.id}', credential_version = 9 WHERE user_id = '${other.id}'`,
      ];

      for (const configuration of PRAGMA_CONFIGURATIONS) {
        for (const sql of attacks) {
          expect(() => executeWith(configuration, sql)).toThrow(/re-inserted|immutable/);
          expect(versionsOf(user.id)).toEqual({ credential: 1, security: 3 });
          expect(versionsOf(other.id)).toEqual({ credential: 1, security: 1 });
          expect(sessionRow(revoked.sessionId).revocation_reason).toBe('logout');
          expect(sessionRow(active.sessionId).revoked_at).toBeNull();
          expect(inspect((database) => database.prepare('SELECT count(*) FROM local_sessions').pluck().get())).toBe(2);
        }
      }
      await expect(harness.service.sessions.validate(active.token)).resolves.toMatchObject({ ok: true });
      await expect(harness.service.sessions.validate(revoked.token)).resolves.toEqual(INVALID);
    });

    it('[S65] never reuses a version after a deletion outside the normal configuration and revokes what remains', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      await harness.service.stop();
      const userColumns = '(id, username, display_name, email, phone, status, created_at, updated_at';
      const userValues = `'${user.id}', '${user.username}', 'Nome Fictício', NULL, NULL, 'ACTIVE', '${iso(START)}', '${iso(START)}'`;
      const withoutForeignKeys = PRAGMA_CONFIGURATIONS[2];

      // E1.07-D3-G0 (migração 8, PD-75): mesmo com `foreign_keys` desligado, a identidade não é eliminada.
      expect(() => executeWith(withoutForeignKeys, `DELETE FROM users WHERE id = '${user.id}'`)).toThrow(/never deleted/);
      expect(sessionRow(session.sessionId).revoked_at).toBeNull();

      // Fora da fronteira de confiança (trigger da migração 8 retirado), a migração 5 continua a
      // garantir que a reinserção não reutiliza a versão ligada à sessão e revoga a sessão que restar.
      execute('DROP TRIGGER users_never_deleted');
      executeWith(withoutForeignKeys, `DELETE FROM users WHERE id = '${user.id}'`);
      expect(() => executeWith(withoutForeignKeys, `INSERT INTO users ${userColumns}) VALUES (${userValues})`)).toThrow(
        /never reuse a security_version/,
      );
      executeWith(withoutForeignKeys, `INSERT INTO users ${userColumns}, security_version) VALUES (${userValues}, 2)`);
      expect(sessionRow(session.sessionId).revocation_reason).toBe('security-version-changed');

      // Fora da fronteira de confiança (trigger de eliminação retirado): a credencial reinserida
      // também não reutiliza a versão nem deixa sessões activas.
      const second = await startedService();
      const later = await openSession(second, user);
      await second.service.stop();
      execute('DROP TRIGGER password_credentials_never_deleted');
      execute(`DELETE FROM password_credentials WHERE user_id = '${user.id}'`);
      expect(() => execute(`INSERT INTO password_credentials ${CREDENTIAL_COLUMNS}) VALUES ${credentialValues(user.id)}`)).toThrow(
        /never reuse a credential_version/,
      );
      execute(`INSERT INTO password_credentials ${CREDENTIAL_COLUMNS}, credential_version) VALUES ${credentialValues(user.id, 2)}`);
      expect(sessionRow(later.sessionId).revocation_reason).toBe('credential-replaced');
    });

    /** Base E1.07-C (migrações 1 a 4) com versões avançadas e sessões, criada sem a migração 5. */
    const createE107cDatabase = async () => {
      const { user } = await createE107bDatabase();
      const legacy = temporary.open();
      expect(runMigrations(legacy, MIGRATIONS.slice(0, 4))).toEqual({ applied: [4], currentVersion: 4 });
      legacy.exec(`UPDATE users SET status = 'SUSPENDED', updated_at = '${iso(START)}' WHERE id = '${user.id}';
        UPDATE users SET status = 'ACTIVE', updated_at = '${iso(START)}' WHERE id = '${user.id}';
        UPDATE password_credentials SET credential_version = 2, updated_at = '${user.createdAt}' WHERE user_id = '${user.id}';`);
      const insert = legacy.prepare(`INSERT INTO local_sessions (id, user_id, token_digest, security_version, credential_version,
        service_run_id, created_at, last_activity_at, absolute_expires_at, revoked_at, revocation_reason)
        VALUES (?, ?, randomblob(32), 3, 2, ?, ?, ?, ?, ?, ?)`);
      insert.run(newId(), user.id, 'd'.repeat(32), iso(START), iso(START), iso(START + 43200 * SECOND), null, null);
      insert.run(newId(), user.id, 'd'.repeat(32), iso(START), iso(START), iso(START + 43200 * SECOND), iso(START), 'logout');
      const snapshot = (database: SqliteDatabase) => ({
        credentials: database.prepare('SELECT * FROM password_credentials ORDER BY user_id').all(),
        migrations: database.prepare('SELECT version, name, checksum, applied_at FROM schema_migrations WHERE version <= 4 ORDER BY version').all(),
        sessions: database.prepare('SELECT * FROM local_sessions ORDER BY id').all(),
        users: database.prepare('SELECT * FROM users ORDER BY id').all(),
        others: ['companies', 'branches', 'company_memberships', 'installation_bootstrap', 'authentication_throttle'].map((table) =>
          database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all(),
        ),
      });
      const before = snapshot(legacy);
      legacy.close();
      return { before, snapshot, user };
    };

    it('[S66] migrates an E1.07-B database directly to version 5 and keeps migrations 1 to 4 as published', async () => {
      const { before, snapshot } = await createE107bDatabase();
      const upgraded = temporary.open();

      // E1.07-D2: a actualização directa aplica também a migração 6.
      expect(runMigrations(upgraded)).toEqual({ applied: [4, 5, 6, 7, 8, 9], currentVersion: 9 });
      expect(snapshot(upgraded)).toEqual(before);
      expect(upgraded.prepare('SELECT version, checksum FROM schema_migrations WHERE version <= 4 ORDER BY version').all()).toEqual([
        ...PUBLISHED_CHECKSUMS,
        { checksum: PUBLISHED_V4_CHECKSUM, version: 4 },
      ]);
      expect(MIGRATIONS[3] && migrationChecksum(MIGRATIONS[3])).toBe(PUBLISHED_V4_CHECKSUM);
      expect(MIGRATIONS[4]).toMatchObject({ name: 'protect_security_versions_against_reinsertion', version: 5 });
      expect(runMigrations(upgraded)).toEqual({ applied: [], currentVersion: 9 });
    });

    it('[S67] migrates an E1.07-C database to version 5 preserving data, versions, sessions and checksums', async () => {
      const { before, snapshot, user } = await createE107cDatabase();
      const hashBefore = fileHash();
      const strict = createServiceUnderTest(
        serviceConfig(temporary.filename, { startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'fail' } }),
        undefined,
        dependencies(),
      );
      running.push(strict);
      await expect(strict.service.start()).rejects.toMatchObject({ reason: 'pending-migrations' });
      expect(fileHash()).toBe(hashBefore);

      const upgraded = temporary.open();
      // E1.07-D2: a 6 também fica pendente; aqui aplica-se só até à 5, para verificar a 5 isoladamente.
      expect(inspectMigrations(upgraded)).toMatchObject({ appliedVersions: [1, 2, 3, 4], pendingVersions: [5, 6, 7, 8, 9] });
      expect(runMigrations(upgraded, MIGRATIONS.slice(0, 5))).toEqual({ applied: [5], currentVersion: 5 });
      expect(snapshot(upgraded)).toEqual(before);
      const latest = MIGRATIONS[4];
      if (latest === undefined) throw new Error('Migração 5 esperada.');
      expect(upgraded.prepare('SELECT checksum FROM schema_migrations WHERE version = 5').pluck().get()).toBe(
        migrationChecksum(latest),
      );
      expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(upgraded.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
      expect(upgraded.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'trigger'").pluck().get()).toBe(17);
      upgraded.close();

      const harness = await startedService();
      // E1.07-D2: o arranque aplica a migração 6, que não toca nas versões nem nas sessões.
      expect(harness.service.startupReport).toMatchObject({ appliedMigrations: [6, 7, 8, 9], schemaVersion: 9 });
      expect(versionsOf(user.id)).toEqual({ credential: 2, security: 3 });
      expect(sessionCount('revoked_at IS NULL')).toBe(0);
      const session = await openSession(harness, user);
      expect(sessionRow(session.sessionId)).toMatchObject({ credential_version: 2, security_version: 3 });
    });

    it('[S68] applies only migration 5 to an E1.07-C database under the apply policy', async () => {
      const { before, snapshot } = await createE107cDatabase();
      const harness = await startedService();

      // E1.07-D2: aplica também a migração 6, que não altera dados existentes.
      expect(harness.service.startupReport).toMatchObject({ appliedMigrations: [5, 6, 7, 8, 9], schemaVersion: 9 });
      const after = inspect(snapshot);
      expect(after.credentials).toEqual(before.credentials);
      expect(after.users).toEqual(before.users);
      expect(after.migrations).toEqual(before.migrations);
      expect(after.others).toEqual(before.others);
      // Única alteração: a sessão activa do arranque anterior fica revogada por `service-restarted`.
      expect(after.sessions.map((row) => (row as SessionRow).revocation_reason).sort()).toEqual(['logout', 'service-restarted']);
    });
  });

  describe('session policy and clock', () => {
    it('[P01] adopts the approved initial values', () => {
      expect(DEFAULT_SESSION_POLICY).toEqual({
        absoluteLifetimeSeconds: 43200,
        idleTimeoutSeconds: 1800,
        maxActiveSessionsPerUser: 5,
        proofValiditySeconds: 60,
        sessionRetentionDays: 30,
      });
      expect(parseSessionPolicy()).toEqual(DEFAULT_SESSION_POLICY);
      expect(Object.isFrozen(parseSessionPolicy({ maxActiveSessionsPerUser: 3 }))).toBe(true);
    });

    it('[P02] refuses unlimited, non-integer, out-of-range, unknown or inconsistent values', () => {
      const invalid: unknown[] = [
        null,
        [],
        'policy',
        { unknown: 1 },
        { idleTimeoutSeconds: 0 },
        { idleTimeoutSeconds: Number.POSITIVE_INFINITY },
        { idleTimeoutSeconds: 59 },
        { absoluteLifetimeSeconds: 86401 },
        { maxActiveSessionsPerUser: 0 },
        { maxActiveSessionsPerUser: 21 },
        { maxActiveSessionsPerUser: 2.5 },
        { proofValiditySeconds: 61 },
        { proofValiditySeconds: 4 },
        { sessionRetentionDays: 0 },
        { sessionRetentionDays: 366 },
        { idleTimeoutSeconds: 3600, absoluteLifetimeSeconds: 1800 },
        { maxActiveSessionsPerUser: '5' },
      ];
      for (const value of invalid) expect(() => parseSessionPolicy(value)).toThrow(DomainValidationError);
      for (const limits of Object.values(SESSION_POLICY_LIMITS)) {
        expect(Number.isSafeInteger(limits.min) && Number.isSafeInteger(limits.max) && limits.min > 0).toBe(true);
      }
      expect(() => newService({ sessionPolicy: { maxActiveSessionsPerUser: 0 } })).toThrow(DomainValidationError);
    });

    it('[P03] applies a configured policy', async () => {
      const harness = await startedService({
        sessionPolicy: { absoluteLifetimeSeconds: 300, idleTimeoutSeconds: 60, maxActiveSessionsPerUser: 1, proofValiditySeconds: 5 },
      });
      const user = await provision(harness);
      const session = await openSession(harness, user);
      const late = await login(harness, user);

      await expect(harness.service.sessions.create(await login(harness, user))).resolves.toEqual(LIMIT);
      clock.advanceSeconds(6);
      await expect(harness.service.sessions.create(late)).resolves.toEqual(REQUIRED);
      clock.advanceSeconds(54);
      await expect(harness.service.sessions.validate(session.token)).resolves.toEqual(INVALID);
    });

    it('[K01] derives a monotonic effective clock from wall and monotonic time', () => {
      let wall = START;
      let monotonic = 5000;
      const now = createSessionClock(() => new Date(wall), () => monotonic);

      expect(now()).toBe(START);
      monotonic += 1000;
      expect(now()).toBe(START + 1000);
      wall = START - 3_600_000;
      expect(now()).toBe(START + 1000);
      monotonic += 500;
      expect(now()).toBe(START + 1500);
      wall = START + 7_200_000;
      expect(now()).toBe(START + 7_200_000);
      wall = START;
      expect(now()).toBe(START + 7_200_000);
      wall = Number.NaN;
      monotonic += 10;
      // E1.07-C-R1 (RV-01): o instante continua a avançar pelo monotónico; antes ficava congelado.
      expect(now()).toBe(START + 7_200_010);
    });

    /*
     * E1.07-C-R1 (RV-01, PD-45, D-124): o instante efectivo é max(parede, anterior + Δmonotónico).
     * K02 é o teste proposto pela revisão E1.07-C-M; K03 a K05 cobrem saltos repetidos, entradas
     * inválidas, leituras de alta frequência e o instante mais antigo plausível.
     */
    it('[K02] keeps advancing by monotonic time after a forward jump followed by a correction', () => {
      let wall = START;
      let monotonic = 0;
      const now = createSessionClock(() => new Date(wall), () => monotonic);

      expect(now()).toBe(START);
      wall = START + 7_200_000;
      expect(now()).toBe(START + 7_200_000);
      wall = START;
      expect(now()).toBe(START + 7_200_000);
      monotonic += 10_000;
      wall += 10_000;
      expect(now()).toBe(START + 7_210_000);
      monotonic += 1_800_000;
      wall += 1_800_000;
      expect(now()).toBe(START + 9_010_000);
    });

    it('[K03] equals max(wall, previous + monotonic delta) under repeated jumps and invalid readings', () => {
      // Valores inteiros em milissegundos: o modelo do teste é exacto (as fracções estão em K04).
      let realTime = START;
      let realMonotonic = 1_000;
      let wall = realTime;
      let monotonic = realMonotonic;
      const now = createSessionClock(() => new Date(wall), () => monotonic);
      let expected = START;
      let highest = realMonotonic;
      let previous = now();
      expect(previous).toBe(START);

      // Gerador determinístico (LCG): sequência longa e reprodutível de perturbações.
      let seed = 0x2026_1116;
      const next = (): number => {
        seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
        return seed / 0x1_0000_0000;
      };
      const counts = { backwards: 0, forwards: 0, invalidMonotonic: 0, invalidWall: 0, regressions: 0 };
      for (let step = 0; step < 5_000; step += 1) {
        const elapsed = Math.floor(next() * 5_000);
        realTime += elapsed;
        realMonotonic += elapsed;
        const monotonicChoice = next();
        if (monotonicChoice < 0.05) {
          monotonic = Number.NaN;
          counts.invalidMonotonic += 1;
        } else if (monotonicChoice < 0.1) {
          monotonic = highest - Math.floor(next() * 10_000); // leitura que recua
          counts.regressions += 1;
        } else {
          monotonic = realMonotonic;
        }
        const wallChoice = next();
        if (wallChoice < 0.15) {
          const jump = Math.floor((next() - 0.5) * 2 * 30 * 86_400_000); // até ±30 dias
          wall = realTime + jump;
          counts[jump >= 0 ? 'forwards' : 'backwards'] += 1;
        } else if (wallChoice < 0.2) {
          wall = Number.NaN;
          counts.invalidWall += 1;
        } else {
          wall = realTime; // relógio de parede corrigido
        }

        const delta = Number.isFinite(monotonic) && monotonic > highest ? monotonic - highest : 0;
        if (delta > 0) highest = monotonic;
        expected = Number.isFinite(wall) ? Math.max(wall, expected + delta) : expected + delta;

        const value = now();
        expect(value).toBe(expected);
        expect(value - previous).toBeGreaterThanOrEqual(delta);
        if (Number.isFinite(wall)) expect(value).toBeGreaterThanOrEqual(wall);
        previous = value;
      }
      // Nada se perde nem se conta duas vezes: o instante final é o tempo real mais o maior avanço
      // de parede ainda não alcançado, nunca menos do que o tempo monotónico total.
      expect(previous - START).toBeGreaterThanOrEqual(highest - 1_000);
      expect(Object.values(counts).every((count) => count > 50)).toBe(true);
    });

    it('[K04] loses no time fractions under high-frequency readings', () => {
      const wall = START - 60_000; // relógio de parede atrás: só o monotónico faz avançar o instante
      let monotonic = 123_456.789;
      const now = createSessionClock(() => new Date(wall), () => monotonic);
      const start = now();
      const anchor = monotonic;

      // 1 000 000 leituras separadas por 100 ns (0,0001 ms), abaixo da resolução de um double perto
      // de 1,8 × 10^12 ms: somá-las leitura a leitura perderia todo o tempo decorrido.
      for (let reading = 0; reading < 1_000_000; reading += 1) {
        monotonic += 0.000_1;
        now();
      }

      const value = now();
      expect(Math.abs(value - start - (monotonic - anchor))).toBeLessThan(0.001);
      expect(Math.abs(value - start - 100)).toBeLessThan(0.01);
      // Unidades: 30 minutos monotónicos (1 800 000 ms) são exactamente 30 minutos efectivos.
      monotonic += 1_800_000;
      expect(Math.abs(now() - value - 1_800_000)).toBeLessThan(0.001);
    });

    it('[K05] bounds irreversible deletions by the earliest plausible instant', () => {
      let wall = START;
      let monotonic = 0;
      const now = createSessionClock(() => new Date(wall), () => monotonic);

      expect(now.earliestPlausible()).toBe(START);
      wall = START + 365 * 86_400_000; // salto de um ano para a frente
      expect(now()).toBe(wall);
      expect(now.earliestPlausible()).toBe(START);
      monotonic += 60_000;
      wall += 60_000;
      expect(now.earliestPlausible()).toBe(START + 60_000);
      wall = START - 3_600_000; // retrocesso: o mínimo segue o relógio de parede
      expect(now.earliestPlausible()).toBe(START - 3_600_000);
      wall = Number.NaN;
      monotonic += 1_000;
      expect(now.earliestPlausible()).toBe(START + 61_000);
      expect(now()).toBe(START + 365 * 86_400_000 + 61_000);
    });
  });
});
