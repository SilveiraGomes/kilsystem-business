import dns from 'node:dns';
import { readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createSqliteAuthenticationStore,
  createSqliteMembershipPersistence,
  createSqliteTenantPersistence,
  createSqliteUserDirectory,
  MIGRATIONS,
  migrationChecksum,
  runMigrations,
  type SqliteDatabase,
} from '../packages/database/src/index';
import {
  createBranch,
  PasswordPolicyError,
  RecordConflictError,
  type User,
  type UserId,
} from '../packages/shared-types/src/index';
import { InstallationBootstrapError } from '../services/local-api/src/authentication/installation-bootstrap';
import { isAuthenticatedIdentity } from '../services/local-api/src/authentication/local-authenticator';
import type { Argon2idDerive } from '../services/local-api/src/authentication/password-hashing';
import {
  AUTHENTICATION_THROTTLE_POLICY,
  evaluateAttempt,
  INSTANCE_THROTTLE_KEY,
  throttleKeyFor,
} from '../services/local-api/src/authentication/throttle-policy';
import { LocalServiceStateError } from '../services/local-api/src/local-service';
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
  REPOSITORY_ROOT,
  serviceConfig,
  type ServiceTestDependencies,
  type ServiceUnderTest,
} from './support/local-service-harness';
import { createTemporaryDatabase, type TemporaryDatabase } from './support/sqlite-harness';

const INVALID = { ok: false, reason: 'invalid-credentials' };
const policy = AUTHENTICATION_THROTTLE_POLICY;

type Table =
  | 'authentication_throttle'
  | 'installation_bootstrap'
  | 'password_credentials'
  | 'users'
  | 'company_memberships'
  | 'branches'
  | 'companies'
  | 'schema_migrations';

const count = (database: SqliteDatabase, table: Table): number =>
  database.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;

/** Derivação nativa com contador de chamadas, para confirmar o percurso criptográfico. */
const countingDerive = (): { readonly derive: Argon2idDerive; readonly calls: () => number } => {
  let calls = 0;
  const derive: Argon2idDerive = async (input) => {
    calls += 1;
    const { argon2 } = await import('node:crypto');
    return new Promise<Buffer>((resolve, reject) => {
      argon2(
        'argon2id',
        {
          memory: input.parameters.memoryKiB,
          message: input.message,
          nonce: input.nonce,
          parallelism: input.parameters.parallelism,
          passes: input.parameters.passes,
          tagLength: input.tagLength,
        },
        (error, key) => (error ? reject(error) : resolve(key)),
      );
    });
  };
  return { calls: () => calls, derive };
};

/**
 * Derivação nativa que retém a próxima chamada depois de `holdNext()` até `release()`, para
 * alterar a identidade ou a credencial enquanto uma autenticação está a meio (E1.07-B-M).
 */
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

