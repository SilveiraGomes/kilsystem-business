import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_DATABASE_LOCK_TIMEOUT_MS,
  MIGRATIONS,
  migrationChecksum,
  openSqliteDatabase,
  resolveDatabaseIdentity,
  resolveDatabaseLocation,
  runMigrations,
  verifyExclusiveOwnership,
  type SqliteDatabase,
} from '../packages/database/src/index';
import { LocalServiceConfigError, parseLocalServiceConfig } from '../services/local-api/src/config';
import { TEST_HASHING_PARAMETERS, TEST_PASSWORD } from './support/authentication-fixtures';
import { contextFor, newCompany } from './support/fixtures';
import { newUser } from './support/identity-fixtures';
import {
  createServiceUnderTest,
  PROTECTED_DIRECTORIES,
  REPOSITORY_ROOT,
  serviceConfig,
  type ServiceTestDependencies,
  type ServiceUnderTest,
} from './support/local-service-harness';
import {
  buildChildBundle,
  cliOutcome,
  isEvent,
  killAllChildren,
  processOutcome,
  spawnServiceCli,
  spawnServiceProcess,
  type ChildBundle,
  type ChildEvent,
  type TestChild,
} from './support/exclusivity/processes';

/*
 * E1.07-X — exclusividade operacional por base SQLite (PD-43). Os ensaios entre instâncias usam
 * processos reais (X30 em diante); os restantes verificam a identificação da base, a aquisição e o
 * ciclo de vida no mesmo processo. Todas as bases são temporárias e os dados fictícios.
 */

const PROCESS_TEST_TIMEOUT = 120_000;
const SERVICE_TEST_TIMEOUT = 30_000;
const isWindows = process.platform === 'win32';

const digestOf = (filename: string): string => {
  const hash = createHash('sha256');
  for (const file of [filename, `${filename}-wal`]) if (existsSync(file)) hash.update(readFileSync(file));
  return hash.digest('hex');
};

const expectedChecksums = MIGRATIONS.map((migration) => ({ checksum: migrationChecksum(migration), version: migration.version }));