describe('Local authentication (E1.07-B)', () => {
  let temporary: TemporaryDatabase;
  let clock: TestClock;
  const running: ServiceUnderTest[] = [];

  const newService = (dependencies: ServiceTestDependencies = {}): ServiceUnderTest => {
    const harness = createServiceUnderTest(serviceConfig(temporary.filename), undefined, {
      clock: clock.now,
      passwordHashing: { parameters: TEST_HASHING_PARAMETERS },
      ...dependencies,
    });
    running.push(harness);
    return harness;
  };

  const startedService = async (dependencies: ServiceTestDependencies = {}): Promise<ServiceUnderTest> => {
    const harness = newService(dependencies);
    await harness.service.start();
    return harness;
  };

  /** Identidade `ACTIVE` com credencial, criada pelos mecanismos internos do serviço. */
  const provision = async (
    { service }: ServiceUnderTest,
    password: string = TEST_PASSWORD,
    overrides: Parameters<typeof newUser>[0] = {},
  ): Promise<User> => {
    const user = newUser(overrides);
    await service.identityProvisioning.users.create(user);
    await service.identityProvisioning.credentials.create(user.id, password);
    return user;
  };

  const inspect = <T>(read: (database: SqliteDatabase) => T): T => {
    const database = temporary.open();
    try {
      return read(database);
    } finally {
      database.close();
    }
  };

  beforeEach(() => {
    temporary = createTemporaryDatabase();
    clock = createTestClock();
  });

  afterEach(async () => {
    for (const harness of running.splice(0)) await harness.service.stop();
    temporary.dispose();
  });

  describe('authentication', () => {
    it('authenticates an ACTIVE identity with a valid credential and returns a minimal result', async () => {
      const harness = await startedService();
      const user = await provision(harness);

      const result = await harness.service.authentication.authenticate(user.username, TEST_PASSWORD);

      expect(result).toEqual({
        identity: { authenticatedAt: clock.now().toISOString(), method: 'password', userId: user.id },
        ok: true,
      });
      if (!result.ok) throw new Error('Autenticação esperada.');
      expect(isAuthenticatedIdentity(result.identity)).toBe(true);
      expect(Object.isFrozen(result.identity)).toBe(true);
    });

    it('refuses an ACTIVE identity without credential', async () => {
      const harness = await startedService();
      const user = newUser();
      await harness.service.identityProvisioning.users.create(user);

      await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toEqual(INVALID);
    });

    it.each(['SUSPENDED', 'INACTIVE'] as const)('refuses a %s identity even with the correct password', async (status) => {
      const harness = await startedService();
      const user = await provision(harness);
      await harness.service.identityProvisioning.users.changeStatus(user.id, status, clock.now());

      await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toEqual(INVALID);
    });

    it('refuses unknown usernames and wrong passwords', async () => {
      const harness = await startedService();
      const user = await provision(harness);

      await expect(harness.service.authentication.authenticate('nao.existe', TEST_PASSWORD)).resolves.toEqual(INVALID);
      await expect(harness.service.authentication.authenticate(user.username, OTHER_TEST_PASSWORD)).resolves.toEqual(INVALID);
      await expect(
        harness.service.authentication.authenticate(user.username, TEST_PASSWORD.toUpperCase()),
      ).resolves.toEqual(INVALID);
      await expect(harness.service.authentication.authenticate(user.username, ` ${TEST_PASSWORD}`)).resolves.toEqual(INVALID);
    });

    it('normalises the username and the password consistently with their creation', async () => {
      const harness = await startedService();
      const user = await provision(harness, UNICODE_TEST_PASSWORD.normalize('NFD'));

      const result = await harness.service.authentication.authenticate(
        `  ${user.username.toUpperCase()} `,
        UNICODE_TEST_PASSWORD.normalize('NFC'),
      );

      expect(result).toMatchObject({ ok: true });
    });

    it('answers every refusal with the same generic result and one derivation per attempt', async () => {
      const counter = countingDerive();
      const harness = await startedService({ passwordHashing: { derive: counter.derive, parameters: TEST_HASHING_PARAMETERS } });
      const active = await provision(harness);
      const suspended = await provision(harness);
      await harness.service.identityProvisioning.users.changeStatus(suspended.id, 'SUSPENDED', clock.now());
      const inactive = await provision(harness);
      await harness.service.identityProvisioning.users.changeStatus(inactive.id, 'INACTIVE', clock.now());
      const withoutCredential = newUser();
      await harness.service.identityProvisioning.users.create(withoutCredential);

      const attempts: readonly (readonly [string, string])[] = [
        [active.username, OTHER_TEST_PASSWORD],
        ['utilizador.inexistente', TEST_PASSWORD],
        [suspended.username, TEST_PASSWORD],
        [inactive.username, TEST_PASSWORD],
        [withoutCredential.username, TEST_PASSWORD],
      ];
      const results = [];
      for (const [username, password] of attempts) {
        const before = counter.calls();
        results.push(await harness.service.authentication.authenticate(username, password));
        expect(counter.calls() - before).toBe(1);
      }

      for (const result of results) {
        expect(result).toEqual(INVALID);
        expect(Object.keys(result).sort()).toEqual(['ok', 'reason']);
      }
      await expect(harness.service.authentication.authenticate('x', TEST_PASSWORD)).resolves.toEqual(INVALID);
      await expect(harness.service.authentication.authenticate(active.username, 'x'.repeat(5000))).resolves.toEqual(INVALID);
    });

    it('grants no company access and cannot be forged', async () => {
      const harness = await startedService();
      const company = newCompany();
      await harness.service.companies.create(contextFor(company.tenantId), company);
      const user = await provision(harness);

      const result = await harness.service.authentication.authenticate(user.username, TEST_PASSWORD);
      if (!result.ok) throw new Error('Autenticação esperada.');

      expect(Object.keys(result.identity).sort()).toEqual(['authenticatedAt', 'method', 'userId']);
      await expect(harness.service.membershipScopes.evaluate(contextFor(company.tenantId), user.id)).resolves.toEqual({
        eligible: false,
        reason: 'no-membership',
      });
      expect(isAuthenticatedIdentity({ ...result.identity })).toBe(false);
      expect(isAuthenticatedIdentity({ authenticatedAt: clock.now().toISOString(), method: 'password', userId: user.id })).toBe(
        false,
      );
    });

    it('revalidates the identity status after the derivation and refuses a user suspended meanwhile', async () => {
      const held = heldDerive();
      const harness = await startedService({ passwordHashing: { derive: held.derive, parameters: TEST_HASHING_PARAMETERS } });
      const user = await provision(harness);
      held.holdNext();

      const pending = harness.service.authentication.authenticate(user.username, TEST_PASSWORD);
      await held.started;
      await harness.service.identityProvisioning.users.changeStatus(user.id, 'SUSPENDED', clock.now());
      held.release();

      await expect(pending).resolves.toEqual(INVALID);
    });

    it('refuses the old password when the credential is replaced during the derivation', async () => {
      const held = heldDerive();
      const harness = await startedService({ passwordHashing: { derive: held.derive, parameters: TEST_HASHING_PARAMETERS } });
      const user = await provision(harness);
      held.holdNext();

      const pending = harness.service.authentication.authenticate(user.username, TEST_PASSWORD);
      await held.started;
      await harness.service.identityProvisioning.credentials.replace(user.id, OTHER_TEST_PASSWORD);
      held.release();

      await expect(pending).resolves.toEqual(INVALID);
      await expect(harness.service.authentication.authenticate(user.username, OTHER_TEST_PASSWORD)).resolves.toMatchObject({
        ok: true,
      });
    });

    it('authenticates without any network access', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const connect = vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(() => {
        throw new Error('rede proibida');
      });
      const lookup = vi.spyOn(dns, 'lookup').mockImplementation(() => {
        throw new Error('DNS proibido');
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.reject(new Error('fetch proibido')));
      try {
        await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toMatchObject({
          ok: true,
        });
      } finally {
        connect.mockRestore();
        lookup.mockRestore();
        fetchSpy.mockRestore();
      }

      expect(connect).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('attempt limiting', () => {
    const failFiveTimes = async ({ service }: ServiceUnderTest, username: string): Promise<void> => {
      for (let attempt = 0; attempt < policy.freeFailures; attempt += 1) {
        await expect(service.authentication.authenticate(username, OTHER_TEST_PASSWORD)).resolves.toEqual(INVALID);
      }
    };

    it('locks a username temporarily after five failures and doubles the lock on each new failure', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      await failFiveTimes(harness, user.username);

      await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toEqual({
        ok: false,
        reason: 'throttled',
        retryAfterSeconds: 30,
      });
      clock.advanceSeconds(30);
      await expect(harness.service.authentication.authenticate(user.username, OTHER_TEST_PASSWORD)).resolves.toEqual(INVALID);
      await expect(harness.service.authentication.authenticate(user.username, OTHER_TEST_PASSWORD)).resolves.toMatchObject({
        reason: 'throttled',
        retryAfterSeconds: 60,
      });
    });

    it('accepts the correct password after the lock expires and resets the counter', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      await failFiveTimes(harness, user.username);
      clock.advanceSeconds(29);
      await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toMatchObject({
        reason: 'throttled',
      });

      clock.advanceSeconds(1);
      await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });

      expect(inspect((database) => database.prepare('SELECT 1 FROM authentication_throttle WHERE throttle_key = ?').get(throttleKeyFor(user.username)))).toBeUndefined();
      await failFiveTimes(harness, user.username);
    });

    it('keeps the throttle state across service restarts', async () => {
      const first = await startedService();
      const user = await provision(first);
      await failFiveTimes(first, user.username);
      await first.service.stop();

      const second = await startedService();

      await expect(second.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toMatchObject({
        reason: 'throttled',
      });
    });

    it('cannot be bypassed with concurrent attempts', async () => {
      const counter = countingDerive();
      const harness = await startedService({ passwordHashing: { derive: counter.derive, parameters: TEST_HASHING_PARAMETERS } });
      const user = await provision(harness);
      const before = counter.calls();

      const results = await Promise.all(
        Array.from({ length: 12 }, () => harness.service.authentication.authenticate(user.username, OTHER_TEST_PASSWORD)),
      );

      expect(results.filter((result) => !result.ok && result.reason === 'invalid-credentials')).toHaveLength(policy.freeFailures);
      expect(results.filter((result) => !result.ok && result.reason === 'throttled')).toHaveLength(12 - policy.freeFailures);
      expect(counter.calls() - before).toBe(policy.freeFailures);
    });

    it('limits unknown usernames in the same way, storing only SHA-256 keys', async () => {
      const harness = await startedService();
      const unknown = 'utilizador.desconhecido.teste';
      await failFiveTimes(harness, unknown);

      await expect(harness.service.authentication.authenticate(unknown, TEST_PASSWORD)).resolves.toMatchObject({
        reason: 'throttled',
      });
      const keys = inspect((database) => database.prepare('SELECT throttle_key FROM authentication_throttle').pluck().all());
      expect(keys).toEqual(expect.arrayContaining([INSTANCE_THROTTLE_KEY, throttleKeyFor(unknown)]));
      expect(keys.join()).not.toContain(unknown);
      await harness.service.stop();
      const bytes = readFileSync(temporary.filename);
      expect(bytes.includes(Buffer.from(unknown))).toBe(false);
    });

    it('bounds stored throttle records by age and by number', () => {
      const database = temporary.open();
      runMigrations(database);
      const store = createSqliteAuthenticationStore(database);
      const now = clock.now().getTime();
      const insertMany = database.transaction((total: number, at: string) => {
        for (let index = 0; index < total; index += 1) {
          store.writeThrottle({
            failures: 1,
            key: throttleKeyFor(`desconhecido.${index}`),
            lastAttemptAt: at,
            lockedUntil: undefined,
            windowStartedAt: at,
          });
        }
      });
      insertMany(policy.maxTrackedKeys + 50, new Date(now).toISOString());
      store.writeThrottle({ failures: 1, key: INSTANCE_THROTTLE_KEY, lastAttemptAt: '2020-01-01T00:00:00.000Z', lockedUntil: undefined, windowStartedAt: '2020-01-01T00:00:00.000Z' });

      store.pruneThrottle(new Date(now - policy.failureMemorySeconds * 1000).toISOString(), policy.maxTrackedKeys);
      expect(store.countThrottle()).toBe(policy.maxTrackedKeys + 1);

      store.pruneThrottle(new Date(now + 1000).toISOString(), policy.maxTrackedKeys);
      expect(store.countThrottle()).toBe(1);
      expect(store.readThrottle(INSTANCE_THROTTLE_KEY)).toBeDefined();
    });

    it('rejects oversized inputs before any derivation', async () => {
      const counter = countingDerive();
      const harness = await startedService({ passwordHashing: { derive: counter.derive, parameters: TEST_HASHING_PARAMETERS } });
      const user = await provision(harness);
      const before = counter.calls();

      await expect(harness.service.authentication.authenticate(user.username, 'y'.repeat(2048))).resolves.toEqual(INVALID);
      await expect(harness.service.authentication.authenticate('u'.repeat(500), TEST_PASSWORD)).resolves.toEqual(INVALID);

      expect(counter.calls()).toBe(before);
    });

    it('stays bounded when the system clock moves backwards or forwards', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      await failFiveTimes(harness, user.username);
      for (let attempt = 0; attempt < 6; attempt += 1) {
        clock.advanceSeconds(policy.maxLockSeconds);
        await harness.service.authentication.authenticate(user.username, OTHER_TEST_PASSWORD);
      }

      // Relógio recuado um ano: o bloqueio guardado "no futuro" não é aplicado, mas o contador
      // mantém-se e a falha seguinte volta a bloquear pelo máximo, nunca mais.
      clock.advanceSeconds(-365 * 86400);
      await expect(harness.service.authentication.authenticate(user.username, OTHER_TEST_PASSWORD)).resolves.toEqual(INVALID);
      await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toEqual({
        ok: false,
        reason: 'throttled',
        retryAfterSeconds: policy.maxLockSeconds,
      });

      // Relógio avançado dois anos: contador esquecido e autenticação válida.
      clock.advanceSeconds(2 * 365 * 86400);
      await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });
    });
  });

  describe('attempt limiting policy (pure)', () => {
    const at = Date.parse('2026-11-16T08:00:00.000Z');
    const key = throttleKeyFor('politica.teste');

    it('suspends the whole instance after many failures across different usernames', () => {
      let instance;
      for (let attempt = 0; attempt < policy.instanceMaxFailures; attempt += 1) {
        const decision = evaluateAttempt(throttleKeyFor(`varios.${attempt}`), undefined, instance, at + attempt);
        if (!decision.allowed) throw new Error('Tentativa admitida esperada.');
        instance = decision.instance;
      }

      const blocked = evaluateAttempt(key, undefined, instance, at + 1000);
      expect(blocked).toMatchObject({ allowed: false });
      expect(blocked.allowed === false && blocked.retryAfterSeconds).toBeLessThanOrEqual(policy.instanceWindowSeconds);
      expect(evaluateAttempt(key, undefined, instance, at + policy.instanceWindowSeconds * 1000)).toMatchObject({
        allowed: true,
      });
    });

    it('never locks permanently and caps every lock', () => {
      const hostile = {
        failures: 1_000_000,
        key,
        lastAttemptAt: new Date(at).toISOString(),
        lockedUntil: '9999-12-31T00:00:00.000Z',
        windowStartedAt: new Date(at).toISOString(),
      };

      const decision = evaluateAttempt(key, hostile, undefined, at);
      expect(decision).toMatchObject({ allowed: false, retryAfterSeconds: policy.maxLockSeconds });
      expect(evaluateAttempt(key, hostile, undefined, at + policy.maxLockSeconds * 1000)).toMatchObject({ allowed: true });
    });

    it('keeps the counter but not the stored lock of a record written in the future', () => {
      const future = {
        failures: 7,
        key,
        lastAttemptAt: '2030-01-01T00:00:00.000Z',
        lockedUntil: '2030-01-01T00:15:00.000Z',
        windowStartedAt: '2030-01-01T00:00:00.000Z',
      };

      const decision = evaluateAttempt(key, future, undefined, at);
      expect(decision).toMatchObject({ allowed: true, user: { failures: 8, lastAttemptAt: new Date(at).toISOString() } });
      // Oitava falha: 30 s × 2^(8 − 5) = 240 s, contados a partir de agora.
      const expectedLock = policy.baseLockSeconds * 2 ** (8 - policy.freeFailures);
      expect(decision.allowed && decision.user.lockedUntil).toBe(new Date(at + expectedLock * 1000).toISOString());
    });

    it('forgets old failures and resets windows set in the future', () => {
      const old = { failures: 4, key, lastAttemptAt: new Date(at).toISOString(), lockedUntil: undefined, windowStartedAt: new Date(at).toISOString() };
      const later = evaluateAttempt(key, old, undefined, at + policy.failureMemorySeconds * 1000);
      expect(later).toMatchObject({ allowed: true, user: { failures: 1 } });

      const futureWindow = { ...old, failures: 99, key: INSTANCE_THROTTLE_KEY, windowStartedAt: '2030-01-01T00:00:00.000Z' };
      expect(evaluateAttempt(key, undefined, futureWindow, at)).toMatchObject({ allowed: true, instance: { failures: 1 } });
    });
  });

  describe('installation bootstrap', () => {
    const administrator = () => ({ displayName: 'Administrador Inicial', id: newId(), username: uniqueUsername('admin') });

    it('creates nothing automatically at startup', async () => {
      const harness = await startedService();

      await expect(harness.service.identityProvisioning.installation.status()).resolves.toEqual({ initialised: false });
      await harness.service.stop();
      expect(
        inspect((database) => [
          count(database, 'users'),
          count(database, 'password_credentials'),
          count(database, 'installation_bootstrap'),
        ]),
      ).toEqual([0, 0, 0]);
    });

    it('initialises the installation once, atomically, with an authenticable administrator', async () => {
      const harness = await startedService();
      const input = administrator();

      const result = await harness.service.identityProvisioning.installation.initialise(input, TEST_PASSWORD);

      expect(result).toEqual({ initialAdministratorId: input.id });
      await expect(harness.service.identityProvisioning.installation.status()).resolves.toEqual({
        completedAt: clock.now().toISOString(),
        initialAdministratorId: input.id,
        initialised: true,
      });
      await expect(harness.service.identityProvisioning.users.findById(input.id as UserId)).resolves.toMatchObject({
        status: 'ACTIVE',
      });
      await expect(harness.service.authentication.authenticate(input.username, TEST_PASSWORD)).resolves.toMatchObject({
        ok: true,
      });
    });

    it('refuses a second initialisation', async () => {
      const harness = await startedService();
      await harness.service.identityProvisioning.installation.initialise(administrator(), TEST_PASSWORD);

      await expect(
        harness.service.identityProvisioning.installation.initialise(administrator(), TEST_PASSWORD),
      ).rejects.toMatchObject({ name: InstallationBootstrapError.name, reason: 'already-initialised' });
      expect(inspect((database) => count(database, 'users'))).toBe(1);
    });

    it('lets only one of two concurrent initialisations succeed', async () => {
      const harness = await startedService();

      const results = await Promise.allSettled([
        harness.service.identityProvisioning.installation.initialise(administrator(), TEST_PASSWORD),
        harness.service.identityProvisioning.installation.initialise(administrator(), OTHER_TEST_PASSWORD),
      ]);

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(InstallationBootstrapError);
      expect(inspect((database) => [count(database, 'users'), count(database, 'password_credentials')])).toEqual([1, 1]);
    });

    it('rolls back the identity and credential when the last step fails', async () => {
      const setup = temporary.open();
      runMigrations(setup);
      setup.exec(`CREATE TRIGGER falha_simulada BEFORE INSERT ON installation_bootstrap
        BEGIN SELECT RAISE(ABORT, 'falha simulada'); END;`);
      setup.close();
      const harness = await startedService();

      await expect(harness.service.identityProvisioning.installation.initialise(administrator(), TEST_PASSWORD)).rejects.toThrow();
      expect(
        inspect((database) => [count(database, 'users'), count(database, 'password_credentials'), count(database, 'installation_bootstrap')]),
      ).toEqual([0, 0, 0]);

      inspect((database) => database.exec('DROP TRIGGER falha_simulada'));
      await expect(
        harness.service.identityProvisioning.installation.initialise(administrator(), TEST_PASSWORD),
      ).resolves.toBeDefined();
    });

    it('never promotes identities provisioned before the initialisation', async () => {
      const harness = await startedService();
      const existing = await provision(harness);
      const input = administrator();

      await expect(
        harness.service.identityProvisioning.installation.initialise({ ...input, username: existing.username }, TEST_PASSWORD),
      ).rejects.toMatchObject({ name: RecordConflictError.name, reason: 'duplicate-username' });
      await expect(harness.service.identityProvisioning.installation.status()).resolves.toEqual({ initialised: false });

      await harness.service.identityProvisioning.installation.initialise(input, TEST_PASSWORD);
      const status = await harness.service.identityProvisioning.installation.status();
      expect(status.initialAdministratorId).toBe(input.id);
      expect(status.initialAdministratorId).not.toBe(existing.id);
    });

    it('grants no company membership or permission to the initial administrator', async () => {
      const harness = await startedService();
      const company = newCompany();
      const context = contextFor(company.tenantId);
      await harness.service.companies.create(context, company);
      const input = administrator();
      await harness.service.identityProvisioning.installation.initialise(input, TEST_PASSWORD);

      await expect(harness.service.companyMemberships.findByUser(context, input.id as UserId)).resolves.toBeUndefined();
      await expect(harness.service.membershipScopes.evaluate(context, input.id as UserId)).resolves.toEqual({
        eligible: false,
        reason: 'no-membership',
      });
    });

    it('accepts no weak, default or username-equal password and writes nothing on refusal', async () => {
      const harness = await startedService();
      const input = administrator();

      for (const password of ['admin', 'password', '123456', input.username, 'a'.repeat(20), '']) {
        await expect(harness.service.identityProvisioning.installation.initialise(input, password)).rejects.toBeInstanceOf(
          PasswordPolicyError,
        );
      }
      expect(inspect((database) => [count(database, 'users'), count(database, 'installation_bootstrap')])).toEqual([0, 0]);
    });
  });

  describe('credentials management', () => {
    it('refuses a second primary credential and replaces it only through the internal procedure', async () => {
      const harness = await startedService();
      const user = await provision(harness);

      await expect(harness.service.identityProvisioning.credentials.create(user.id, OTHER_TEST_PASSWORD)).rejects.toMatchObject({
        reason: 'duplicate-credential',
      });
      await harness.service.identityProvisioning.credentials.replace(user.id, OTHER_TEST_PASSWORD);

      await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toEqual(INVALID);
      await expect(harness.service.authentication.authenticate(user.username, OTHER_TEST_PASSWORD)).resolves.toMatchObject({
        ok: true,
      });
      await expect(
        harness.service.identityProvisioning.credentials.replace(newUser().id, OTHER_TEST_PASSWORD),
      ).rejects.toMatchObject({ kind: 'User' });
    });

    it('upgrades outdated hash parameters after a successful authentication', async () => {
      const first = await startedService();
      const user = await provision(first);
      await first.service.stop();

      const upgraded = { memoryKiB: 24576, parallelism: 1, passes: 2 };
      const second = await startedService({ passwordHashing: { parameters: upgraded } });
      await expect(second.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });

      expect(
        inspect((database) => database.prepare('SELECT memory_kib FROM password_credentials WHERE user_id = ?').pluck().get(user.id)),
      ).toBe(24576);
      await expect(second.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });
    });
  });

  describe('SQLite persistence', () => {
    it('upgrades an E1.07-A database without touching identities, memberships or earlier migrations', async () => {
      const legacy = temporary.open();
      expect(runMigrations(legacy, MIGRATIONS.slice(0, 2))).toEqual({ applied: [1, 2], currentVersion: 2 });
      const company = newCompany();
      const context = contextFor(company.tenantId);
      const tenant = createSqliteTenantPersistence(legacy);
      await tenant.companies.create(context, company);
      await tenant.branches.create(context, createBranch(branchInput(company)));
      const user = newUser();
      await createSqliteUserDirectory(legacy).create(user);
      await createSqliteMembershipPersistence(legacy).companyMemberships.create(context, newCompanyMembership(user, company));
      const snapshot = (database: SqliteDatabase) =>
        ['companies', 'branches', 'users', 'company_memberships'].map((table) =>
          database.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
        );
      const before = snapshot(legacy);
      const checksums = legacy.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all();
      legacy.close();

      // Alvo explícito: o esquema de E1.07-B (migrações 1 a 3). A migração 4 tem teste próprio (E1.07-C).
      const e107b = MIGRATIONS.slice(0, 3);
      const upgraded = temporary.open();
      expect(runMigrations(upgraded, e107b)).toEqual({ applied: [3], currentVersion: 3 });

      expect(snapshot(upgraded)).toEqual(before);
      expect(upgraded.prepare('SELECT version, checksum FROM schema_migrations WHERE version < 3 ORDER BY version').all()).toEqual(
        checksums,
      );
      expect(checksums).toEqual(MIGRATIONS.slice(0, 2).map((migration) => ({ checksum: migrationChecksum(migration), version: migration.version })));
      expect(count(upgraded, 'password_credentials')).toBe(0);
      expect(runMigrations(upgraded, e107b)).toEqual({ applied: [], currentVersion: 3 });
    });

    it('keeps credentials and the installation state after restarting the service', async () => {
      const first = await startedService();
      const user = await provision(first);
      await first.service.identityProvisioning.installation.initialise(
        { displayName: 'Administrador', id: newId(), username: uniqueUsername('admin') },
        UNICODE_TEST_PASSWORD,
      );
      await first.service.stop();

      const second = await startedService();

      await expect(second.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });
      await expect(second.service.identityProvisioning.installation.status()).resolves.toMatchObject({ initialised: true });
    });

    it('enforces referential integrity, one credential per user and a single bootstrap record', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      await harness.service.identityProvisioning.installation.initialise(
        { displayName: 'Administrador', id: newId(), username: uniqueUsername('admin') },
        TEST_PASSWORD,
      );
      await harness.service.stop();
      const database = temporary.open();
      const insertCredential = (values: Record<string, unknown>): void => {
        database
          .prepare(
            `INSERT INTO password_credentials (user_id, algorithm, algorithm_version, memory_kib, passes, parallelism,
               salt, hash, created_at, updated_at)
             VALUES (@user_id, @algorithm, 19, @memory_kib, 2, 1, @salt, @hash, '2026-11-16', '2026-11-16')`,
          )
          .run({ algorithm: 'argon2id', hash: Buffer.alloc(32), memory_kib: 19456, salt: Buffer.alloc(16), user_id: newId(), ...values });
      };

      const constraint = /constraint/i;
      expect(() => insertCredential({})).toThrow(constraint);
      expect(() => insertCredential({ user_id: user.id })).toThrow(constraint);
      const other = newUser();
      database.prepare(`INSERT INTO users (id, username, display_name, status, created_at, updated_at)
        VALUES (?, ?, 'Registo', 'ACTIVE', '2026-11-16', '2026-11-16')`).run(other.id, other.username);
      for (const values of [
        { algorithm: 'sha256' },
        { memory_kib: 1024 },
        { salt: Buffer.alloc(4) },
        { hash: Buffer.alloc(8) },
      ]) {
        expect(() => insertCredential({ user_id: other.id, ...values })).toThrow(constraint);
      }
      // Tabela STRICT: texto numa coluna BLOB é recusado pelo tipo (SQLITE_CONSTRAINT_DATATYPE).
      expect(() => insertCredential({ hash: 'texto', user_id: other.id })).toThrow(/BLOB/);
      expect(() => database.prepare('DELETE FROM users WHERE id = ?').run(user.id)).toThrow(constraint);
      expect(() =>
        database.prepare("INSERT INTO installation_bootstrap VALUES (2, ?, '2026-11-16')").run(user.id),
      ).toThrow(constraint);
      expect(() =>
        database.prepare("INSERT INTO installation_bootstrap VALUES (1, ?, '2026-11-16')").run(user.id),
      ).toThrow(constraint);
      expect(() =>
        database.prepare("INSERT INTO authentication_throttle VALUES ('utilizador.texto', 1, 'x', NULL, 'x')").run(),
      ).toThrow(constraint);
      database.close();
    });
  });

  describe('local service lifecycle', () => {
    it('refuses authentication, credentials and bootstrap outside READY, including stale references', async () => {
      const harness = newService();
      const user = newUser();
      const expectNotReady = async (): Promise<void> => {
        const { authentication, identityProvisioning } = harness.service;
        const operations: readonly (() => Promise<unknown>)[] = [
          () => authentication.authenticate(user.username, TEST_PASSWORD),
          () => identityProvisioning.credentials.create(user.id, TEST_PASSWORD),
          () => identityProvisioning.credentials.replace(user.id, TEST_PASSWORD),
          () => identityProvisioning.installation.status(),
          () => identityProvisioning.installation.initialise({ displayName: 'X', id: newId(), username: 'admin.x' }, TEST_PASSWORD),
        ];
        for (const operation of operations) {
          await expect(operation()).rejects.toMatchObject({ name: LocalServiceStateError.name, reason: 'not-ready' });
        }
      };

      await expectNotReady();
      await harness.service.start();
      const { authentication } = harness.service;
      const { credentials, installation } = harness.service.identityProvisioning;
      await harness.service.stop();

      await expectNotReady();
      await expect(authentication.authenticate(user.username, TEST_PASSWORD)).rejects.toBeInstanceOf(LocalServiceStateError);
      await expect(credentials.create(user.id, TEST_PASSWORD)).rejects.toBeInstanceOf(LocalServiceStateError);
      await expect(installation.status()).rejects.toBeInstanceOf(LocalServiceStateError);
    });

    it('discards an authentication whose derivation finishes after shutdown, without writing', async () => {
      const gate = deferred();
      const started = deferred();
      let held = false;
      const derive: Argon2idDerive = async (input) => {
        if (held) {
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
      const harness = await startedService({ passwordHashing: { derive, parameters: TEST_HASHING_PARAMETERS } });
      const user = await provision(harness);
      held = true;

      const pending = harness.service.authentication.authenticate(user.username, TEST_PASSWORD);
      await started.promise;
      await harness.service.stop();
      const restarted = await startedService();
      gate.resolve();

      await expect(pending).rejects.toMatchObject({ name: LocalServiceStateError.name, reason: 'not-ready' });
      await restarted.service.stop();
      const throttle = inspect((database) =>
        database.prepare('SELECT failures FROM authentication_throttle WHERE throttle_key = ?').pluck().get(throttleKeyFor(user.username)),
      );
      expect(throttle).toBe(1);
    });

    it('discards an initialisation whose derivation finishes after shutdown', async () => {
      const gate = deferred();
      const started = deferred();
      const derive: Argon2idDerive = async ({ tagLength }) => {
        started.resolve();
        await gate.promise;
        return Buffer.alloc(tagLength, 7);
      };
      const harness = await startedService({ passwordHashing: { derive, parameters: TEST_HASHING_PARAMETERS } });

      const pending = harness.service.identityProvisioning.installation.initialise(
        { displayName: 'Administrador', id: newId(), username: uniqueUsername('admin') },
        TEST_PASSWORD,
      );
      await started.promise;
      await harness.service.stop();
      gate.resolve();

      await expect(pending).rejects.toBeInstanceOf(LocalServiceStateError);
      expect(inspect((database) => [count(database, 'users'), count(database, 'installation_bootstrap')])).toEqual([0, 0]);
    });

    it('never writes secrets to the service logs or results', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      await harness.service.authentication.authenticate(user.username, OTHER_TEST_PASSWORD);
      const result = await harness.service.authentication.authenticate(user.username, TEST_PASSWORD);
      const stored = inspect((database) =>
        database.prepare('SELECT salt, hash FROM password_credentials WHERE user_id = ?').get(user.id),
      ) as { salt: Buffer; hash: Buffer };
      await harness.service.stop();

      const output = [harness.lines.join('\n'), JSON.stringify(result)].join('\n');
      for (const secret of [TEST_PASSWORD, OTHER_TEST_PASSWORD, stored.salt.toString('hex'), stored.hash.toString('hex'), stored.hash.toString('base64'), user.username]) {
        expect(output).not.toContain(secret);
      }
    });

    it('keeps a suspension effective after restarting the service', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      await harness.service.identityProvisioning.users.changeStatus(user.id, 'SUSPENDED', clock.now());
      await harness.service.stop();

      const restarted = await startedService();
      await expect(restarted.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toEqual(INVALID);
    });
  });

  describe('no HTTP or Electron exposure', () => {
    const sourcesOf = (...segments: string[]): readonly string[] =>
      readdirSync(path.join(REPOSITORY_ROOT, ...segments), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(ts|tsx|cts)$/.test(entry.name))
        .map((entry) => path.join(entry.parentPath, entry.name));

    it('keeps the authentication code free of network, HTTP and Electron modules', () => {
      const files = sourcesOf('services', 'local-api', 'src', 'authentication');
      const forbidden = /from '(electron|fastify|node:(http|https|http2|net|tls|dgram|dns|child_process))'|\bfetch\(/;

      expect(files.length).toBeGreaterThanOrEqual(6);
      for (const file of files) expect(readFileSync(file, 'utf8')).not.toMatch(forbidden);
    });

    it('does not reach authentication, credentials or bootstrap from the desktop, preload, HTTP factories or the CLI', () => {
      const exposed = [
        ...sourcesOf('apps', 'desktop', 'src'),
        ...sourcesOf('apps', 'admin-portal', 'src'),
        ...sourcesOf('services', 'central-api', 'src'),
        path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'app.ts'),
        path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'cli.ts'),
        path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'main.ts'),
      ];
      const authentication = /authenticat|credential|password|identityProvisioning|installation\.|initialise\(|argon2/i;

      for (const file of exposed) expect(readFileSync(file, 'utf8')).not.toMatch(authentication);
    });
  });
});