describe('Database exclusivity (E1.07-X)', () => {
  let directory: string;
  let filename: string;
  const running: ServiceUnderTest[] = [];
  const restoreAcl: string[] = [];

  const service = (overrides: ServiceTestDependencies = {}, file = filename): ServiceUnderTest => {
    const harness = createServiceUnderTest(serviceConfig(file), undefined, {
      passwordHashing: { parameters: TEST_HASHING_PARAMETERS },
      ...overrides,
    });
    running.push(harness);
    return harness;
  };

  const started = async (overrides: ServiceTestDependencies = {}, file = filename): Promise<ServiceUnderTest> => {
    const harness = service(overrides, file);
    await harness.service.start();
    return harness;
  };

  /** Base com migrações completas e uma identidade, sem serviço activo no fim. */
  const preparedDatabase = async (file = filename): Promise<void> => {
    const harness = await started({}, file);
    const user = newUser();
    await harness.service.identityProvisioning.users.create(user);
    await harness.service.identityProvisioning.credentials.create(user.id, TEST_PASSWORD);
    await harness.service.stop();
  };

  const withOwnConnection = <T>(file: string, read: (database: SqliteDatabase) => T): T => {
    const database = openSqliteDatabase({ busyTimeoutMs: 0, fileMustExist: true, filename: file });
    try {
      return read(database);
    } finally {
      database.close();
    }
  };

  const canAcquire = (file = filename): boolean => {
    try {
      openSqliteDatabase({ busyTimeoutMs: 0, exclusive: true, fileMustExist: true, filename: file }).close();
      return true;
    } catch {
      return false;
    }
  };

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'kil-business-exclusivity-db-'));
    filename = path.join(directory, 'operacional.sqlite');
  });

  afterEach(async () => {
    await killAllChildren();
    for (const harness of running.splice(0)) await harness.service.stop().catch(() => undefined);
    for (const file of restoreAcl.splice(0)) execFileSync('icacls', [file, '/reset'], { stdio: 'ignore' });
    rmSync(directory, { force: true, recursive: true });
  });

  describe('database identity', () => {
    it('[X01] resolves equivalent spellings of the same file to one identity', () => {
      writeFileSync(filename, '');
      const identity = resolveDatabaseIdentity(filename, { protectedDirectories: PROTECTED_DIRECTORIES });
      const spellings = [
        path.join(directory, '.', 'sub', '..', 'operacional.sqlite'),
        `${directory}${path.sep}${path.sep}operacional.sqlite`,
        ...(isWindows ? [filename.toUpperCase(), filename.replaceAll('\\', '/')] : []),
      ];
      mkdirSync(path.join(directory, 'sub'));
      for (const spelling of spellings) {
        const location = resolveDatabaseLocation(spelling, { protectedDirectories: PROTECTED_DIRECTORIES });
        expect(resolveDatabaseIdentity(location, { protectedDirectories: PROTECTED_DIRECTORIES }).toLowerCase()).toBe(
          identity.toLowerCase(),
        );
      }
      // Base ainda inexistente: directório final mais o nome configurado.
      const fresh = path.join(directory, 'sub', '..', 'nova.sqlite');
      expect(resolveDatabaseIdentity(path.resolve(fresh), { protectedDirectories: PROTECTED_DIRECTORIES }).toLowerCase()).toBe(
        path.join(path.dirname(identity), 'nova.sqlite').toLowerCase(),
      );
    });

    it('[X02] resolves junctions and symbolic links to the final file', (context) => {
      const real = path.join(directory, 'real');
      mkdirSync(real);
      const target = path.join(real, 'base.sqlite');
      writeFileSync(target, '');
      const identity = resolveDatabaseIdentity(target, { protectedDirectories: PROTECTED_DIRECTORIES });
      const junction = path.join(directory, 'ligacao');
      symlinkSync(real, junction, 'junction');
      expect(resolveDatabaseIdentity(path.join(junction, 'base.sqlite'), { protectedDirectories: PROTECTED_DIRECTORIES })).toBe(identity);
      expect(resolveDatabaseIdentity(path.join(junction, 'nova.sqlite'), { protectedDirectories: PROTECTED_DIRECTORIES })).toBe(
        path.join(path.dirname(identity), 'nova.sqlite'),
      );
      const fileLink = path.join(directory, 'atalho.sqlite');
      try {
        symlinkSync(target, fileLink, 'file');
      } catch (error) {
        // Ligações simbólicas de ficheiro exigem privilégio em Windows; registado como ignorado.
        if ((error as NodeJS.ErrnoException).code === 'EPERM') context.skip();
        throw error;
      }
      expect(resolveDatabaseIdentity(fileLink, { protectedDirectories: PROTECTED_DIRECTORIES })).toBe(identity);
    });

    it('[X03] refuses a database file with several hard links before opening it', async () => {
      await preparedDatabase();
      const alias = path.join(directory, 'outro-nome.sqlite');
      linkSync(filename, alias);
      const before = digestOf(filename);
      for (const location of [filename, alias]) {
        expect(() => resolveDatabaseIdentity(location, { protectedDirectories: PROTECTED_DIRECTORIES })).toThrow(
          expect.objectContaining({ reason: 'location-hard-linked' }),
        );
        const harness = service({}, location);
        await expect(harness.service.start()).rejects.toMatchObject({ reason: 'invalid-location' });
        expect(harness.connections).toHaveLength(0);
      }
      expect(digestOf(filename)).toBe(before);
    });

    it('[X04] refuses network, UNC and device paths', () => {
      const paths = [
        '\\\\servidor\\partilha\\kil.sqlite',
        '//servidor/partilha/kil.sqlite',
        '\\\\?\\C:\\dados\\kil.sqlite',
        '\\\\.\\C:\\dados\\kil.sqlite',
        ...(isWindows ? [`\\\\localhost\\${filename[0] ?? 'C'}$${filename.slice(2)}`] : []),
      ];
      for (const configured of paths) {
        if (!path.isAbsolute(configured)) continue;
        expect(() => resolveDatabaseLocation(configured, { protectedDirectories: PROTECTED_DIRECTORIES })).toThrow(
          expect.objectContaining({ reason: 'location-network-path' }),
        );
        expect(() => serviceConfig(configured)).toThrow(LocalServiceConfigError);
      }
      expect(() =>
        parseLocalServiceConfig(
          {
            databasePath: '\\\\servidor\\partilha\\kil.sqlite',
            environment: 'test',
            instanceId: 'x',
            startupPolicy: { onMissingDatabase: 'create', onPendingMigrations: 'apply' },
          },
          { protectedDirectories: PROTECTED_DIRECTORIES },
        ),
      ).toThrow(expect.objectContaining({ field: 'databasePath', reason: 'location-network-path' }));
    });

    it('[X05] re-applies the protected-directory policy to the final path behind a junction', async () => {
      const protectedTarget = path.join(REPOSITORY_ROOT, 'packages', 'database');
      const junction = path.join(directory, 'para-o-codigo');
      symlinkSync(protectedTarget, junction, 'junction');
      const disguised = path.join(junction, 'escondida.sqlite');
      expect(() => resolveDatabaseIdentity(disguised, { protectedDirectories: PROTECTED_DIRECTORIES })).toThrow(
        expect.objectContaining({ reason: 'location-inside-protected-directory' }),
      );
      const harness = service({}, disguised);
      await expect(harness.service.start()).rejects.toMatchObject({ reason: 'invalid-location' });
      expect(existsSync(path.join(protectedTarget, 'escondida.sqlite'))).toBe(false);
    });

    it('[X06] refuses a directory configured as the database file', async () => {
      mkdirSync(filename);
      expect(() => resolveDatabaseIdentity(filename, { protectedDirectories: PROTECTED_DIRECTORIES })).toThrow(
        expect.objectContaining({ reason: 'location-not-a-file' }),
      );
      const harness = service();
      await expect(harness.service.start()).rejects.toMatchObject({ reason: 'invalid-location' });
    });
  });

  describe('exclusive acquisition', () => {
    it('[X07] holds the operating-system lock from opening until close', () => {
      const owner = openSqliteDatabase({ exclusive: true, filename });
      expect(owner.pragma('locking_mode', { simple: true })).toBe('exclusive');
      expect(owner.pragma('journal_mode', { simple: true })).toBe('wal');
      // Antes de qualquer esquema: a segunda ligação não chega a ler.
      expect(() => openSqliteDatabase({ busyTimeoutMs: 0, filename })).toThrow(expect.objectContaining({ code: 'SQLITE_BUSY' }));
      expect(() => openSqliteDatabase({ busyTimeoutMs: 0, exclusive: true, filename })).toThrow(
        expect.objectContaining({ code: 'SQLITE_BUSY' }),
      );
      owner.close();
      expect(canAcquire()).toBe(true);
      expect(() => openSqliteDatabase({ exclusive: true, filename: ':memory:' })).toThrow(RangeError);
    });

    it('[X08] verifies ownership and fails closed on a connection that does not hold the lock', () => {
      const owner = openSqliteDatabase({ exclusive: true, filename });
      expect(() => verifyExclusiveOwnership(owner, filename)).not.toThrow();
      // A segunda ligação tem de ser recusada por bloqueio: outro erro ou sucesso falham fechado.
      const free = path.join(directory, 'livre.sqlite');
      openSqliteDatabase({ filename: free }).close();
      for (const probe of [path.join(directory, 'inexistente.sqlite'), free]) {
        expect(() => verifyExclusiveOwnership(owner, probe)).toThrow(expect.objectContaining({ reason: 'exclusive-lock-unverified' }));
      }
      owner.close();
      expect(() => verifyExclusiveOwnership(owner, filename)).toThrow(expect.objectContaining({ reason: 'exclusive-lock-unverified' }));
      const shared = openSqliteDatabase({ filename });
      expect(() => verifyExclusiveOwnership(shared, filename)).toThrow(expect.objectContaining({ reason: 'exclusive-lock-unverified' }));
      shared.close();
    });

    it('[X09] refuses to start when an injected opener does not acquire exclusivity, before any migration', async () => {
      const harness = createServiceUnderTest(serviceConfig(filename), (options) =>
        openSqliteDatabase({ ...options, exclusive: false }),
      );
      running.push(harness);
      await expect(harness.service.start()).rejects.toMatchObject({ reason: 'database-open-failed' });
      expect(harness.service.state).toBe('FAILED');
      expect(harness.connections.every((connection) => !connection.open)).toBe(true);
      expect(withOwnConnection(filename, (database) => database.prepare('SELECT count(*) FROM sqlite_schema').pluck().get())).toBe(0);
      expect(harness.records().some((record) => record['event'] === 'service.database_ownership_acquired')).toBe(false);
    });

    it('[X17] holds the lock when the opening returns, before the service reads or writes anything', async () => {
      await preparedDatabase();
      const secondRefusedAtOpening: boolean[] = [];
      const harness = createServiceUnderTest(serviceConfig(filename), (options) => {
        const connection = openSqliteDatabase(options);
        let secondRefused = false;
        try {
          openSqliteDatabase({ busyTimeoutMs: 0, filename: options.filename }).close();
        } catch (error) {
          secondRefused = (error as { readonly code?: unknown }).code === 'SQLITE_BUSY';
        }
        secondRefusedAtOpening.push(secondRefused);
        return connection;
      });
      running.push(harness);
      await harness.service.start();
      expect(secondRefusedAtOpening).toEqual([true]);
      const events = harness.records().map((record) => record['event']);
      expect(events.indexOf('service.database_ownership_acquired')).toBeLessThan(events.indexOf('service.sessions_reset'));
      expect(events.indexOf('service.database_ownership_acquired')).toBeGreaterThan(-1);
    });

    it('[X10] validates the configured lock timeout', () => {
      for (const databaseLockTimeoutMs of [-1, 1.5, 30_001, Number.NaN]) {
        expect(() => service({ databaseLockTimeoutMs })).toThrow(RangeError);
      }
      expect(() => service({ databaseLockTimeoutMs: 0 })).not.toThrow();
      expect(DEFAULT_DATABASE_LOCK_TIMEOUT_MS).toBe(2000);
    });
  });

  describe('lifecycle in one process', () => {
    it(
      '[X11] refuses a second service with database-locked within the bounded wait, leaving the owner intact',
      async () => {
        const owner = await started();
        const user = newUser();
        await owner.service.identityProvisioning.users.create(user);
        await owner.service.identityProvisioning.credentials.create(user.id, TEST_PASSWORD);
        const authenticated = await owner.service.authentication.authenticate(user.username, TEST_PASSWORD);
        if (!authenticated.ok) throw new Error('Autenticação esperada.');
        const created = await owner.service.sessions.create(authenticated.identity);
        if (!created.ok) throw new Error('Sessão esperada.');

        const second = service({ databaseLockTimeoutMs: 300 });
        const before = performance.now();
        await expect(second.service.start()).rejects.toMatchObject({ reason: 'database-locked' });
        const elapsed = performance.now() - before;
        expect(elapsed).toBeGreaterThanOrEqual(250);
        expect(elapsed).toBeLessThan(300 + 3000);
        expect(second.service.state).toBe('FAILED');
        expect(second.service.lastFailure).toBe('database-locked');
        expect(second.connections.every((connection) => !connection.open)).toBe(true);
        const events = second.records().map((record) => record['event']);
        expect(events).not.toContain('service.database_opened');
        expect(events).not.toContain('service.sessions_reset');
        expect(JSON.stringify(second.records())).not.toContain(directory);

        await expect(owner.service.sessions.validate(created.session.token)).resolves.toMatchObject({ ok: true });
        expect(owner.service.state).toBe('READY');
        // Nova tentativa legítima depois de o proprietário libertar a base.
        await owner.service.stop();
        await second.service.start();
        expect(second.service.state).toBe('READY');
        await expect(second.service.sessions.validate(created.session.token)).resolves.toEqual({ ok: false, reason: 'invalid-session' });
      },
      SERVICE_TEST_TIMEOUT,
    );

    it(
      '[X12] releases the lock when startup fails, including after a failed migration',
      async () => {
        const legacy = openSqliteDatabase({ filename });
        runMigrations(legacy, MIGRATIONS.slice(0, 4));
        legacy.close();
        const strict = createServiceUnderTest(
          serviceConfig(filename, { startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'fail' } }),
        );
        running.push(strict);
        await expect(strict.service.start()).rejects.toMatchObject({ reason: 'pending-migrations' });
        expect(canAcquire()).toBe(true);

        // Migração 5 impedida por um objecto pré-existente com o mesmo nome: falha e reverte.
        const blocker = openSqliteDatabase({ filename });
        blocker.exec(`CREATE TRIGGER local_sessions_insert_requires_new_session BEFORE INSERT ON local_sessions
          BEGIN SELECT 1; END;`);
        blocker.close();
        await expect(service().service.start()).rejects.toMatchObject({ reason: 'migration-failed' });
        expect(canAcquire()).toBe(true);
        expect(
          withOwnConnection(filename, (database) => database.prepare('SELECT max(version) FROM schema_migrations').pluck().get()),
        ).toBe(4);
      },
      SERVICE_TEST_TIMEOUT,
    );

    it(
      '[X13] releases on stop, reacquires on restart and never reopens after STOPPED',
      async () => {
        const harness = await started();
        const staleCompanies = harness.service.companies;
        expect(canAcquire()).toBe(false);
        await harness.service.stop();
        expect(harness.connections.every((connection) => !connection.open)).toBe(true);
        expect(canAcquire()).toBe(true);
        const company = newCompany();
        await expect(staleCompanies.findById(contextFor(company.tenantId), company.id)).rejects.toMatchObject({ reason: 'not-ready' });
        expect(harness.connections).toHaveLength(1);
        expect(canAcquire()).toBe(true);

        await harness.service.start();
        expect(harness.connections).toHaveLength(2);
        expect(canAcquire()).toBe(false);
        await harness.service.stop();
        expect(canAcquire()).toBe(true);
      },
      SERVICE_TEST_TIMEOUT,
    );

    it(
      '[X14] distinguishes a locked database from missing, corrupt, read-only and invalid ones',
      async () => {
        const failureOf = async (file: string, overrides: Readonly<Record<string, unknown>> = {}): Promise<unknown> => {
          const harness = createServiceUnderTest(serviceConfig(file, overrides), undefined, { databaseLockTimeoutMs: 0 });
          running.push(harness);
          await harness.service.start().catch(() => undefined);
          expect(JSON.stringify(harness.records())).not.toContain(directory);
          return harness.service.lastFailure;
        };
        const missingPolicy = { startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'apply' } };

        expect(await failureOf(path.join(directory, 'ausente.sqlite'), missingPolicy)).toBe('database-missing');
        expect(await failureOf(path.join(directory, 'sem-pasta', 'x.sqlite'))).toBe('database-open-failed');

        const corrupt = path.join(directory, 'corrompida.sqlite');
        writeFileSync(corrupt, randomBytes(8192));
        expect(await failureOf(corrupt)).toBe('database-corrupt');

        const readOnly = path.join(directory, 'so-leitura.sqlite');
        await preparedDatabase(readOnly);
        chmodSync(readOnly, 0o444);
        try {
          expect(await failureOf(readOnly)).toBe('database-access-denied');
        } finally {
          chmodSync(readOnly, 0o666);
        }

        const owner = await started();
        expect(await failureOf(filename)).toBe('database-locked');
        await owner.service.stop();
        expect(await failureOf(filename)).toBeUndefined();
      },
      SERVICE_TEST_TIMEOUT,
    );

    it.skipIf(!isWindows)(
      '[X15] reports access denied for a database the account cannot write (Windows ACL)',
      async () => {
        await preparedDatabase();
        const user = process.env['USERNAME'] ?? '';
        execFileSync('icacls', [filename, '/deny', `${user}:(W,D)`], { stdio: 'ignore' });
        restoreAcl.push(filename);
        const harness = createServiceUnderTest(serviceConfig(filename), undefined, { databaseLockTimeoutMs: 0 });
        running.push(harness);
        await expect(harness.service.start()).rejects.toMatchObject({ reason: 'database-access-denied' });

        // Ficheiro acessível num directório onde não se pode criar o ficheiro WAL.
        const folder = path.join(directory, 'pasta-restrita');
        mkdirSync(folder);
        const inFolder = path.join(folder, 'base.sqlite');
        await preparedDatabase(inFolder);
        execFileSync('icacls', [folder, '/deny', `${user}:(AD,WD)`], { stdio: 'ignore' });
        restoreAcl.push(folder);
        const restricted = createServiceUnderTest(serviceConfig(inFolder), undefined, { databaseLockTimeoutMs: 0 });
        running.push(restricted);
        await expect(restricted.service.start()).rejects.toMatchObject({ reason: 'database-access-denied' });
      },
      SERVICE_TEST_TIMEOUT,
    );

    it(
      '[X16] supports a consistent backup through the owning connection and a restore to a separate database',
      async () => {
        const owner = await started();
        const first = newUser();
        const second = newUser();
        for (const user of [first, second]) {
          await owner.service.identityProvisioning.users.create(user);
          await owner.service.identityProvisioning.credentials.create(user.id, TEST_PASSWORD);
        }
        const connection = owner.connections[0];
        if (connection === undefined) throw new Error('Ligação esperada.');

        // A cópia simples do ficheiro activo não é impedida, mas não inclui o que está no WAL.
        const rawCopy = path.join(directory, 'copia-simples.sqlite');
        copyFileSync(filename, rawCopy);
        expect(existsSync(`${filename}-wal`)).toBe(true);
        expect(existsSync(`${filename}-shm`)).toBe(false);
        expect(withOwnConnection(rawCopy, (database) => database.prepare("SELECT count(*) FROM sqlite_schema WHERE name = 'users'").pluck().get())).toBe(0);

        const viaApi = path.join(directory, 'backup-api.sqlite');
        const viaVacuum = path.join(directory, 'vacuum-into.sqlite');
        await connection.backup(viaApi);
        connection.prepare('VACUUM INTO ?').run(viaVacuum);
        expect(owner.service.state).toBe('READY');

        for (const copy of [viaApi, viaVacuum]) {
          withOwnConnection(copy, (database) => {
            expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
            expect(database.prepare('SELECT count(*) FROM users').pluck().get()).toBe(2);
            expect(database.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all()).toEqual(expectedChecksums);
          });
          // Restauro para uma base separada: um serviço independente arranca sobre a cópia.
          const restored = await started({}, copy);
          await expect(restored.service.identityProvisioning.users.findById(first.id)).resolves.toMatchObject({
            username: first.username,
          });
          await restored.service.stop();
        }
        await expect(owner.service.identityProvisioning.users.findById(second.id)).resolves.toBeDefined();
      },
      SERVICE_TEST_TIMEOUT,
    );
  });

  describe('real processes', () => {
    let bundle: ChildBundle;

    beforeAll(async () => {
      bundle = await buildChildBundle();
    }, PROCESS_TEST_TIMEOUT);

    afterAll(() => {
      bundle.dispose();
    });

    const owner = async (file = filename, instanceId = 'proprietario'): Promise<{ child: TestChild; sessionId: string }> => {
      const child = spawnServiceProcess(bundle, { databasePath: file, instanceId, onMissingDatabase: 'create', onPendingMigrations: 'apply' });
      expect(await child.waitFor(processOutcome)).toMatchObject({ probe: 'ready' });
      child.send('provision');
      const provisioned = await child.waitFor(isEvent('provisioned'));
      return { child, sessionId: String(provisioned['sessionId']) };
    };

    const snapshot = async (child: TestChild): Promise<ChildEvent> => {
      const count = child.events.filter(isEvent('snapshot')).length;
      child.send('snapshot');
      return child.waitFor((event) => isEvent('snapshot')(event) && child.events.filter(isEvent('snapshot')).indexOf(event) === count);
    };

    const validate = async (child: TestChild): Promise<ChildEvent> => {
      const count = child.events.filter(isEvent('validated')).length;
      child.send('validate');
      return child.waitFor((event) => isEvent('validated')(event) && child.events.filter(isEvent('validated')).indexOf(event) === count);
    };

    const outcomes = async (children: readonly TestChild[]): Promise<ChildEvent[]> => Promise.all(children.map((child) => child.waitFor(cliOutcome)));

    const stopCli = async (child: TestChild): Promise<number | null> => {
      child.send('SIGINT');
      return child.exited;
    };

    it(
      '[X30] refuses a second real service on the same database without writing or revoking anything (PD-43)',
      async () => {
        const { child: first, sessionId } = await owner();
        const before = await snapshot(first);
        const digest = digestOf(filename);

        const second = spawnServiceCli(bundle, { databasePath: filename, instanceId: 'segundo' });
        expect(await second.waitFor(cliOutcome)).toMatchObject({ event: 'service.start_failed', reason: 'database-locked' });
        expect(await second.exited).toBe(1);
        const events = second.events.map((event) => event['event']);
        expect(events).not.toContain('service.database_opened');
        expect(events).not.toContain('service.sessions_reset');
        expect(events).not.toContain('service.ready');

        expect(digestOf(filename)).toBe(digest);
        expect(await validate(first)).toMatchObject({ ok: true });
        const after = await snapshot(first);
        expect(after).toEqual(before);
        expect(after['sessions']).toEqual([{ id: sessionId, revocation_reason: null, revoked_at: null }]);
        expect(after['migrations']).toEqual(expectedChecksums);
      },
      PROCESS_TEST_TIMEOUT,
    );

    it(
      '[X31] lets exactly one of several simultaneous starts own a new database',
      async () => {
        const contenders = Array.from({ length: 4 }, (_, index) => spawnServiceCli(bundle, { databasePath: filename, instanceId: `c${index}` }));
        const results = await outcomes(contenders);
        const winners = results.filter((event) => event['event'] === 'service.ready');
        expect(winners).toHaveLength(1);
        expect(results.filter((event) => event['reason'] === 'database-locked')).toHaveLength(3);
        const losers = contenders.filter((_, index) => results[index]?.['event'] !== 'service.ready');
        expect(await Promise.all(losers.map((child) => child.exited))).toEqual([1, 1, 1]);
        for (const loser of losers) expect(loser.events.map((event) => event['event'])).not.toContain('service.database_opened');
        const winner = contenders[results.indexOf(winners[0] as ChildEvent)] as TestChild;
        // `createdDatabase` não é afirmado: um processo recusado pode ter criado o ficheiro vazio primeiro.
        expect(winner.events.find(isEvent('service.ready'))).toMatchObject({ appliedMigrations: [1, 2, 3, 4, 5, 6, 7] });
        expect(await stopCli(winner)).toBe(0);
        withOwnConnection(filename, (database) => {
          expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
          expect(database.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all()).toEqual(expectedChecksums);
        });
      },
      PROCESS_TEST_TIMEOUT,
    );

    it(
      '[X32] lets exactly one start own an existing database without pending migrations',
      async () => {
        await preparedDatabase();
        const contenders = Array.from({ length: 3 }, (_, index) =>
          spawnServiceCli(bundle, { databasePath: filename, instanceId: `e${index}`, onMissingDatabase: 'fail', onPendingMigrations: 'fail' }),
        );
        const results = await outcomes(contenders);
        expect(results.filter((event) => event['event'] === 'service.ready')).toHaveLength(1);
        expect(results.filter((event) => event['reason'] === 'database-locked')).toHaveLength(2);
        const winner = contenders[results.findIndex((event) => event['event'] === 'service.ready')] as TestChild;
        expect(winner.events.find(isEvent('service.ready'))).toMatchObject({ appliedMigrations: [], createdDatabase: false });
        expect(await stopCli(winner)).toBe(0);
      },
      PROCESS_TEST_TIMEOUT,
    );

    it(
      '[X33] applies pending migrations exactly once under concurrent starts with the apply policy',
      async () => {
        const legacy = openSqliteDatabase({ filename });
        runMigrations(legacy, MIGRATIONS.slice(0, 4));
        legacy.close();
        const contenders = Array.from({ length: 3 }, (_, index) => spawnServiceCli(bundle, { databasePath: filename, instanceId: `m${index}` }));
        const results = await outcomes(contenders);
        const ready = results.filter((event) => event['event'] === 'service.ready');
        // E1.07-D2: a base com as migrações 1 a 4 recebe a 5 e a 6, uma única vez.
        expect(ready).toEqual([expect.objectContaining({ appliedMigrations: [5, 6, 7], schemaVersion: 7 })]);
        expect(results.filter((event) => event['reason'] === 'database-locked')).toHaveLength(2);
        const winner = contenders[results.indexOf(ready[0] as ChildEvent)] as TestChild;
        expect(await stopCli(winner)).toBe(0);
        withOwnConnection(filename, (database) => {
          expect(database.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all()).toEqual(expectedChecksums);
        });
      },
      PROCESS_TEST_TIMEOUT,
    );

    it(
      '[X34] leaves pending migrations untouched when every concurrent start uses the strict policy',
      async () => {
        const legacy = openSqliteDatabase({ filename });
        runMigrations(legacy, MIGRATIONS.slice(0, 4));
        legacy.close();
        const contenders = Array.from({ length: 3 }, (_, index) =>
          spawnServiceCli(bundle, { databasePath: filename, instanceId: `s${index}`, onPendingMigrations: 'fail' }),
        );
        const results = await outcomes(contenders);
        expect(results.every((event) => event['event'] === 'service.start_failed')).toBe(true);
        expect(results.some((event) => event['reason'] === 'pending-migrations')).toBe(true);
        expect(results.every((event) => ['pending-migrations', 'database-locked'].includes(String(event['reason'])))).toBe(true);
        expect(await Promise.all(contenders.map((child) => child.exited))).toEqual([1, 1, 1]);
        withOwnConnection(filename, (database) => {
          expect(database.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all()).toEqual(expectedChecksums.slice(0, 4));
        });
      },
      PROCESS_TEST_TIMEOUT,
    );

    it(
      '[X35] recovers after forced termination, keeping integrity and the restart revocation policy',
      async () => {
        const { child: first, sessionId } = await owner();
        const before = await snapshot(first);
        first.process.kill('SIGKILL');
        await first.exited;

        const next = spawnServiceProcess(bundle, { databasePath: filename, instanceId: 'seguinte', onMissingDatabase: 'fail', onPendingMigrations: 'fail' });
        expect(await next.waitFor(processOutcome)).toMatchObject({ probe: 'ready' });
        const after = await snapshot(next);
        expect(after['integrity']).toBe('ok');
        expect(after['users']).toEqual(before['users']);
        expect(after['credentials']).toEqual(before['credentials']);
        expect(after['migrations']).toEqual(expectedChecksums);
        expect(after['sessions']).toEqual([expect.objectContaining({ id: sessionId, revocation_reason: 'service-restarted' })]);
      },
      PROCESS_TEST_TIMEOUT,
    );

    it(
      '[X36] releases the database on Ctrl+C (SIGINT) of the real entry point',
      async () => {
        const first = spawnServiceCli(bundle, { databasePath: filename, instanceId: 'consola' });
        expect(await first.waitFor(cliOutcome)).toMatchObject({ event: 'service.ready' });
        expect(await stopCli(first)).toBe(0);
        expect(first.events.map((event) => event['event'])).toEqual(expect.arrayContaining(['service.shutdown_requested', 'service.stopped']));
        const second = spawnServiceCli(bundle, { databasePath: filename, instanceId: 'retoma' });
        expect(await second.waitFor(cliOutcome)).toMatchObject({ event: 'service.ready' });
        expect(await stopCli(second)).toBe(0);
      },
      PROCESS_TEST_TIMEOUT,
    );

    it(
      '[X37] releases the database after an unexpected failure of the owning process',
      async () => {
        const { child: first } = await owner();
        first.send('crash');
        expect(await first.exited).not.toBe(0);
        expect(first.events.some(isEvent('stopped'))).toBe(false);
        const next = spawnServiceCli(bundle, { databasePath: filename, instanceId: 'apos-falha', onMissingDatabase: 'fail' });
        expect(await next.waitFor(cliOutcome)).toMatchObject({ event: 'service.ready', appliedMigrations: [] });
        expect(await stopCli(next)).toBe(0);
        withOwnConnection(filename, (database) => {
          expect(database.pragma('integrity_check', { simple: true })).toBe('ok');
        });
      },
      PROCESS_TEST_TIMEOUT,
    );

    it(
      '[X38] keeps independent databases independent',
      async () => {
        const other = path.join(directory, 'empresa-b.sqlite');
        const { child: ownerA } = await owner(filename, 'base-a');
        const { child: ownerB } = await owner(other, 'base-b');
        const intruder = spawnServiceCli(bundle, { databasePath: filename, instanceId: 'intruso' });
        expect(await intruder.waitFor(cliOutcome)).toMatchObject({ reason: 'database-locked' });

        // Reinício legítimo de A: revoga as sessões de A e nunca as de B.
        ownerA.send('restart');
        await ownerA.waitFor((event) => isEvent('ready')(event) && ownerA.events.filter(isEvent('ready')).length === 2);
        expect(await validate(ownerA)).toMatchObject({ ok: false });
        expect(await validate(ownerB)).toMatchObject({ ok: true });
        const snapshotB = await snapshot(ownerB);
        expect(snapshotB['sessions']).toEqual([expect.objectContaining({ revoked_at: null })]);
        expect(ownerB.process.exitCode).toBeNull();
      },
      PROCESS_TEST_TIMEOUT,
    );

    it(
      '[X39] refuses aliases of an owned database and configurations with hard links',
      async () => {
        const real = path.join(directory, 'real');
        mkdirSync(real);
        const target = path.join(real, 'base.sqlite');
        const { child: first } = await owner(target);
        const junction = path.join(directory, 'juncao');
        symlinkSync(real, junction, 'junction');
        const aliases = [
          path.join(junction, 'base.sqlite'),
          path.join(real, '..', 'real', '.', 'base.sqlite'),
          ...(isWindows ? [target.toUpperCase()] : []),
        ];
        for (const [index, alias] of aliases.entries()) {
          const intruder = spawnServiceCli(bundle, { databasePath: alias, instanceId: `alias${index}` });
          expect(await intruder.waitFor(cliOutcome)).toMatchObject({ reason: 'database-locked' });
          expect(await intruder.exited).toBe(1);
        }
        expect(await validate(first)).toMatchObject({ ok: true });

        first.send('stop');
        expect(await first.exited).toBe(0);
        const hardLink = path.join(directory, 'ligacao-fisica.sqlite');
        linkSync(target, hardLink);
        for (const configured of [target, hardLink]) {
          const refused = spawnServiceCli(bundle, { databasePath: configured, instanceId: 'fisica' });
          expect(await refused.waitFor(cliOutcome)).toMatchObject({ reason: 'invalid-location' });
        }
      },
      PROCESS_TEST_TIMEOUT,
    );

    it(
      '[X40] bounds the wait of a refused process to the configured timeout',
      async () => {
        await owner();
        const waiting = spawnServiceProcess(bundle, {
          databasePath: filename,
          instanceId: 'espera',
          lockTimeoutMs: 1000,
          onMissingDatabase: 'fail',
          onPendingMigrations: 'fail',
        });
        const outcome = await waiting.waitFor(processOutcome);
        expect(outcome).toMatchObject({ probe: 'failed', reason: 'database-locked', state: 'FAILED' });
        expect(Number(outcome['startMs'])).toBeGreaterThanOrEqual(900);
        expect(Number(outcome['startMs'])).toBeLessThan(1000 + 4000);
        expect(await waiting.exited).toBe(1);
      },
      PROCESS_TEST_TIMEOUT,
    );

    it(
      '[X41] opens no network or IPC servers and does not depend on Electron',
      async () => {
        const { child } = await owner();
        child.send('resources');
        const resources = await child.waitFor(isEvent('resources'));
        const active = resources['active'] as readonly string[];
        for (const kind of ['TCPServerWrap', 'TCPWrap', 'UDPWrap', 'PipeServerWrap']) expect(active).not.toContain(kind);

        const sources = (root: string): string[] =>
          readdirSync(root, { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
            .map((entry) => path.join(entry.parentPath, entry.name));
        const files = [
          ...sources(path.join(REPOSITORY_ROOT, 'packages', 'database', 'src')),
          ...sources(path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src')).filter((file) => path.basename(file) !== 'app.ts'),
        ];
        for (const file of files) {
          const source = readFileSync(file, 'utf8');
          expect(source).not.toMatch(/from '(node:)?(net|http|https|http2|dgram)'|from 'fastify'|from 'electron'|\.\/app\.js/);
        }
      },
      PROCESS_TEST_TIMEOUT,
    );
  });
});
