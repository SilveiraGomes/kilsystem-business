import { argon2, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  inspectMigrations,
  MIGRATIONS,
  migrationChecksum,
  openSqliteDatabase,
  runMigrations,
  type OpenSqliteOptions,
  type SqliteDatabase,
} from '../packages/database/src/index';
import { contextFor, newCompany, newId } from './support/fixtures';
import { newCompanyMembership, newUser, uniqueUsername } from './support/identity-fixtures';
import {
  createTestClock,
  deferred,
  OTHER_TEST_PASSWORD,
  TEST_HASHING_PARAMETERS,
  TEST_PASSWORD,
  type TestClock,
} from './support/authentication-fixtures';
import {
  createServiceUnderTest,
  inspectDatabase,
  PROTECTED_DIRECTORIES,
  REPOSITORY_ROOT,
  serviceConfig,
  type ServiceUnderTest,
} from './support/local-service-harness';
import { INSTALLATION_RECOVERY_DERIVATION } from './support/argon2-test-classification';
import { createTemporaryDatabase, type TemporaryDatabase } from './support/sqlite-harness';
import { createDerivationTracker } from './support/test-derivation';
import {
  LOCAL_SERVICE_EXIT_CODES,
  RecoveryTerminalError,
  runLocalServiceCli,
  type RecoveryTerminal,
  type RecoveryTerminalFailure,
} from '../services/local-api/src/cli';
import { LOCAL_SERVICE_ENV } from '../services/local-api/src/config';
import { InitialAdministratorProtectedError } from '../services/local-api/src/authentication/initial-administrator-protection';
import type { Argon2idDerive } from '../services/local-api/src/authentication/password-hashing';
import {
  CROCKFORD_ALPHABET,
  createRecoveryCodePresentation,
  generateRecoveryCode,
  parseRecoveryCode,
  RECOVERY_CODE_BITS,
  RECOVERY_CODE_BYTES,
  RecoveryCodeAlreadyRevealedError,
  RecoveryCodeFormatError,
} from '../services/local-api/src/authentication/recovery-code';
import {
  evaluateRecoveryAttempt,
  RECOVERY_THROTTLE_POLICY,
} from '../services/local-api/src/authentication/recovery-throttle-policy';
import type { User } from '../packages/shared-types/src/index';

/*
 * E1.07-D3-R1 — recuperação local do administrador inicial (PD-77; D-215, D-223, D-233).
 * R-F: funcionais; R-S: segurança (E1.07-D3-R1-P §16); M9: migração 9. SQLite real, bases
 * descartáveis, dados e palavras-passe fictícios.
 */

const REFUSED = /constraint|UNIQUE|CHECK|FOREIGN KEY|never|immutable|only|appended/i;

/** Somas publicadas das migrações 1 a 8 (`main` = `ce3db52`); a migração 9 não as altera. */
const PUBLISHED_CHECKSUMS_1_TO_8 = [
  'c70164d253bed3637177a1a434282a3fb9e4d16c294134dd2f6ec61dbf734b61',
  'b05636332e82baa7250873473b7c91fd0a571ec07e2b90b7ee2d236fd9bfc2d0',
  '340d886e73aae09527f46db3e3dbecfa9afc7b9fafa126e0267cea9d1d1a1f53',
  '95e09724388a7dce7e6c5588a55f3c35ee98f7a7202356885720dd7d1cdedf6e',
  'd404e58df245f3a42ed9970be395b0ae90cc7b8d0c08cdcb14d5da871823b7a4',
  'f7bf395b5827dfb64a4b2c661416b77e3dfc168c0276d6509315d174f5b3d09f',
  'a6dd64de16b2734d15be2a4714b9e6d7bb0eea9ad66a352b38eecdb758e59f7d',
  'b152678abefadee615ad90dfd487fe2e9ded8ac1e3ba7db69d332d16815d7e3f',
];

const CONFIGURATIONS = [
  { foreignKeys: true, label: 'foreign_keys ON, recursive_triggers OFF', recursiveTriggers: false },
  { foreignKeys: false, label: 'foreign_keys OFF, recursive_triggers OFF', recursiveTriggers: false },
  { foreignKeys: true, label: 'foreign_keys ON, recursive_triggers ON', recursiveTriggers: true },
  { foreignKeys: false, label: 'foreign_keys OFF, recursive_triggers ON', recursiveTriggers: true },
] as const;

const applyPragmas = (database: SqliteDatabase, configuration: (typeof CONFIGURATIONS)[number]): void => {
  database.pragma(`foreign_keys = ${configuration.foreignKeys ? 'ON' : 'OFF'}`);
  database.pragma(`recursive_triggers = ${configuration.recursiveTriggers ? 'ON' : 'OFF'}`);
};

/** Tabelas de autoridade, identidade e organização que a recuperação nunca escreve (§9). */
const AUTHORITY_TABLES = [
  'users',
  'installation_bootstrap',
  'companies',
  'branches',
  'company_memberships',
  'branch_memberships',
  'roles',
  'role_permissions',
  'role_assignments',
] as const;

const RECOVERY_TABLES = ['installation_recovery_codes', 'installation_recovery_events', 'installation_recovery_throttle'] as const;

const rows = (database: SqliteDatabase, tables: readonly string[]): Record<string, unknown[]> =>
  Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all()]));

interface CodeRow {
  readonly sequence: number;
  readonly state: string;
  readonly issuedReason: string;
}

const codes = (database: SqliteDatabase): CodeRow[] =>
  database
    .prepare(
      'SELECT sequence, state, issued_reason AS issuedReason FROM installation_recovery_codes ORDER BY sequence',
    )
    .all() as CodeRow[];

const eventKinds = (database: SqliteDatabase): string[] =>
  database.prepare('SELECT kind FROM installation_recovery_events ORDER BY sequence').pluck().all() as string[];

const credentialVersion = (database: SqliteDatabase, userId: string): number =>
  database.prepare('SELECT credential_version FROM password_credentials WHERE user_id = ?').pluck().get(userId) as number;

/**
 * Derivação (por omissão Argon2id real, através do *tracker* do ficheiro), com um gancho opcional
 * depois de cada derivação (concorrência controlada).
 */
const createDerive = (base: Argon2idDerive) => {
  const calls: { readonly memoryKiB: number; readonly passes: number; readonly tagLength: number }[] = [];
  let after: (() => Promise<void> | void) | undefined;
  const derive: Argon2idDerive = async ({ message, nonce, parameters, tagLength }) => {
    calls.push({ memoryKiB: parameters.memoryKiB, passes: parameters.passes, tagLength });
    // O gancho fica ligado à derivação que COMEÇA a seguir, não à primeira que termina: sob carga,
    // uma derivação concorrente pode terminar antes e não deve apanhá-lo.
    const hook = after;
    after = undefined;
    const result = await base({ message, nonce, parameters, tagLength });
    if (hook !== undefined) await hook();
    return result;
  };
  return {
    calls,
    derive,
    /** Executa `hook` uma vez, no fim da próxima derivação a começar. */
    afterNext: (hook: () => Promise<void> | void) => {
      after = hook;
    },
  };
};

/** Janelas de 8 caracteres (dois grupos): uma coincidência aleatória num ficheiro de teste é desprezável. */
const windowsOf = (secret: string): string[] => {
  const result: string[] = [];
  for (let index = 0; index + 8 <= secret.length; index += 4) result.push(secret.slice(index, index + 8));
  return result;
};

const normalizedOf = (formatted: string): string => parseRecoveryCode(formatted);

/**
 * Fragmentos a procurar: janelas de 8 símbolos da forma normalizada, pares de grupos com hífen
 * (`XXXX-YYYY`) e o código completo, para apanhar qualquer das duas formas de escrita.
 */
const fragmentsOf = (formatted: string): string[] => {
  const groups = formatted.split('-');
  const pairs = groups.slice(0, -1).flatMap((group, index) => (index + 1 < groups.length - 1 ? [`${group}-${groups[index + 1] ?? ''}`] : []));
  return [...windowsOf(normalizedOf(formatted)), ...pairs, formatted];
};

describe('E1.07-D3-R1 installation recovery of the initial administrator', () => {
  let temporary: TemporaryDatabase;
  let clock: TestClock;
  let hashing: ReturnType<typeof createDerive>;
  const derivation = createDerivationTracker(INSTALLATION_RECOVERY_DERIVATION);
  const running: ServiceUnderTest[] = [];

  const startedService = async (filename = temporary.filename): Promise<ServiceUnderTest> => {
    const harness = createServiceUnderTest(serviceConfig(filename), undefined, {
      clock: clock.now,
      monotonicClock: clock.monotonic,
      passwordHashing: { derive: hashing.derive, parameters: TEST_HASHING_PARAMETERS },
    });
    running.push(harness);
    await harness.service.start();
    return harness;
  };

  const inspect = <T>(read: (database: SqliteDatabase) => T): T =>
    inspectDatabase(temporary.filename, () => temporary.open(), read);

  interface Installation {
    readonly harness: ServiceUnderTest;
    readonly administrator: User;
  }

  const initialised = async (): Promise<Installation> => {
    const harness = await startedService();
    const input = { displayName: 'Administrador Fictício', id: newId(), username: uniqueUsername('admin') };
    const { initialAdministratorId } = await harness.service.identityProvisioning.installation.initialise(input, TEST_PASSWORD);
    const administrator = await harness.service.identityProvisioning.users.findById(initialAdministratorId);
    if (administrator === undefined) throw new Error('Administrador esperado.');
    return { administrator, harness };
  };

  /** Primeira emissão pela rotação autenticada; devolve o código formatado. */
  const issue = async ({ administrator, harness }: Installation, password = TEST_PASSWORD): Promise<string> => {
    const result = await harness.service.installationRecovery.rotate(administrator.username, password);
    if (!result.ok) throw new Error(`Emissão esperada: ${result.reason}`);
    return result.code.reveal();
  };

  const recoverWith = async ({ harness }: Installation, code: string, password = OTHER_TEST_PASSWORD) => {
    const result = await harness.service.installationRecovery.recover(code, password);
    return result;
  };

  const authenticates = async ({ administrator, harness }: Installation, password: string): Promise<boolean> =>
    (await harness.service.authentication.authenticate(administrator.username, password)).ok;

  beforeEach(() => {
    temporary = createTemporaryDatabase();
    clock = createTestClock();
    hashing = createDerive(derivation.derive);
    derivation.reset();
  });

  afterEach(async () => {
    for (const harness of running.splice(0)) await harness.service.stop();
    temporary.dispose();
    derivation.verifyAndReset(expect.getState().currentTestName ?? '');
  });

  describe('recovery code format (DP-01)', () => {
    it('[R-S01] generates 160 bits from the CSPRNG as 32 Crockford symbols in 8 groups with a valid check symbol', () => {
      expect(RECOVERY_CODE_BITS).toBe(160);
      const requested: number[] = [];
      const seen = new Set<string>();
      for (let sample = 0; sample < 500; sample += 1) {
        const generated = generateRecoveryCode((size) => {
          requested.push(size);
          return randomBytes(size);
        });
        expect(generated.formatted).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z*~$=U]$/);
        expect(generated.normalized).toHaveLength(32);
        for (const symbol of generated.normalized) expect(CROCKFORD_ALPHABET).toContain(symbol);
        expect(parseRecoveryCode(generated.formatted)).toBe(generated.normalized);
        seen.add(generated.normalized);
      }
      expect(seen.size).toBe(500);
      expect(new Set(requested)).toEqual(new Set([RECOVERY_CODE_BYTES]));
      expect(RECOVERY_CODE_BYTES).toBe(20);
      // Codificação exacta: 20 bytes 0xFF → 32 símbolos "Z"; 20 bytes 0x00 → 32 símbolos "0".
      expect(generateRecoveryCode((size) => Buffer.alloc(size, 0xff)).normalized).toBe('Z'.repeat(32));
      expect(generateRecoveryCode((size) => Buffer.alloc(size, 0)).normalized).toBe('0'.repeat(32));
      expect(() => generateRecoveryCode(() => Buffer.alloc(16))).toThrow(RangeError);
    });

    it('[R-F12] normalises case, spaces, O/I/L and refuses wrong length, alphabet or check symbol', () => {
      const { formatted, normalized } = generateRecoveryCode();
      const lower = formatted.toLowerCase().replace(/-/g, ' ');
      expect(parseRecoveryCode(lower)).toBe(normalized);
      const withLookalikes = formatted.replace(/0/g, 'O').replace(/1/g, 'l');
      expect(parseRecoveryCode(withLookalikes)).toBe(normalized);
      const symbols = formatted.replace(/-/g, '');
      const flipped = `${symbols.slice(0, 5)}${symbols[5] === 'A' ? 'B' : 'A'}${symbols.slice(6)}`;
      for (const malformed of [
        '',
        symbols.slice(0, -1),
        `${symbols}0`,
        flipped,
        `${symbols.slice(0, 31)}U${symbols.slice(32)}`,
        'x'.repeat(300),
        42,
        undefined,
        { toString: () => formatted },
      ]) {
        expect(() => parseRecoveryCode(malformed), String(malformed).slice(0, 40)).toThrow(RecoveryCodeFormatError);
      }
    });

    it('[R-S08a] reveals the code exactly once and never through serialisation', () => {
      const presentation = createRecoveryCodePresentation('AAAA-BBBB', 7);
      expect(JSON.stringify(presentation)).not.toContain('AAAA');
      expect(String(presentation)).not.toContain('AAAA');
      expect(presentation.reveal()).toBe('AAAA-BBBB');
      expect(() => presentation.reveal()).toThrow(RecoveryCodeAlreadyRevealedError);
      expect(presentation.sequence).toBe(7);
    });
  });

  describe('migration 9', () => {
    it('[M9-01] is additive: checksums 1-8 unchanged; upgrading a v8 database keeps every row', () => {
      expect(MIGRATIONS.slice(0, 8).map(migrationChecksum)).toEqual(PUBLISHED_CHECKSUMS_1_TO_8);
      expect(MIGRATIONS[8]).toMatchObject({ name: 'create_installation_recovery', version: 9 });
      // Só cria objectos novos `installation_recovery*`; não altera, elimina nem escreve dados existentes.
      const sql = MIGRATIONS[8]?.sql ?? '';
      expect(sql).not.toMatch(/\b(ALTER TABLE|DROP|INSERT INTO|DELETE FROM)\b|\bUPDATE\s+\w+\s+SET\b/i);
      for (const [, name] of sql.matchAll(/CREATE (?:UNIQUE )?(?:TABLE|INDEX|TRIGGER) (\w+)/g)) expect(name).toMatch(/^installation_recovery/);
      const targets = [...sql.matchAll(/\b(?:BEFORE|AFTER) (?:INSERT|UPDATE|DELETE) ON (\w+)|\bINDEX \w+\s+ON (\w+)/g)];
      expect(targets.length).toBeGreaterThanOrEqual(12);
      for (const [, trigger, index] of targets) expect(trigger ?? index).toMatch(/^installation_recovery/);

      const database = temporary.open();
      runMigrations(database, MIGRATIONS.slice(0, 8));
      const user = newUser();
      database
        .prepare(
          `INSERT INTO users (id, username, display_name, status, created_at, updated_at) VALUES (?, ?, 'Pessoa Fictícia', 'ACTIVE', ?, ?)`,
        )
        .run(user.id, user.username, user.createdAt, user.createdAt);
      const tables = () =>
        database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all();
      const before = { rows: rows(database, AUTHORITY_TABLES), tables: tables() };

      expect(inspectMigrations(database)).toMatchObject({ pendingVersions: [9] });
      expect(runMigrations(database)).toEqual({ applied: [9], currentVersion: 9 });
      expect(rows(database, AUTHORITY_TABLES)).toEqual(before.rows);
      expect(tables()).toEqual([...before.tables, ...RECOVERY_TABLES].sort());
      expect(database.prepare('SELECT checksum FROM schema_migrations WHERE version <= 8 ORDER BY version').pluck().all()).toEqual(
        PUBLISHED_CHECKSUMS_1_TO_8,
      );
      expect(database.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
      for (const table of RECOVERY_TABLES) expect(database.prepare(`SELECT count(*) FROM ${table}`).pluck().get()).toBe(0);
    });

    it('[M9-02] rolls back a failing migration 9 atomically, refuses it altered after applying and refuses a downgrade', () => {
      const database = temporary.open();
      runMigrations(database, MIGRATIONS.slice(0, 8));
      const latest = MIGRATIONS[8] as (typeof MIGRATIONS)[number];
      expect(() =>
        runMigrations(database, [...MIGRATIONS.slice(0, 8), { ...latest, sql: `${latest.sql}\nSELECT * FROM missing_table;` }]),
      ).toThrow(/missing_table/);
      expect(database.prepare("SELECT count(*) FROM sqlite_schema WHERE name LIKE 'installation_recovery%'").pluck().get()).toBe(0);
      expect(runMigrations(database)).toEqual({ applied: [9], currentVersion: 9 });
      expect(() => inspectMigrations(database, [...MIGRATIONS.slice(0, 8), { ...latest, sql: `${latest.sql}\n` }])).toThrow(
        /migration-checksum-mismatch/,
      );
      expect(() => runMigrations(database, MIGRATIONS.slice(0, 8))).toThrow(/unknown-schema-version/);
    });

    it('[M9-03] creates the tables STRICT, with the single-active partial index and rowid guards', () => {
      const database = temporary.open();
      runMigrations(database);
      for (const table of RECOVERY_TABLES) {
        expect(database.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').pluck().get(table)).toMatch(/\) STRICT$/);
      }
      expect(
        database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'installation_recovery_codes_single_active'").pluck().get(),
      ).toMatch(/WHERE state = 'ACTIVE'/);
      const triggers = database
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'installation_recovery%' ORDER BY name")
        .pluck()
        .all();
      expect(triggers).toEqual([
        'installation_recovery_codes_end_once',
        'installation_recovery_codes_insert_requires_new_active_code',
        'installation_recovery_codes_never_deleted',
        'installation_recovery_codes_rowid_immutable',
        'installation_recovery_codes_rowid_insert_requires_new_code',
        'installation_recovery_codes_rowid_positive',
        'installation_recovery_events_immutable',
        'installation_recovery_events_insert_requires_new_event',
        'installation_recovery_events_never_deleted',
        'installation_recovery_events_rowid_insert_requires_new_event',
        'installation_recovery_events_rowid_positive',
      ]);
    });
  });

  describe('first issuance (DP-03 condition) and rotation (DP-04)', () => {
    it('[R-F01] initialisation creates no code; the first code comes from the authenticated rotation and is never stored in clear', async () => {
      const installation = await initialised();
      expect(inspect(codes)).toEqual([]);
      expect(inspect(eventKinds)).toEqual([]);

      const result = await installation.harness.service.installationRecovery.rotate(installation.administrator.username, TEST_PASSWORD);
      if (!result.ok) throw new Error('Emissão esperada.');
      expect(result).toMatchObject({ issuedReason: 'first-issuance', supersededSequence: undefined });
      expect(result.code.sequence).toBe(1);
      const formatted = result.code.reveal();
      expect(inspect(codes)).toEqual([{ issuedReason: 'first-issuance', sequence: 1, state: 'ACTIVE' }]);
      expect(inspect(eventKinds)).toEqual(['code-issued']);
      const stored = inspect((database) =>
        database.prepare("SELECT hex(salt) || hex(hash) || id FROM installation_recovery_codes WHERE state = 'ACTIVE'").pluck().get(),
      ) as string;
      expect(stored).not.toContain(normalizedOf(formatted));
      // A instalação continua a ter só a âncora; nenhuma autoridade é criada.
      await expect(installation.harness.service.identityProvisioning.installation.verifyAnchor()).resolves.toMatchObject({ state: 'intact' });
    });

    it('[R-F04] rotation supersedes the previous code without knowing it; only the new one works', async () => {
      const installation = await initialised();
      const first = await issue(installation);
      const rotated = await installation.harness.service.installationRecovery.rotate(installation.administrator.username, TEST_PASSWORD);
      if (!rotated.ok) throw new Error('Rotação esperada.');
      expect(rotated).toMatchObject({ issuedReason: 'rotation', supersededSequence: 1 });
      const second = rotated.code.reveal();
      expect(inspect(codes)).toEqual([
        { issuedReason: 'first-issuance', sequence: 1, state: 'SUPERSEDED' },
        { issuedReason: 'rotation', sequence: 2, state: 'ACTIVE' },
      ]);
      await expect(recoverWith(installation, first)).resolves.toEqual({ ok: false, reason: 'invalid-recovery-code' });
      await expect(recoverWith(installation, second)).resolves.toMatchObject({ consumedSequence: 2, ok: true });
    });

    it('[R-F04b] rotation refuses wrong credentials, other identities and an administrator that is not the anchored one', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      const { service } = installation.harness;
      await expect(service.installationRecovery.rotate(installation.administrator.username, OTHER_TEST_PASSWORD)).resolves.toEqual({
        ok: false,
        reason: 'authentication-failed',
      });
      const other = newUser();
      await service.identityProvisioning.users.create(other);
      await service.identityProvisioning.credentials.create(other.id, OTHER_TEST_PASSWORD);
      await expect(service.installationRecovery.rotate(other.username, OTHER_TEST_PASSWORD)).resolves.toEqual({
        cause: 'not-initial-administrator',
        ok: false,
        reason: 'rotation-refused',
      });
      expect(inspect(codes)).toEqual([]);
      expect(inspect(eventKinds)).toEqual(['rotation-refused']);
    });

    it('[R-F09] a code lost after the commit (never presented) is replaced by a rotation with the new password', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      const code = await issue(installation);
      const recovered = await recoverWith(installation, code);
      if (!recovered.ok) throw new Error('Recuperação esperada.');
      // A apresentação falha: o código n.º 2 nunca é revelado.
      expect(inspect(codes).map((row) => row.state)).toEqual(['CONSUMED', 'ACTIVE']);
      const rotated = await installation.harness.service.installationRecovery.rotate(installation.administrator.username, OTHER_TEST_PASSWORD);
      if (!rotated.ok) throw new Error('Rotação esperada.');
      expect(inspect(codes).map((row) => row.state)).toEqual(['CONSUMED', 'SUPERSEDED', 'ACTIVE']);
      await expect(recoverWith(installation, rotated.code.reveal(), TEST_PASSWORD)).resolves.toMatchObject({ ok: true });
    });
  });

  describe('recovery', () => {
    it('[R-F02] [R-F03] replaces only the credential, consumes the code and issues the next one', async () => {
      const installation = await initialised();
      const code = await issue(installation);
      const before = inspect((database) => credentialVersion(database, installation.administrator.id));

      const result = await recoverWith(installation, code);
      if (!result.ok) throw new Error(`Recuperação esperada: ${result.reason}`);
      expect(result.consumedSequence).toBe(1);
      expect(result.code.sequence).toBe(2);
      expect(inspect((database) => credentialVersion(database, installation.administrator.id))).toBe(before + 1);
      expect(inspect(codes)).toEqual([
        { issuedReason: 'first-issuance', sequence: 1, state: 'CONSUMED' },
        { issuedReason: 'recovery', sequence: 2, state: 'ACTIVE' },
      ]);
      expect(inspect((database) => database.prepare("SELECT count(*) FROM installation_recovery_codes WHERE state = 'ACTIVE'").pluck().get())).toBe(1);
      await expect(authenticates(installation, OTHER_TEST_PASSWORD)).resolves.toBe(true);
      await expect(authenticates(installation, TEST_PASSWORD)).resolves.toBe(false);
      await expect(recoverWith(installation, result.code.reveal(), TEST_PASSWORD)).resolves.toMatchObject({ consumedSequence: 2, ok: true });
    });

    it('[R-S10b] still recovers and rotates after the system clock moved back before the code was issued', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      clock.advanceSeconds(7200);
      const code = await issue(installation);
      clock.set('2026-11-16T07:00:00.000Z');
      const recovered = await recoverWith(installation, code);
      if (!recovered.ok) throw new Error(`Recuperação esperada: ${recovered.reason}`);
      const ended = inspect(
        (database) =>
          database.prepare('SELECT issued_at AS issuedAt, ended_at AS endedAt FROM installation_recovery_codes WHERE sequence = 1').get() as {
            issuedAt: string;
            endedAt: string;
          },
      );
      expect(ended.endedAt).toBe(ended.issuedAt);
      await expect(
        installation.harness.service.installationRecovery.rotate(installation.administrator.username, OTHER_TEST_PASSWORD),
      ).resolves.toMatchObject({ ok: true });
    });

    it('[R-F05] [R-S03] refuses every consumed or superseded code of a chain exactly like a wrong code', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      const { installationRecovery } = installation.harness.service;
      const first = await issue(installation);
      const rotated = await installationRecovery.rotate(installation.administrator.username, TEST_PASSWORD);
      if (!rotated.ok) throw new Error('Rotação esperada.');
      const second = rotated.code.reveal();
      const recovered = await recoverWith(installation, second);
      if (!recovered.ok) throw new Error('Recuperação esperada.');
      const third = recovered.code.reveal();
      const rotatedAgain = await installationRecovery.rotate(installation.administrator.username, OTHER_TEST_PASSWORD);
      if (!rotatedAgain.ok) throw new Error('Rotação esperada.');
      const fourth = rotatedAgain.code.reveal();
      const wrong = generateRecoveryCode().formatted;

      for (const stale of [first, second, third, wrong]) {
        await expect(recoverWith(installation, stale, TEST_PASSWORD)).resolves.toEqual({ ok: false, reason: 'invalid-recovery-code' });
        clock.advanceSeconds(3700);
      }
      await expect(authenticates(installation, OTHER_TEST_PASSWORD)).resolves.toBe(true);
      await expect(recoverWith(installation, fourth, TEST_PASSWORD)).resolves.toMatchObject({ consumedSequence: 4, ok: true });
    });

    it('[R-F06] refuses a new password that breaks D-091 before admission, without spending attempts or the code', async () => {
      const installation = await initialised();
      const code = await issue(installation);
      const before = inspect((database) => rows(database, [...RECOVERY_TABLES, 'password_credentials']));
      for (const [password, violation] of [
        ['curta', 'too-short'],
        [installation.administrator.username, 'too-short'],
        [42, 'not-text'],
      ] as const) {
        const result = await recoverWith(installation, code, password as string);
        expect(result).toMatchObject({ ok: false, reason: 'password-rejected' });
        if (typeof password !== 'string') expect(result).toMatchObject({ violation });
      }
      expect(inspect((database) => rows(database, [...RECOVERY_TABLES, 'password_credentials']))).toEqual(before);
    });

    it('[R-F07] revokes every session and proof of the administrator only', async () => {
      const installation = await initialised();
      const { service } = installation.harness;
      const code = await issue(installation);
      const other = newUser();
      await service.identityProvisioning.users.create(other);
      await service.identityProvisioning.credentials.create(other.id, OTHER_TEST_PASSWORD);
      const login = async (username: string, password: string) => {
        const authenticated = await service.authentication.authenticate(username, password);
        if (!authenticated.ok) throw new Error('Autenticação esperada.');
        return authenticated.identity;
      };
      const adminSession = await service.sessions.create(await login(installation.administrator.username, TEST_PASSWORD));
      const otherSession = await service.sessions.create(await login(other.username, OTHER_TEST_PASSWORD));
      if (!adminSession.ok || !otherSession.ok) throw new Error('Sessões esperadas.');
      const pendingProof = await login(installation.administrator.username, TEST_PASSWORD);

      await expect(recoverWith(installation, code)).resolves.toMatchObject({ ok: true });

      await expect(service.sessions.validate(adminSession.session.token)).resolves.toMatchObject({ ok: false });
      await expect(service.sessions.validate(otherSession.session.token)).resolves.toMatchObject({ ok: true });
      await expect(service.sessions.create(pendingProof)).resolves.toMatchObject({ ok: false });
      expect(
        inspect((database) =>
          database.prepare('SELECT revocation_reason FROM local_sessions WHERE user_id = ?').pluck().all(installation.administrator.id),
        ),
      ).toEqual(['credential-replaced']);
    });

    it('[R-F08] [R-S06] leaves the anchor, identities, organisations and RBAC byte-for-byte unchanged', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      const { service } = installation.harness;
      const other = newUser();
      await service.identityProvisioning.users.create(other);
      const company = newCompany();
      const context = contextFor(company.tenantId);
      await service.companies.create(context, company);
      await service.companyMemberships.create(context, newCompanyMembership(other, company));
      const code = await issue(installation);
      const anchor = await service.identityProvisioning.installation.verifyAnchor();
      const before = inspect((database) => rows(database, AUTHORITY_TABLES));

      await expect(recoverWith(installation, code)).resolves.toMatchObject({ ok: true });

      expect(inspect((database) => rows(database, AUTHORITY_TABLES))).toEqual(before);
      await expect(service.identityProvisioning.installation.verifyAnchor()).resolves.toEqual(anchor);
      const scopes = await service.membershipScopes.evaluate(context, installation.administrator.id);
      expect(scopes).toMatchObject({ eligible: false });
    });

    it('[R-F10] [R-S09] without any code the answer and the derivation cost equal those of a wrong code', async () => {
      const installation = await initialised();
      const wrong = generateRecoveryCode().formatted;
      hashing.calls.length = 0;
      await expect(recoverWith(installation, wrong)).resolves.toEqual({ ok: false, reason: 'invalid-recovery-code' });
      const withoutCode = hashing.calls.splice(0);
      clock.advanceSeconds(3700);
      await issue(installation);
      hashing.calls.length = 0;
      await expect(recoverWith(installation, generateRecoveryCode().formatted)).resolves.toEqual({
        ok: false,
        reason: 'invalid-recovery-code',
      });
      const withCode = hashing.calls.splice(0);
      expect(withoutCode).toHaveLength(1);
      expect(withCode).toEqual(withoutCode);
      expect(inspect(codes).map((row) => row.sequence)).toEqual([1]);
    });

    it('[R-F11] records issuance, rotation, attempts and outcomes without secrets or personal data', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      const code = await issue(installation);
      await recoverWith(installation, generateRecoveryCode().formatted);
      const recovered = await recoverWith(installation, code);
      if (!recovered.ok) throw new Error('Recuperação esperada.');
      const events = inspect((database) => database.prepare('SELECT * FROM installation_recovery_events ORDER BY sequence').all()) as Record<
        string,
        unknown
      >[];
      expect(events.map((event) => [event['sequence'], event['kind'], event['reason']])).toEqual([
        [1, 'code-issued', null],
        [2, 'recovery-attempted', null],
        [3, 'recovery-failed', 'invalid-recovery-code'],
        [4, 'recovery-attempted', null],
        [5, 'recovery-succeeded', null],
      ]);
      expect(events[4]).toMatchObject({ consumed_code_sequence: 1, issued_code_sequence: 2, resulting_credential_version: 2 });
      expect(Object.keys(events[0] ?? {}).sort()).toEqual([
        'consumed_code_sequence',
        'id',
        'issued_code_sequence',
        'kind',
        'occurred_at',
        'reason',
        'resulting_credential_version',
        'sequence',
      ]);
      const serialised = JSON.stringify(events);
      for (const secret of [normalizedOf(code), installation.administrator.username, OTHER_TEST_PASSWORD, installation.administrator.id]) {
        expect(serialised).not.toContain(secret);
      }
    });

    it('[R-S07] refuses a broken anchor (three faults) and an INACTIVE administrator even with the right code, without writing', async () => {
      derivation.useDeterministic();
      const scenarios: readonly (readonly [string, (database: SqliteDatabase, userId: string) => void, string])[] = [
        [
          'administrator INACTIVE',
          (database, userId) => {
            database.prepare("UPDATE users SET status = 'INACTIVE', updated_at = '2026-11-16T08:30:00.000Z' WHERE id = ?").run(userId);
          },
          'administrator-not-active',
        ],
        [
          'credential missing',
          (database, userId) => {
            const trigger = database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'password_credentials_never_deleted'").pluck().get() as string;
            database.exec('DROP TRIGGER password_credentials_never_deleted');
            database.prepare('DELETE FROM password_credentials WHERE user_id = ?').run(userId);
            database.exec(trigger);
          },
          'anchor-not-intact',
        ],
        [
          'administrator mismatch',
          (database, userId) => {
            const trigger = database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'users_creation_immutable'").pluck().get() as string;
            database.exec('DROP TRIGGER users_creation_immutable');
            database.prepare("UPDATE users SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(userId);
            database.exec(trigger);
          },
          'anchor-not-intact',
        ],
        [
          'administrator missing',
          (database, userId) => {
            const trigger = database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'users_never_deleted'").pluck().get() as string;
            database.pragma('foreign_keys = OFF');
            database.exec('DROP TRIGGER users_never_deleted');
            database.prepare('DELETE FROM users WHERE id = ?').run(userId);
            database.exec(trigger);
          },
          'anchor-not-intact',
        ],
      ];
      // PD65-T1: cada cenário usa uma base própria; a do `beforeEach` é apagada antes de ser substituída.
      temporary.dispose();
      for (const [label, tamper, cause] of scenarios) {
        const own = createTemporaryDatabase();
        try {
          temporary = own;
          const installation = await initialised();
          const code = await issue(installation);
          inspect((database) => tamper(database, installation.administrator.id));
          const before = inspect((database) => rows(database, ['password_credentials', 'installation_recovery_codes', ...AUTHORITY_TABLES]));
          await expect(recoverWith(installation, code), label).resolves.toEqual({ cause, ok: false, reason: 'recovery-refused' });
          expect(inspect((database) => rows(database, ['password_credentials', 'installation_recovery_codes', ...AUTHORITY_TABLES])), label).toEqual(
            before,
          );
          expect(inspect(eventKinds).slice(-2), label).toEqual(['recovery-attempted', 'recovery-refused']);
          await installation.harness.service.stop();
        } finally {
          own.dispose();
        }
      }
      temporary = createTemporaryDatabase();
    });

    it('[R-S04] concurrent recoveries with the same code: exactly one commits, the other writes nothing', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      const code = await issue(installation);
      const results = await Promise.all([recoverWith(installation, code, OTHER_TEST_PASSWORD), recoverWith(installation, code, 'terceira frase fictícia longa')]);
      expect(results.filter((result) => result.ok)).toHaveLength(1);
      expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'recovery-conflict' }]);
      expect(inspect((database) => credentialVersion(database, installation.administrator.id))).toBe(2);
      expect(inspect(codes).map((row) => row.state)).toEqual(['CONSUMED', 'ACTIVE']);
      expect(inspect(eventKinds).filter((kind) => kind === 'recovery-succeeded')).toHaveLength(1);
      expect(inspect(eventKinds)).toContain('recovery-failed');
      // R1-M01 (E1.07-D3-R1-C1): o perdedor perdeu o código, não a credencial. Sem a comparação do código
      // activo, a transacção falharia na substituição da credencial e registaria `credential-changed`.
      expect(
        inspect((database) =>
          database
            .prepare(
              `SELECT kind, reason, consumed_code_sequence AS consumed, issued_code_sequence AS issued,
                      resulting_credential_version AS credentialVersion
                 FROM installation_recovery_events WHERE kind = 'recovery-failed'`,
            )
            .all(),
        ),
      ).toEqual([{ consumed: null, credentialVersion: null, issued: null, kind: 'recovery-failed', reason: 'recovery-code-changed' }]);
    });

    it('[R-S04b] a rotation concurrent with a recovery leaves exactly one consistent outcome', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      const code = await issue(installation);
      const gate = deferred();
      hashing.afterNext(() => gate.promise);
      const recovery = recoverWith(installation, code);
      await expect.poll(() => hashing.calls.length).toBeGreaterThan(0);
      const rotated = await installation.harness.service.installationRecovery.rotate(installation.administrator.username, TEST_PASSWORD);
      gate.resolve();
      expect(rotated).toMatchObject({ ok: true });
      await expect(recovery).resolves.toEqual({ ok: false, reason: 'recovery-conflict' });
      expect(inspect(codes).map((row) => row.state)).toEqual(['SUPERSEDED', 'ACTIVE']);
      await expect(authenticates(installation, TEST_PASSWORD)).resolves.toBe(true);
      expect(
        inspect((database) => database.prepare("SELECT reason FROM installation_recovery_events WHERE kind = 'recovery-failed'").pluck().all()),
      ).toEqual(['recovery-code-changed']);
    });

    /**
     * RV-R1M-03 (E1.07-D3-R1-C1): a rotação A fica parada depois da derivação do verificador, antes
     * da transacção; a rotação B corre inteira entretanto. A já não pode entregar um código.
     */
    const rotationHeldBeforeCommit = async (installation: Installation) => {
      const gate = deferred();
      let held = false;
      // Derivações da rotação: 1) autenticação, 2) verificador do novo código. O gancho fica na 2.ª.
      hashing.afterNext(() => {
        hashing.afterNext(() => {
          held = true;
          return gate.promise;
        });
      });
      const pending = installation.harness.service.installationRecovery.rotate(installation.administrator.username, TEST_PASSWORD);
      await expect.poll(() => held).toBe(true);
      return { pending, release: () => gate.resolve() };
    };

    it('[R-S04d] concurrent rotations: only the last committed code is delivered; the loser gets rotation-conflict', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      await issue(installation);
      const loser = await rotationHeldBeforeCommit(installation);
      const winner = await installation.harness.service.installationRecovery.rotate(installation.administrator.username, TEST_PASSWORD);
      if (!winner.ok) throw new Error(`Rotação esperada: ${winner.reason}`);
      const before = inspect((database) => rows(database, RECOVERY_TABLES));
      loser.release();

      await expect(loser.pending).resolves.toEqual({ ok: false, reason: 'rotation-conflict' });
      expect(inspect((database) => rows(database, RECOVERY_TABLES))).toEqual(before);
      expect(inspect(codes).map((row) => row.state)).toEqual(['SUPERSEDED', 'ACTIVE']);
      // O código entregue ao vencedor é o activo: recupera.
      await expect(recoverWith(installation, winner.code.reveal())).resolves.toMatchObject({ consumedSequence: 2, ok: true });
    });

    it('[R-S04e] concurrent first issuances: one code is issued, the other rotation is refused without writing', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      const loser = await rotationHeldBeforeCommit(installation);
      const winner = await installation.harness.service.installationRecovery.rotate(installation.administrator.username, TEST_PASSWORD);
      expect(winner).toMatchObject({ issuedReason: 'first-issuance', ok: true });
      loser.release();

      await expect(loser.pending).resolves.toEqual({ ok: false, reason: 'rotation-conflict' });
      expect(inspect(codes)).toEqual([{ issuedReason: 'first-issuance', sequence: 1, state: 'ACTIVE' }]);
      expect(inspect(eventKinds)).toEqual(['code-issued']);
    });

    it('[R-S04c] a rotation whose password was replaced during its derivation is refused without writing', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      await issue(installation);
      const before = inspect((database) => rows(database, ['installation_recovery_codes']));
      // Derivações da rotação: 1) verificação da palavra-passe (autenticação), 2) verificador do novo código.
      // Durante a 2.ª, a credencial é substituída (como faria uma recuperação concorrente).
      hashing.afterNext(() => {
        hashing.afterNext(() => {
          inspect((database) => {
            database
              .prepare(
                'UPDATE password_credentials SET hash = ?, credential_version = credential_version + 1, updated_at = ? WHERE user_id = ?',
              )
              .run(randomBytes(32), '2026-11-16T08:00:01.000Z', installation.administrator.id);
          });
        });
      });
      await expect(
        installation.harness.service.installationRecovery.rotate(installation.administrator.username, TEST_PASSWORD),
      ).resolves.toEqual({ ok: false, reason: 'rotation-conflict' });
      expect(inspect((database) => rows(database, ['installation_recovery_codes']))).toEqual(before);
      expect(inspect(eventKinds)).toEqual(['code-issued']);
    });

    it('[R-S05] a credential replaced during the derivation aborts the recovery; the code stays active', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      const code = await issue(installation);
      let tampered: unknown;
      hashing.afterNext(() => {
        inspect((database) => {
          database
            .prepare(
              'UPDATE password_credentials SET hash = ?, credential_version = credential_version + 1, updated_at = ? WHERE user_id = ?',
            )
            .run(randomBytes(32), '2026-11-16T08:00:01.000Z', installation.administrator.id);
          tampered = rows(database, ['password_credentials']);
        });
      });
      await expect(recoverWith(installation, code)).resolves.toEqual({ ok: false, reason: 'recovery-conflict' });
      // A credencial fica a escrita concorrente; a recuperação não a substitui.
      expect(tampered).toBeDefined();
      expect(inspect((database) => rows(database, ['password_credentials']))).toEqual(tampered);
      expect(inspect(codes)).toEqual([{ issuedReason: 'first-issuance', sequence: 1, state: 'ACTIVE' }]);
      expect(inspect(eventKinds).at(-1)).toBe('recovery-failed');
      expect(
        inspect((database) => database.prepare("SELECT reason FROM installation_recovery_events WHERE kind = 'recovery-failed'").pluck().get()),
      ).toBe('credential-changed');
    });

    it('[R-S05b] a failure inside the confirming transaction, after the credential and the consumption, rolls everything back', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      const { service } = installation.harness;
      const code = await issue(installation);
      const authenticated = await service.authentication.authenticate(installation.administrator.username, TEST_PASSWORD);
      if (!authenticated.ok) throw new Error('Autenticação esperada.');
      const session = await service.sessions.create(authenticated.identity);
      if (!session.ok) throw new Error('Sessão esperada.');
      // Derivações da recuperação: 1) código, 2) nova palavra-passe, 3) próximo código. Depois da 3.ª, um
      // trigger temporário (só neste ensaio) faz falhar a inserção do novo código — o último passo de escrita
      // antes do evento —, já com a credencial substituída e o código consumido na mesma transacção.
      const failNextCodeInsertion = (): void => {
        inspect((database) => {
          database.exec(`CREATE TEMP TRIGGER test_fail_next_code BEFORE INSERT ON main.installation_recovery_codes
            BEGIN SELECT RAISE(ABORT, 'ensaio: falha antes do commit'); END`);
        });
      };
      hashing.afterNext(() => {
        hashing.afterNext(() => {
          hashing.afterNext(failNextCodeInsertion);
        });
      });
      const before = inspect((database) => rows(database, ['password_credentials', 'installation_recovery_codes', 'local_sessions']));
      const eventsBefore = inspect(eventKinds);

      await expect(recoverWith(installation, code)).rejects.toThrow(/constraint/);

      expect(inspect((database) => rows(database, ['password_credentials', 'installation_recovery_codes', 'local_sessions']))).toEqual(before);
      expect(inspect(eventKinds)).toEqual([...eventsBefore, 'recovery-attempted']);
      await expect(service.sessions.validate(session.session.token)).resolves.toMatchObject({ ok: true });
      await expect(authenticates(installation, TEST_PASSWORD)).resolves.toBe(true);
      inspect((database) => database.exec('DROP TRIGGER temp.test_fail_next_code'));
      // O código não foi consumido: continua a funcionar.
      await expect(recoverWith(installation, code)).resolves.toMatchObject({ consumedSequence: 1, ok: true });
    });
  });

  describe('throttling (DP-06)', () => {
    it('[R-S02] allows 3 failures, then locks 60 s doubling up to 3600 s, never permanently; success clears the failures', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      const code = await issue(installation);
      const wrong = () => recoverWith(installation, generateRecoveryCode().formatted);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await expect(wrong()).resolves.toEqual({ ok: false, reason: 'invalid-recovery-code' });
      }
      await expect(recoverWith(installation, code)).resolves.toEqual({ ok: false, reason: 'throttled', retryAfterSeconds: 60 });
      const expectedLocks = [120, 240, 480, 960, 1920, 3600, 3600];
      for (const lock of expectedLocks) {
        clock.advanceSeconds(3600);
        await expect(wrong()).resolves.toEqual({ ok: false, reason: 'invalid-recovery-code' });
        await expect(wrong()).resolves.toEqual({ ok: false, reason: 'throttled', retryAfterSeconds: lock });
      }
      clock.advanceSeconds(3600);
      await expect(recoverWith(installation, code)).resolves.toMatchObject({ ok: true });
      expect(inspect((database) => database.prepare('SELECT failures, locked_until FROM installation_recovery_throttle').get())).toEqual({
        failures: 0,
        locked_until: null,
      });
    });

    it('[R-S02b] counts attempts before the derivation: concurrent wrong codes never exceed the free failures', async () => {
      derivation.useDeterministic();
      const installation = await initialised();
      await issue(installation);
      hashing.calls.length = 0;
      const results = await Promise.all(
        Array.from({ length: 8 }, () => recoverWith(installation, generateRecoveryCode().formatted)),
      );
      expect(results.filter((result) => !result.ok && result.reason === 'invalid-recovery-code')).toHaveLength(3);
      expect(results.filter((result) => !result.ok && result.reason === 'throttled')).toHaveLength(5);
      // Só as admitidas chegam a derivar.
      expect(hashing.calls).toHaveLength(3);
      expect(inspect((database) => database.prepare('SELECT refused_count FROM installation_recovery_throttle').pluck().get())).toBe(5);
    });

    it('[R-S10] bounds tampered locks and ignores locks written in the future', () => {
      const now = Date.parse('2026-11-16T08:00:00.000Z');
      const tampered = {
        failures: 50,
        lastAttemptAt: new Date(now).toISOString(),
        lockedUntil: '2099-01-01T00:00:00.000Z',
        refusedCount: 0,
        windowStartedAt: new Date(now).toISOString(),
      };
      expect(evaluateRecoveryAttempt(tampered, now)).toMatchObject({ allowed: false, retryAfterSeconds: 3600 });
      const future = { ...tampered, lastAttemptAt: '2030-01-01T00:00:00.000Z' };
      expect(evaluateRecoveryAttempt(future, now)).toMatchObject({ allowed: true, counted: { failures: 51 } });
      expect(evaluateRecoveryAttempt(undefined, now)).toMatchObject({ allowed: true, counted: { failures: 1, refusedCount: 0 } });
      expect(RECOVERY_THROTTLE_POLICY).toMatchObject({ baseLockSeconds: 60, failureMemorySeconds: 604800, freeFailures: 3, maxLockSeconds: 3600 });
      expect(Object.isFrozen(RECOVERY_THROTTLE_POLICY)).toBe(true);
    });

    it('[R-S11] throttled attempts are counted in one row and never grow the event log', async () => {
      const installation = await initialised();
      await issue(installation);
      for (let attempt = 1; attempt <= 3; attempt += 1) await recoverWith(installation, generateRecoveryCode().formatted);
      const eventsBefore = inspect(eventKinds).length;
      const wrong = generateRecoveryCode().formatted;
      for (let attempt = 0; attempt < 10_000; attempt += 1) {
        const result = await recoverWith(installation, wrong);
        if (result.ok || result.reason !== 'throttled') throw new Error(`Recusa por limitação esperada: ${JSON.stringify(result)}`);
      }
      expect(inspect(eventKinds)).toHaveLength(eventsBefore);
      expect(inspect((database) => database.prepare('SELECT refused_count FROM installation_recovery_throttle').pluck().get())).toBe(10_000);
    }, 120_000);
  });

  describe('schema boundary (migration 9, D-209)', () => {
    const seeded = async () => {
      const installation = await initialised();
      const code = await issue(installation);
      const recovered = await recoverWith(installation, code);
      if (!recovered.ok) throw new Error('Recuperação esperada.');
      const other = newUser();
      await installation.harness.service.identityProvisioning.users.create(other);
      return { installation, other };
    };

    it('[R-S12] [R-S13] refuses reactivation, a second ACTIVE, another anchor, verifier edits, deletion, REPLACE and rowid reuse in the four configurations', async () => {
      derivation.useDeterministic();
      const { installation, other } = await seeded();
      const admin = installation.administrator.id;
      const completedAt = inspect(
        (database) => database.prepare('SELECT completed_at FROM installation_bootstrap').pluck().get() as string,
      );
      const codeRow = (id: string, sequence: number, reason: string, state = 'ACTIVE', user = admin, at = completedAt) =>
        `INSERT INTO installation_recovery_codes (id, sequence, initial_administrator_id, anchor_completed_at, algorithm,
           algorithm_version, memory_kib, passes, parallelism, salt, hash, issued_at, issued_reason, state, ended_at)
         VALUES ('${id}', ${sequence}, '${user}', '${at}', 'argon2id', 19, 19456, 2, 1, randomblob(16), randomblob(32),
           '2026-11-16T09:00:00.000Z', '${reason}', '${state}', ${state === 'ACTIVE' ? 'NULL' : "'2026-11-16T09:00:00.000Z'"})`;
      const activeId = inspect(
        (database) => database.prepare("SELECT id FROM installation_recovery_codes WHERE state = 'ACTIVE'").pluck().get() as string,
      );
      const consumedId = inspect(
        (database) => database.prepare("SELECT id FROM installation_recovery_codes WHERE state = 'CONSUMED'").pluck().get() as string,
      );
      const eventId = inspect((database) => database.prepare('SELECT id FROM installation_recovery_events LIMIT 1').pluck().get() as string);
      const attacks: Readonly<Record<string, string>> = {
        'reactivate a consumed code': `UPDATE installation_recovery_codes SET state = 'ACTIVE', ended_at = NULL WHERE id = '${consumedId}'`,
        // Sem nenhum ACTIVE, o índice parcial já não recusa: só o trigger de transição o impede.
        'reactivate a consumed code after ending the active one': `UPDATE installation_recovery_codes SET state = 'SUPERSEDED', ended_at = '2026-11-16T09:00:00.000Z' WHERE id = '${activeId}'; UPDATE installation_recovery_codes SET state = 'ACTIVE', ended_at = NULL WHERE id = '${consumedId}'`,
        'second ACTIVE code': codeRow(randomUUID(), 3, 'rotation'),
        'second ACTIVE code with the right sequence after a fake end': codeRow(randomUUID(), 3, 'first-issuance'),
        'code bound to another identity': `UPDATE installation_recovery_codes SET state = 'SUPERSEDED', ended_at = '2026-11-16T09:00:00.000Z' WHERE id = '${activeId}'; ${codeRow(randomUUID(), 3, 'rotation', 'ACTIVE', other.id)}`,
        'code bound to another anchor instant': `UPDATE installation_recovery_codes SET state = 'SUPERSEDED', ended_at = '2026-11-16T09:00:00.000Z' WHERE id = '${activeId}'; ${codeRow(randomUUID(), 3, 'rotation', 'ACTIVE', admin, '2020-01-01T00:00:00.000Z')}`,
        'code inserted already ended': codeRow(randomUUID(), 3, 'rotation', 'CONSUMED'),
        'skipped sequence': `UPDATE installation_recovery_codes SET state = 'SUPERSEDED', ended_at = '2026-11-16T09:00:00.000Z' WHERE id = '${activeId}'; ${codeRow(randomUUID(), 9, 'rotation')}`,
        'recovery reason without a consumed predecessor': `UPDATE installation_recovery_codes SET state = 'SUPERSEDED', ended_at = '2026-11-16T09:00:00.000Z' WHERE id = '${activeId}'; ${codeRow(randomUUID(), 3, 'recovery')}`,
        'replace the verifier hash': `UPDATE installation_recovery_codes SET hash = randomblob(32) WHERE id = '${activeId}'`,
        'replace the verifier salt': `UPDATE installation_recovery_codes SET salt = randomblob(16) WHERE id = '${activeId}'`,
        'change a sequence': `UPDATE installation_recovery_codes SET sequence = 99 WHERE id = '${activeId}'`,
        'end twice': `UPDATE installation_recovery_codes SET state = 'SUPERSEDED' WHERE id = '${consumedId}'`,
        'delete codes': 'DELETE FROM installation_recovery_codes',
        'REPLACE INTO an existing code': `REPLACE INTO installation_recovery_codes SELECT * FROM installation_recovery_codes WHERE id = '${activeId}'`,
        'INSERT OR REPLACE a new ACTIVE code over the partial index': codeRow(randomUUID(), 3, 'rotation').replace('INSERT', 'INSERT OR REPLACE'),
        'UPDATE OR REPLACE a sequence onto another code': `UPDATE OR REPLACE installation_recovery_codes SET sequence = 1 WHERE id = '${activeId}'`,
        'UPDATE OR REPLACE an id onto another code': `UPDATE OR REPLACE installation_recovery_codes SET id = '${consumedId}' WHERE id = '${activeId}'`,
        'rowid change': `UPDATE installation_recovery_codes SET rowid = 999 WHERE id = '${activeId}'`,
        'explicit rowid re-use': codeRow(randomUUID(), 3, 'rotation').replace('(id,', '(rowid, id,').replace("VALUES ('", "VALUES (1, '"),
        'non-positive rowid': `UPDATE installation_recovery_codes SET state = 'SUPERSEDED', ended_at = '2026-11-16T09:00:00.000Z' WHERE id = '${activeId}'; ${codeRow(randomUUID(), 3, 'rotation').replace('(id,', '(rowid, id,').replace("VALUES ('", "VALUES (-1, '")}`,
        'alter an event': "UPDATE installation_recovery_events SET kind = 'recovery-failed', reason = 'invalid-recovery-code'",
        'delete events': 'DELETE FROM installation_recovery_events',
        'REPLACE INTO an existing event': `REPLACE INTO installation_recovery_events SELECT * FROM installation_recovery_events WHERE id = '${eventId}'`,
        're-insert an event id': `INSERT INTO installation_recovery_events (id, sequence, occurred_at, kind) VALUES ('${eventId}', 99, '2026-11-16T09:00:00.000Z', 'recovery-attempted')`,
        'event out of sequence': `INSERT INTO installation_recovery_events (id, sequence, occurred_at, kind) VALUES ('${randomUUID()}', 99, '2026-11-16T09:00:00.000Z', 'recovery-attempted')`,
        'event with a secret-shaped reason': `INSERT INTO installation_recovery_events (id, sequence, occurred_at, kind, reason) VALUES ('${randomUUID()}', (SELECT max(sequence) + 1 FROM installation_recovery_events), '2026-11-16T09:00:00.000Z', 'recovery-failed', 'AAAA-BBBB')`,
        'event rowid re-use': `INSERT INTO installation_recovery_events (rowid, id, sequence, occurred_at, kind) VALUES (1, '${randomUUID()}', (SELECT max(sequence) + 1 FROM installation_recovery_events), '2026-11-16T09:00:00.000Z', 'recovery-attempted')`,
      };
      const before = inspect((database) => rows(database, RECOVERY_TABLES.slice(0, 2)));
      for (const configuration of CONFIGURATIONS) {
        for (const [label, sql] of Object.entries(attacks)) {
          inspect((database) => {
            applyPragmas(database, configuration);
            expect(() => database.transaction(() => database.exec(sql))(), `${configuration.label}: ${label}`).toThrow(REFUSED);
          });
          expect(inspect((database) => rows(database, RECOVERY_TABLES.slice(0, 2))), `${configuration.label}: ${label}`).toEqual(before);
        }
      }
    });

    it('[R-S15] boundary: an SQL writer can still append its own verifier (D-209) and schema control removes every guard', async () => {
      const { installation } = await seeded();
      // Actor E: termina o código activo e acrescenta um verificador seu, coerente com o esquema.
      const ownCode = generateRecoveryCode();
      const ownVerifier = await new Promise<Buffer>((resolve, reject) => {
        const salt = randomBytes(16);
        argon2(
          'argon2id',
          { memory: 19456, message: Buffer.from(ownCode.normalized), nonce: salt, parallelism: 1, passes: 2, tagLength: 32 },
          (error, key) => (error ? reject(error) : resolve(Buffer.concat([salt, key]))),
        );
      });
      inspect((database) => {
        const bootstrap = database.prepare('SELECT initial_administrator_id AS id, completed_at AS at FROM installation_bootstrap').get() as {
          id: string;
          at: string;
        };
        database.transaction(() => {
          database
            .prepare("UPDATE installation_recovery_codes SET state = 'SUPERSEDED', ended_at = '2026-11-16T08:00:00.000Z' WHERE state = 'ACTIVE'")
            .run();
          database
            .prepare(
              `INSERT INTO installation_recovery_codes (id, sequence, initial_administrator_id, anchor_completed_at, algorithm,
                 algorithm_version, memory_kib, passes, parallelism, salt, hash, issued_at, issued_reason, state)
               VALUES (?, 3, ?, ?, 'argon2id', 19, 19456, 2, 1, ?, ?, '2026-11-16T08:00:00.000Z', 'rotation', 'ACTIVE')`,
            )
            .run(randomUUID(), bootstrap.id, bootstrap.at, ownVerifier.subarray(0, 16), ownVerifier.subarray(16));
        })();
      });
      await expect(recoverWith(installation, ownCode.formatted, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });
      // Actor F: sem os triggers, um evento pode ser apagado.
      inspect((database) => {
        database.exec('DROP TRIGGER installation_recovery_events_never_deleted');
        expect(database.prepare('DELETE FROM installation_recovery_events WHERE sequence = 1').run().changes).toBe(1);
      });
    });
  });

  describe('secrets and surface', () => {
    it('[R-S08] the code and the new password never reach the database file, the WAL or the logs', async () => {
      const installation = await initialised();
      const first = await issue(installation);
      const recovered = await recoverWith(installation, first);
      if (!recovered.ok) throw new Error('Recuperação esperada.');
      const second = recovered.code.reveal();
      const lines = installation.harness.lines.join('\n');
      await installation.harness.service.stop();
      const files = [temporary.filename, `${temporary.filename}-wal`, `${temporary.filename}-journal`].filter((file) => existsSync(file));
      const contents = files.map((file) => readFileSync(file).toString('latin1')).join('\n');
      for (const secret of [first, second]) {
        for (const window of fragmentsOf(secret)) {
          expect(contents).not.toContain(window);
          expect(lines).not.toContain(window);
        }
      }
      expect(contents).not.toContain(OTHER_TEST_PASSWORD);
      expect(lines).not.toContain(OTHER_TEST_PASSWORD);
    });

    it('[R-S14] exposes recovery only to the local service object: no HTTP, IPC, provisioning or tenant stores', async () => {
      const installation = await initialised();
      const { service } = installation.harness;
      expect(Object.keys(service.identityProvisioning)).not.toContain('installationRecovery');
      expect(Object.keys(service.identityProvisioning).sort()).toEqual(['credentials', 'installation', 'sessions', 'users']);
      service.transaction((stores) => {
        expect(Object.keys(stores).join(',')).not.toMatch(/recovery/i);
      });

      const read = (...segments: string[]) => readFileSync(path.join(REPOSITORY_ROOT, ...segments), 'utf8');
      const sources = (...segments: string[]) =>
        readdirSync(path.join(REPOSITORY_ROOT, ...segments), { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && /\.(ts|tsx|cts)$/.test(entry.name))
          .map((entry) => readFileSync(path.join(entry.parentPath, entry.name), 'utf8'));
      expect(read('services', 'local-api', 'src', 'app.ts')).not.toMatch(/recovery|installationRecovery/i);
      // Só código-fonte (as pastas `src`), como o teste de fronteira de E1.07-B; nunca `node_modules`.
      for (const source of [
        ...sources('apps', 'desktop', 'src'),
        ...sources('apps', 'admin-portal', 'src'),
        ...sources('services', 'central-api', 'src'),
      ]) {
        expect(source).not.toMatch(/installationRecovery|installation_recovery|recovery-cli/);
      }
      const network = /from '(electron|fastify|node:(http|https|http2|net|tls|dgram|dns|child_process))'|\bfetch\(/;
      for (const file of ['recovery-cli.ts', 'terminal.ts', path.join('authentication', 'installation-recovery.ts'), path.join('authentication', 'recovery-code.ts')]) {
        expect(read('services', 'local-api', 'src', file), file).not.toMatch(network);
      }
      // A CLI de recuperação só chega à recuperação: nunca ao provisionamento, às credenciais, à inicialização nem ao RBAC.
      expect(read('services', 'local-api', 'src', 'recovery-cli.ts')).not.toMatch(
        /identityProvisioning|\.credentials|initialise\(|internalAuthorization|companyMemberships|service\.authentication|process\.env/,
      );
      expect(read('services', 'local-api', 'src', 'recovery-cli.ts')).toMatch(/service\.installationRecovery\.(rotate|recover)/);
    });

    it('[R-S16] common operations still refuse the initial administrator, also with an upper-case identifier (RV-R4-03)', async () => {
      const installation = await initialised();
      const { credentials, users } = installation.harness.service.identityProvisioning;
      const upper = installation.administrator.id.toUpperCase() as User['id'];
      const before = inspect((database) => rows(database, ['users', 'password_credentials']));
      for (const [label, attempt] of [
        ['changeStatus', () => users.changeStatus(upper, 'INACTIVE', new Date())],
        ['credentials.create', () => credentials.create(upper, OTHER_TEST_PASSWORD)],
        ['credentials.replace', () => credentials.replace(upper, OTHER_TEST_PASSWORD)],
        ['credentials.replace (lower case)', () => credentials.replace(installation.administrator.id, OTHER_TEST_PASSWORD)],
      ] as const) {
        await expect(attempt(), label).rejects.toBeInstanceOf(InitialAdministratorProtectedError);
      }
      expect(inspect((database) => rows(database, ['users', 'password_credentials']))).toEqual(before);
    });
  });

  describe('local CLI (DP-08)', () => {
    const cliEnv = (databasePath: string) => ({
      [LOCAL_SERVICE_ENV.databasePath]: databasePath,
      [LOCAL_SERVICE_ENV.environment]: 'test',
      [LOCAL_SERVICE_ENV.instanceId]: 'recovery-cli-test',
      [LOCAL_SERVICE_ENV.logLevel]: 'debug',
      [LOCAL_SERVICE_ENV.onMissingDatabase]: 'create',
      [LOCAL_SERVICE_ENV.onPendingMigrations]: 'apply',
    });

    const CODE_PATTERN = /(?:[0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z*~$=U]/;

    /** Terminal simulado: respostas em fila; a confirmação lê o grupo do código apresentado. */
    const scriptedTerminal = (answers: string[], options: { readonly failOnCode?: boolean; readonly confirm?: boolean } = {}) => {
      const writes: string[] = [];
      const shown: string[] = [];
      const terminal: RecoveryTerminal = {
        interactive: true,
        readLine: (prompt) => {
          if (/último grupo/.test(prompt)) {
            const code = shown.at(-1) ?? '';
            return Promise.resolve(options.confirm === false ? 'ZZZZ' : (code.split('-').at(-2) ?? '').toLowerCase());
          }
          return Promise.resolve(answers.shift() ?? '');
        },
        readSecret: () => Promise.resolve(answers.shift() ?? ''),
        write: (text) => {
          const match = CODE_PATTERN.exec(text);
          if (match !== null) {
            if (options.failOnCode === true) throw new Error('Terminal indisponível.');
            shown.push(match[0]);
          }
          writes.push(text);
        },
      };
      return { shown, terminal, writes };
    };

    const run = async (args: string[], terminal: RecoveryTerminal | undefined, lines: string[]) =>
      runLocalServiceCli(
        args,
        cliEnv(temporary.filename),
        { sink: (line) => lines.push(line), terminal, waitForShutdownSignal: () => Promise.reject(new Error('não usado')) },
        { protectedDirectories: PROTECTED_DIRECTORIES },
      );

    const prepared = async (): Promise<User> => {
      const installation = await initialised();
      await installation.harness.service.stop();
      return installation.administrator;
    };

    it('[R-S17] refuses without an interactive terminal, with extra arguments and without an existing database', async () => {
      const lines: string[] = [];
      await expect(run(['recovery', 'recover'], undefined, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.invalidConfiguration);
      const notInteractive = { ...scriptedTerminal([]).terminal, interactive: false };
      await expect(run(['recovery', 'rotate'], notInteractive, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.invalidConfiguration);
      const secretInArgs = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-0';
      await expect(run(['recovery', 'recover', secretInArgs], scriptedTerminal([]).terminal, lines)).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.invalidConfiguration,
      );
      await expect(run(['recovery'], scriptedTerminal([]).terminal, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.invalidConfiguration);
      expect(lines.join('\n')).not.toContain(secretInArgs);
      expect(lines.join('\n')).toContain('recovery.terminal_required');
      // Nunca cria uma base nova, mesmo com a política "create" no ambiente.
      await expect(run(['recovery', 'recover'], scriptedTerminal(['x', 'y', 'y']).terminal, lines)).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.startupFailed,
      );
      expect(existsSync(temporary.filename)).toBe(false);
    });

    it('[R-F01b] [R-F02b] rotates and recovers through the CLI; the code only reaches the terminal, never the log', async () => {
      const administrator = await prepared();
      const lines: string[] = [];
      const rotation = scriptedTerminal([administrator.username, TEST_PASSWORD]);
      await expect(run(['recovery', 'rotate'], rotation.terminal, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.ok);
      const first = rotation.shown[0] ?? '';
      expect(first).toMatch(CODE_PATTERN);

      const recovery = scriptedTerminal([first, OTHER_TEST_PASSWORD, OTHER_TEST_PASSWORD]);
      await expect(run(['recovery', 'recover'], recovery.terminal, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.ok);
      const second = recovery.shown[0] ?? '';
      expect(second).toMatch(CODE_PATTERN);
      expect(second).not.toBe(first);

      const log = lines.join('\n');
      for (const secret of [first, second]) for (const fragment of fragmentsOf(secret)) expect(log).not.toContain(fragment);
      expect(log).not.toContain(OTHER_TEST_PASSWORD);
      expect(log).not.toContain(TEST_PASSWORD);
      expect(log).toContain('recovery.completed');

      const installation = { administrator, harness: await startedService() };
      await expect(authenticates(installation, OTHER_TEST_PASSWORD)).resolves.toBe(true);
      await expect(recoverWith(installation, first, TEST_PASSWORD)).resolves.toEqual({ ok: false, reason: 'invalid-recovery-code' });
    }, 120_000);

    it('[R-F09b] a terminal failure after the commit exits 5, keeps the committed state and a rotation recovers the situation', async () => {
      const administrator = await prepared();
      const lines: string[] = [];
      const rotation = scriptedTerminal([administrator.username, TEST_PASSWORD]);
      await run(['recovery', 'rotate'], rotation.terminal, lines);
      const first = rotation.shown[0] ?? '';

      const failing = scriptedTerminal([first, OTHER_TEST_PASSWORD, OTHER_TEST_PASSWORD], { failOnCode: true });
      await expect(run(['recovery', 'recover'], failing.terminal, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed);
      expect(lines.join('\n')).toContain('recovery.presentation_failed');
      expect(inspect(codes).map((row) => row.state)).toEqual(['CONSUMED', 'ACTIVE']);

      const unconfirmed = scriptedTerminal([administrator.username, OTHER_TEST_PASSWORD], { confirm: false });
      await expect(run(['recovery', 'rotate'], unconfirmed.terminal, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed);
      // Mostrado de novo só no mesmo processo, até 3 vezes.
      expect(unconfirmed.shown).toHaveLength(3);
      expect(new Set(unconfirmed.shown).size).toBe(1);

      const rotated = scriptedTerminal([administrator.username, OTHER_TEST_PASSWORD]);
      await expect(run(['recovery', 'rotate'], rotated.terminal, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.ok);
      expect(inspect(codes).map((row) => row.state)).toEqual(['CONSUMED', 'SUPERSEDED', 'SUPERSEDED', 'ACTIVE']);
    }, 120_000);

    it('[R-S17b] refuses while the normal service owns the database, and maps refusals to exit codes', async () => {
      const administrator = await prepared();
      const owner = await startedService();
      const lines: string[] = [];
      await expect(run(['recovery', 'rotate'], scriptedTerminal([administrator.username, TEST_PASSWORD]).terminal, lines)).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.startupFailed,
      );
      expect(lines.join('\n')).toContain('database-locked');
      await owner.service.stop();

      await expect(run(['recovery', 'rotate'], scriptedTerminal([administrator.username, OTHER_TEST_PASSWORD]).terminal, lines)).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.recoveryRefused,
      );
      await expect(run(['recovery', 'recover'], scriptedTerminal(['malformado', OTHER_TEST_PASSWORD, OTHER_TEST_PASSWORD]).terminal, lines)).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.recoveryRefused,
      );
      await expect(
        run(['recovery', 'recover'], scriptedTerminal([generateRecoveryCode().formatted, OTHER_TEST_PASSWORD, 'outra']).terminal, lines),
      ).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryRefused);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await run(['recovery', 'recover'], scriptedTerminal([generateRecoveryCode().formatted, OTHER_TEST_PASSWORD, OTHER_TEST_PASSWORD]).terminal, lines);
      }
      await expect(
        run(['recovery', 'recover'], scriptedTerminal([generateRecoveryCode().formatted, OTHER_TEST_PASSWORD, OTHER_TEST_PASSWORD]).terminal, lines),
      ).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryThrottled);
    }, 120_000);

    type Step = string | { readonly fail: RecoveryTerminalFailure | 'unexpected' } | { readonly confirm: true };

    /**
     * Terminal por passos (E1.07-D3-R1-C1): cada leitura consome um passo; a falha rejeita como o terminal real.
     * `failWrite` (E1.07-D3-R1-C2) decide se uma escrita lança; as escritas falhadas não ficam em `writes`.
     */
    const steppedTerminal = (steps: Step[], failWrite: (text: string) => Error | undefined = () => undefined) => {
      const writes: string[] = [];
      const shown: string[] = [];
      const next = (): Promise<string> => {
        const step = steps.shift();
        if (step === undefined) return Promise.reject(new RecoveryTerminalError('end-of-input'));
        if (typeof step === 'string') return Promise.resolve(step);
        if ('confirm' in step) return Promise.resolve(shown.at(-1)?.split('-').at(-2) ?? '');
        return Promise.reject(step.fail === 'unexpected' ? new Error('falha inesperada') : new RecoveryTerminalError(step.fail));
      };
      const terminal: RecoveryTerminal = {
        interactive: true,
        readLine: next,
        readSecret: next,
        write: (text) => {
          const failure = failWrite(text);
          if (failure !== undefined) throw failure;
          const match = CODE_PATTERN.exec(text);
          if (match !== null) shown.push(match[0]);
          writes.push(text);
        },
      };
      return { shown, terminal, writes };
    };

    it('[R-S17c] a terminal failure before the operation exits with its own documented code and writes nothing', async () => {
      const administrator = await prepared();
      const lines: string[] = [];
      const state = () => inspect((database) => rows(database, ['password_credentials', 'authentication_throttle', ...RECOVERY_TABLES]));
      const before = state();
      const cases: readonly (readonly [Step[], number, string])[] = [
        [[{ fail: 'interrupted' }], LOCAL_SERVICE_EXIT_CODES.recoveryCancelled, 'interrupted'],
        [[administrator.username, { fail: 'end-of-input' }], LOCAL_SERVICE_EXIT_CODES.recoveryInputEnded, 'end-of-input'],
        [[administrator.username, { fail: 'terminal-error' }], LOCAL_SERVICE_EXIT_CODES.recoveryTerminalFailed, 'terminal-error'],
        [[administrator.username, { fail: 'unsupported-key' }], LOCAL_SERVICE_EXIT_CODES.recoveryInputRejected, 'unsupported-key'],
      ];
      for (const [steps, exitCode, failure] of cases) {
        const terminal = steppedTerminal(steps);
        const logged = lines.length;
        await expect(run(['recovery', 'rotate'], terminal.terminal, lines)).resolves.toBe(exitCode);
        const entries = lines.slice(logged).map((line) => JSON.parse(line) as { event: string; terminalFailure?: string });
        expect(entries.filter((entry) => entry.event === 'recovery.input_aborted').map((entry) => entry.terminalFailure)).toEqual([failure]);
        expect(terminal.writes.join('')).toMatch(/nada foi alterado/i);
      }
      // Recuperação: a confirmação incompleta da nova palavra-passe (fim da entrada) não executa nada.
      const recover = steppedTerminal([generateRecoveryCode().formatted, OTHER_TEST_PASSWORD, { fail: 'end-of-input' }]);
      await expect(run(['recovery', 'recover'], recover.terminal, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryInputEnded);
      // Falha que não é do terminal: recusa genérica (3), também sem escrita.
      await expect(run(['recovery', 'rotate'], steppedTerminal([{ fail: 'unexpected' }]).terminal, lines)).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.recoveryRefused,
      );
      expect(lines.join('\n')).toContain('recovery.failed');

      expect(state()).toEqual(before);
      expect(lines.join('\n')).not.toContain(TEST_PASSWORD);
      expect(lines.join('\n')).not.toContain(OTHER_TEST_PASSWORD);
      // A base foi libertada (serviço parado, nenhuma transacção pendente): a operação seguinte corre.
      await expect(run(['recovery', 'rotate'], steppedTerminal([administrator.username, TEST_PASSWORD, { confirm: true }]).terminal, lines)).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.ok,
      );
    }, 120_000);

    it('[R-F09c] after the commit, an incomplete confirmation is never a confirmation; an unsupported key only repeats it', async () => {
      const administrator = await prepared();
      const lines: string[] = [];
      for (const failure of ['end-of-input', 'interrupted', 'terminal-error'] as const) {
        const terminal = steppedTerminal([administrator.username, TEST_PASSWORD, { fail: failure }]);
        await expect(run(['recovery', 'rotate'], terminal.terminal, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed);
        expect(terminal.shown).toHaveLength(1);
      }
      expect(lines.join('\n')).toContain('recovery.presentation_failed');
      // Três rotações confirmadas na base, nenhuma confirmada pelo titular.
      expect(inspect(codes).map((row) => row.state)).toEqual(['SUPERSEDED', 'SUPERSEDED', 'ACTIVE']);

      const repeated = steppedTerminal([administrator.username, TEST_PASSWORD, { fail: 'unsupported-key' }, { confirm: true }]);
      await expect(run(['recovery', 'rotate'], repeated.terminal, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.ok);
      expect(repeated.shown).toHaveLength(2);
      expect(new Set(repeated.shown).size).toBe(1);
    }, 120_000);

    /** E1.07-D3-R1-C2: execução com falhas injectadas no registo (`failLog`) ou na ligação (`openDatabase`). */
    const runFaulty = async (
      args: string[],
      terminal: RecoveryTerminal,
      lines: string[],
      faults: {
        readonly failLog?: (line: string) => boolean;
        readonly openDatabase?: (options: OpenSqliteOptions) => SqliteDatabase;
      } = {},
    ) =>
      runLocalServiceCli(
        args,
        cliEnv(temporary.filename),
        {
          sink: (line) => {
            if (faults.failLog?.(line) === true) throw new Error('registo indisponível');
            lines.push(line);
          },
          terminal,
          waitForShutdownSignal: () => Promise.reject(new Error('não usado')),
        },
        {
          protectedDirectories: PROTECTED_DIRECTORIES,
          ...(faults.openDatabase === undefined ? {} : { openDatabase: faults.openDatabase }),
        },
      );

    const eventsOf = (lines: readonly string[]): string[] => lines.map((line) => (JSON.parse(line) as { event: string }).event);
    const NOTHING_CHANGED = /nada foi alterado/i;

    /** Código emitido e confirmado pela CLI. */
    const issuedThroughCli = async (administrator: User, lines: string[], password = TEST_PASSWORD): Promise<string> => {
      const rotation = steppedTerminal([administrator.username, password, { confirm: true }]);
      await expect(run(['recovery', 'rotate'], rotation.terminal, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.ok);
      const code = rotation.shown[0] ?? '';
      expect(code).toMatch(CODE_PATTERN);
      return code;
    };

    it('[R-F09d] after a committed recovery, a failing terminal write is a presentation failure (5), never "nothing changed"', async () => {
      const administrator = await prepared();
      const lines: string[] = [];
      let code = await issuedThroughCli(administrator, lines);
      const cases: readonly (readonly [string, RegExp, () => Error])[] = [
        ['anúncio, erro genérico', /^Credencial do administrador inicial substituída/, () => new Error('terminal indisponível')],
        ['anúncio, erro do terminal', /^Credencial do administrador inicial substituída/, () => new RecoveryTerminalError('terminal-error')],
        ['apresentação do código novo', CODE_PATTERN, () => new Error('terminal indisponível')],
      ];
      for (const [index, [name, failingText, failure]] of cases.entries()) {
        const password = `${OTHER_TEST_PASSWORD} ${index}`;
        const version = inspect((database) => credentialVersion(database, administrator.id));
        const logged = lines.length;
        const terminal = steppedTerminal([code, password, password, { confirm: true }], (text) =>
          failingText.test(text) ? failure() : undefined,
        );
        await expect(run(['recovery', 'recover'], terminal.terminal, lines), name).resolves.toBe(
          LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed,
        );
        // Confirmada na base: credencial substituída, código consumido, outro activo.
        expect(inspect((database) => credentialVersion(database, administrator.id)), name).toBe(version + 1);
        expect(inspect(codes).slice(-2).map((row) => row.state), name).toEqual(['CONSUMED', 'ACTIVE']);
        const events = eventsOf(lines.slice(logged));
        expect(events, name).toEqual(expect.arrayContaining(['recovery.completed', 'recovery.presentation_failed']));
        expect(events, name).not.toContain('recovery.failed');
        expect(events, name).not.toContain('recovery.input_aborted');
        // O estado confirmado chega pelo canal que resta, sem o código e nunca como "nada foi alterado".
        const written = terminal.writes.join('');
        expect(written, name).toMatch(/FOI substituída/);
        expect(written, name).not.toMatch(NOTHING_CHANGED);
        expect(written, name).not.toMatch(CODE_PATTERN);
        expect(terminal.shown, name).toEqual([]);
        // A situação resolve-se com uma rotação com a NOVA palavra-passe.
        code = await issuedThroughCli(administrator, lines, password);
      }
      // Sem repetição automática: uma recuperação por execução.
      expect(inspect(eventKinds).filter((kind) => kind === 'recovery-succeeded')).toHaveLength(cases.length);
      expect(lines.join('\n')).not.toContain(OTHER_TEST_PASSWORD);
    }, 180_000);

    // E1.07-D3-R1-C3 (RV-C2M-01): o código é confirmado na mesma, mas a finalização incompleta já não é 0 — é 10.
    it('[R-F09e] after the commit, a failing log, every channel failing or a failing service stop keep the committed outcome', async () => {
      const administrator = await prepared();
      const lines: string[] = [];
      // Registo indisponível depois do commit: o código é apresentado e confirmado na mesma.
      const rotation = steppedTerminal([administrator.username, TEST_PASSWORD, { confirm: true }]);
      await expect(
        runFaulty(['recovery', 'rotate'], rotation.terminal, lines, { failLog: (line) => line.includes('"recovery.code_issued"') }),
      ).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete);
      const first = rotation.shown[0] ?? '';
      expect(first).toMatch(CODE_PATTERN);
      const recovery = steppedTerminal([first, OTHER_TEST_PASSWORD, OTHER_TEST_PASSWORD, { confirm: true }]);
      await expect(
        runFaulty(['recovery', 'recover'], recovery.terminal, lines, { failLog: (line) => line.includes('"recovery.completed"') }),
      ).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete);
      expect(recovery.writes.join('')).toMatch(/substituída/);
      expect(recovery.shown).toHaveLength(1);

      // Nenhum canal: depois do commit falham todas as escritas do terminal e todos os registos da recuperação.
      let committed = false;
      const silent = steppedTerminal([administrator.username, OTHER_TEST_PASSWORD, { confirm: true }], () =>
        committed ? new Error('terminal indisponível') : undefined,
      );
      const issuedBefore = inspect(codes).length;
      await expect(
        runFaulty(['recovery', 'rotate'], silent.terminal, lines, {
          failLog: (line) => {
            if (line.includes('"recovery.code_issued"')) committed = true;
            return committed && line.includes('"recovery.');
          },
        }),
      ).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed);
      expect(inspect(codes)).toHaveLength(issuedBefore + 1);
      expect(silent.shown).toEqual([]);

      // Encerramento do serviço falhado: depois do commit prevalece o desfecho confirmado (10 ou 5); antes, continua 1.
      const closeFails = (options: OpenSqliteOptions): SqliteDatabase => {
        const connection = openSqliteDatabase(options);
        const close = connection.close.bind(connection);
        return Object.assign(connection, {
          close: () => {
            close();
            throw new Error('falha ao fechar');
          },
        });
      };
      const confirmed = steppedTerminal([administrator.username, OTHER_TEST_PASSWORD, { confirm: true }]);
      await expect(runFaulty(['recovery', 'rotate'], confirmed.terminal, lines, { openDatabase: closeFails })).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete,
      );
      const unconfirmed = steppedTerminal([administrator.username, OTHER_TEST_PASSWORD, { fail: 'end-of-input' }]);
      await expect(runFaulty(['recovery', 'rotate'], unconfirmed.terminal, lines, { openDatabase: closeFails })).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed,
      );
      const refused = steppedTerminal([administrator.username, TEST_PASSWORD]);
      await expect(runFaulty(['recovery', 'rotate'], refused.terminal, lines, { openDatabase: closeFails })).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.startupFailed,
      );
      expect(lines.join('\n')).toContain('service.stop_failed');

      // A base foi libertada em todos os casos e ficou um único código activo.
      await issuedThroughCli(administrator, lines, OTHER_TEST_PASSWORD);
      expect(inspect(codes).filter((row) => row.state === 'ACTIVE')).toHaveLength(1);
      const log = lines.join('\n');
      expect(log).not.toContain(OTHER_TEST_PASSWORD);
      expect(log).not.toContain(TEST_PASSWORD);
      for (const fragment of fragmentsOf(first)) expect(log).not.toContain(fragment);
    }, 180_000);

    it('[R-S17d] a failure inside the confirming transaction exits 3 with nothing changed; a failing log before the commit still releases the database', async () => {
      const administrator = await prepared();
      const lines: string[] = [];
      const code = await issuedThroughCli(administrator, lines);
      const state = () => inspect((database) => rows(database, ['password_credentials', 'installation_recovery_codes']));
      const before = state();
      // Trigger temporário só na ligação deste serviço: a inserção do novo código falha dentro da transacção,
      // depois da substituição da credencial e do consumo do código.
      const failingInsertion = (options: OpenSqliteOptions): SqliteDatabase => {
        const connection = openSqliteDatabase(options);
        connection.exec(`CREATE TEMP TRIGGER test_fail_code_insertion BEFORE INSERT ON main.installation_recovery_codes
          BEGIN SELECT RAISE(ABORT, 'ensaio: falha antes do commit'); END`);
        return connection;
      };
      const logged = lines.length;
      const failing = steppedTerminal([code, OTHER_TEST_PASSWORD, OTHER_TEST_PASSWORD, { confirm: true }]);
      await expect(runFaulty(['recovery', 'recover'], failing.terminal, lines, { openDatabase: failingInsertion })).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.recoveryRefused,
      );
      const events = eventsOf(lines.slice(logged));
      expect(events).toContain('recovery.failed');
      expect(events).not.toContain('recovery.completed');
      expect(failing.shown).toEqual([]);
      expect(state()).toEqual(before);

      // Registo indisponível antes do commit: o código de saída próprio mantém-se e o serviço é parado.
      const interrupted = steppedTerminal([{ fail: 'interrupted' }]);
      await expect(
        runFaulty(['recovery', 'rotate'], interrupted.terminal, lines, { failLog: (line) => line.includes('"recovery.input_aborted"') }),
      ).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryCancelled);
      expect(interrupted.writes.join('')).toMatch(NOTHING_CHANGED);
      await expect(
        runFaulty(['recovery', 'rotate'], steppedTerminal([{ fail: 'unexpected' }]).terminal, lines, {
          failLog: (line) => line.includes('"recovery.failed"'),
        }),
      ).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryRefused);
      expect(state()).toEqual(before);

      // O código não foi consumido: a recuperação seguinte, sem falhas, conclui.
      const retry = steppedTerminal([code, OTHER_TEST_PASSWORD, OTHER_TEST_PASSWORD, { confirm: true }]);
      await expect(run(['recovery', 'recover'], retry.terminal, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.ok);
    }, 180_000);

    /*
     * E1.07-D3-R1-C3 — contrato pós-commit: 0 sucesso completo; 5 código não entregue ou não
     * confirmado (rotação necessária); 10 código entregue e confirmado com finalização incompleta
     * (sem rotação). Precedência 5 > 10 > 0.
     */
    const COMMITTED_INCOMPLETE = /não é necessário emitir outro código/;
    const ROTATION_NEEDED = /É necessário emitir outro/;
    const failingWrite = (pattern: RegExp) => (text: string): Error | undefined =>
      pattern.test(text) ? new Error('terminal indisponível') : undefined;
    const codesShownIn = (text: string): number => text.match(new RegExp(CODE_PATTERN.source, 'g'))?.length ?? 0;
    const statesOf = (rows: readonly CodeRow[]): string[] => rows.map((row) => row.state);
    /** Estados esperados depois de uma operação confirmada: o activo anterior termina como `ended`, mais um `ACTIVE`. */
    const afterOne = (before: readonly CodeRow[], ended: 'SUPERSEDED' | 'CONSUMED'): string[] => [
      ...before.map((row) => (row.state === 'ACTIVE' ? ended : row.state)),
      'ACTIVE',
    ];
    const recordsOf = (lines: readonly string[]) => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    /** Nenhuma ligação detém a base: uma ligação nova obtém de imediato a posse exclusiva (sem espera). */
    const reopensExclusively = (): boolean => {
      try {
        openSqliteDatabase({ busyTimeoutMs: 0, exclusive: true, fileMustExist: true, filename: temporary.filename }).close();
        return true;
      } catch {
        return false;
      }
    };
    const activeSessions = (): number =>
      inspect((database) => database.prepare('SELECT count(*) FROM local_sessions WHERE revoked_at IS NULL').pluck().get() as number);
    const expectNoSecrets = (lines: readonly string[], secrets: readonly string[], codesToHide: readonly string[]): void => {
      const log = lines.join('\n');
      for (const secret of secrets) expect(log).not.toContain(secret);
      for (const code of codesToHide) for (const fragment of fragmentsOf(code)) expect(log).not.toContain(fragment);
    };

    it('[R-F09f] (RV-C2M-01/07) a code delivered and confirmed with a failing post-commit record or final message exits 10, never rotated nor repeated', async () => {
      const administrator = await prepared();
      const lines: string[] = [];
      const secrets: string[] = [TEST_PASSWORD];
      const delivered: string[] = [await issuedThroughCli(administrator, lines)];
      let password = TEST_PASSWORD;
      const rotations: readonly (readonly [string, { readonly failLog?: string; readonly failWrite?: RegExp }])[] = [
        // P7: o registo do código JÁ confirmado pelo titular (RV-C2M-07).
        ['registo recovery.code_presented confirmado (P7)', { failLog: '"recovery.code_presented"' }],
        ['registo recovery.code_issued', { failLog: '"recovery.code_issued"' }],
        ['mensagem "Confirmado." não escrita', { failWrite: /^Confirmado\./ }],
      ];
      for (const [index, [name, fault]] of rotations.entries()) {
        const before = inspect(codes);
        const eventsBefore = inspect(eventKinds).length;
        const logged = lines.length;
        const marker = fault.failLog;
        const terminal = steppedTerminal(
          [administrator.username, password, { confirm: true }],
          fault.failWrite === undefined ? undefined : failingWrite(fault.failWrite),
        );
        await expect(
          runFaulty(['recovery', 'rotate'], terminal.terminal, lines, marker === undefined ? {} : { failLog: (line) => line.includes(marker) }),
          name,
        ).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete);
        // Uma única rotação confirmada: o anterior SUPERSEDED, o entregue é o único ACTIVE; sem segunda rotação.
        expect(statesOf(inspect(codes)), name).toEqual(afterOne(before, 'SUPERSEDED'));
        expect(inspect(eventKinds).slice(eventsBefore), name).toEqual(['code-rotated']);
        expect(terminal.shown, name).toHaveLength(1);
        const code = terminal.shown[0] ?? '';
        delivered.push(code);
        const written = terminal.writes.join('');
        expect(written.includes('Confirmado.'), name).toBe(fault.failWrite === undefined);
        expect(written, name).toMatch(COMMITTED_INCOMPLETE);
        expect(written, name).not.toMatch(ROTATION_NEEDED);
        expect(written, name).not.toMatch(NOTHING_CHANGED);
        // O aviso nunca repete o código: só a apresentação o contém.
        expect(codesShownIn(written), name).toBe(1);
        const events = eventsOf(lines.slice(logged));
        expect(events, name).toContain('recovery.finalization_incomplete');
        expect(events, name).not.toContain('recovery.presentation_failed');
        expect(events, name).not.toContain('recovery.failed');
        expect(reopensExclusively(), name).toBe(true);
        // O código entregue é o activo: a recuperação com ele conclui (0) e consome exactamente esse.
        const next = `${OTHER_TEST_PASSWORD} ${index}`;
        secrets.push(next);
        const recovery = steppedTerminal([code, next, next, { confirm: true }]);
        await expect(run(['recovery', 'recover'], recovery.terminal, lines), name).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.ok);
        delivered.push(recovery.shown[0] ?? '');
        password = next;
      }

      // F: o registo falha depois de a credencial ser substituída.
      const version = inspect((database) => credentialVersion(database, administrator.id));
      const before = inspect(codes);
      const eventsBefore = inspect(eventKinds).length;
      const replaced = `${OTHER_TEST_PASSWORD} F`;
      secrets.push(replaced);
      const recovery = steppedTerminal([delivered.at(-1) ?? '', replaced, replaced, { confirm: true }]);
      await expect(
        runFaulty(['recovery', 'recover'], recovery.terminal, lines, { failLog: (line) => line.includes('"recovery.completed"') }),
      ).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete);
      expect(inspect((database) => credentialVersion(database, administrator.id))).toBe(version + 1);
      expect(statesOf(inspect(codes))).toEqual(afterOne(before, 'CONSUMED'));
      expect(inspect(eventKinds).slice(eventsBefore)).toEqual(['recovery-attempted', 'recovery-succeeded']);
      expect(activeSessions()).toBe(0);
      const written = recovery.writes.join('');
      expect(written).toMatch(/substituída/);
      expect(written).toMatch(/NOVA palavra-passe/);
      expect(written).toMatch(COMMITTED_INCOMPLETE);
      expect(written).not.toMatch(ROTATION_NEEDED);
      expect(written).not.toMatch(NOTHING_CHANGED);
      expect(reopensExclusively()).toBe(true);
      delivered.push(recovery.shown[0] ?? '');
      // A NOVA palavra-passe está em vigor e o código entregue continua a ser o activo.
      await expect(run(['recovery', 'rotate'], steppedTerminal([administrator.username, replaced, { confirm: true }]).terminal, lines)).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.ok,
      );
      // Sem repetição: uma recuperação confirmada por execução de `recover`.
      expect(inspect(eventKinds).filter((kind) => kind === 'recovery-succeeded')).toHaveLength(rotations.length + 1);
      expectNoSecrets(lines, secrets, delivered);
    }, 240_000);

    it('[R-F09g] (RV-C2M-01/03/04) a failing service stop after a confirmed code exits 10 and still releases the database; before the commit it stays 1', async () => {
      const administrator = await prepared();
      const lines: string[] = [];
      let code = await issuedThroughCli(administrator, lines);
      let password = TEST_PASSWORD;
      const secrets: string[] = [TEST_PASSWORD];
      const delivered: string[] = [code];
      // Caminho real de RV-C2M-04: o registo da transição para STOPPING falha ANTES da libertação.
      const stops: readonly (readonly [string, 'rotate' | 'recover', string])[] = [
        ['rotate, registo da transição para STOPPING (antes da libertação)', 'rotate', '"to":"STOPPING"'],
        ['rotate, registo service.stopped (depois da libertação)', 'rotate', '"service.stopped"'],
        ['recover, registo da transição para STOPPING', 'recover', '"to":"STOPPING"'],
      ];
      for (const [index, [name, command, marker]] of stops.entries()) {
        const logged = lines.length;
        const next = `${OTHER_TEST_PASSWORD} ${index}`;
        const steps: Step[] = command === 'rotate' ? [administrator.username, password, { confirm: true }] : [code, next, next, { confirm: true }];
        const terminal = steppedTerminal(steps);
        await expect(runFaulty(['recovery', command], terminal.terminal, lines, { failLog: (line) => line.includes(marker) }), name).resolves.toBe(
          LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete,
        );
        // Na mesma execução: nenhuma ligação ficou aberta, apesar de o registo ter falhado.
        expect(reopensExclusively(), name).toBe(true);
        expect(recordsOf(lines.slice(logged)).find((record) => record['event'] === 'recovery.finalization_incomplete'), name).toMatchObject({
          command,
          secondaryChannels: 'complete',
          serviceStop: 'record-failed',
        });
        const written = terminal.writes.join('');
        expect(written, name).toContain('Confirmado.');
        expect(written, name).toMatch(/libertou a base/);
        expect(written, name).toMatch(COMMITTED_INCOMPLETE);
        expect(written, name).not.toMatch(NOTHING_CHANGED);
        expect(inspect(codes).filter((row) => row.state === 'ACTIVE'), name).toHaveLength(1);
        code = terminal.shown[0] ?? '';
        delivered.push(code);
        if (command === 'recover') {
          password = next;
          secrets.push(next);
        }
      }

      // `close()` lança sem fechar: a libertação NÃO é confirmada e a mensagem di-lo, sem fingir que a base ficou livre.
      const realCloses: (() => void)[] = [];
      const closeLeaks = (options: OpenSqliteOptions): SqliteDatabase => {
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
      };
      const leaking = steppedTerminal([administrator.username, password, { confirm: true }]);
      const leaked = lines.length;
      await expect(runFaulty(['recovery', 'rotate'], leaking.terminal, lines, { openDatabase: closeLeaks })).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete,
      );
      expect(leaking.writes.join('')).toMatch(/fica livre quando este processo terminar/);
      expect(recordsOf(lines.slice(leaked)).find((record) => record['event'] === 'recovery.finalization_incomplete')).toMatchObject({
        serviceStop: 'release-failed',
      });
      expect(reopensExclusively()).toBe(false);
      for (const close of realCloses.splice(0)) close();
      expect(reopensExclusively()).toBe(true);
      delivered.push(leaking.shown[0] ?? '');

      // Precedência: código não confirmado com `stop()` falhado continua 5; recusa antes do commit continua 1.
      const failingStop = { failLog: (line: string) => line.includes('"to":"STOPPING"') };
      const unconfirmed = steppedTerminal([administrator.username, password, { fail: 'end-of-input' }]);
      await expect(runFaulty(['recovery', 'rotate'], unconfirmed.terminal, lines, failingStop)).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed,
      );
      expect(unconfirmed.writes.join('')).toMatch(ROTATION_NEEDED);
      expect(unconfirmed.writes.join('')).not.toMatch(COMMITTED_INCOMPLETE);
      delivered.push(unconfirmed.shown[0] ?? '');
      const before = inspect((database) => rows(database, ['password_credentials', ...RECOVERY_TABLES]));
      await expect(runFaulty(['recovery', 'rotate'], steppedTerminal([administrator.username, 'palavra errada']).terminal, lines, failingStop)).resolves.toBe(
        LOCAL_SERVICE_EXIT_CODES.startupFailed,
      );
      // A recusa só acrescenta a contagem da limitação da autenticação; os códigos e a credencial não mudam.
      expect(inspect((database) => rows(database, ['password_credentials', 'installation_recovery_codes']))).toEqual({
        installation_recovery_codes: before['installation_recovery_codes'],
        password_credentials: before['password_credentials'],
      });
      expect(reopensExclusively()).toBe(true);

      // Arranque recusado (base detida) com o registo do encerramento a falhar: continua 1, sem rejeitar.
      const owner = await startedService();
      await expect(
        runFaulty(['recovery', 'rotate'], steppedTerminal([administrator.username, password]).terminal, lines, {
          failLog: (line) => line.includes('"to":"STOPPED"'),
        }),
      ).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.startupFailed);
      await owner.service.stop();

      // Recuperação posterior: a rotação seguinte, sem falhas, conclui com um único ACTIVE.
      await issuedThroughCli(administrator, lines, password);
      expect(inspect(codes).filter((row) => row.state === 'ACTIVE')).toHaveLength(1);
      expectNoSecrets(lines, secrets, delivered);
    }, 240_000);

    it('[R-F09h] (RV-C2M-02) an undelivered or unconfirmed code exits 5 with the exact phase reached, never "confirmed" nor "nothing changed"', async () => {
      const administrator = await prepared();
      const lines: string[] = [];
      const code = await issuedThroughCli(administrator, lines);
      const delivered: string[] = [code];

      // `recover` com o anúncio falhado: o código nem chega a ser revelado.
      const replaced = `${OTHER_TEST_PASSWORD} H`;
      const announcement = steppedTerminal([code, replaced, replaced, { confirm: true }], failingWrite(/^Credencial do administrador inicial substituída/));
      const logged = lines.length;
      await expect(run(['recovery', 'recover'], announcement.terminal, lines)).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed);
      const unpresented = announcement.writes.join('');
      expect(unpresented).toMatch(/FOI substituída[^\n]*mas o novo código de recuperação não foi apresentado\. É necessário emitir outro[^\n]*NOVA palavra-passe/);
      expect(codesShownIn(unpresented)).toBe(0);
      expect(recordsOf(lines.slice(logged)).find((record) => record['event'] === 'recovery.presentation_failed')).toMatchObject({
        presentation: 'not-presented',
      });

      const cases: readonly (readonly [string, Step[], RegExp | undefined, RegExp, string, number])[] = [
        ['código não escrito', [{ confirm: true }], CODE_PATTERN, /FOI emitido e já está activo, mas a apresentação falhou e pode ter ficado incompleta no ecrã\./, 'partially-presented', 0],
        ['fim da entrada na confirmação', [{ fail: 'end-of-input' }], undefined, /foi apresentado, mas não foi confirmado que ficou guardado\./, 'presented-unconfirmed', 1],
        ['Ctrl+C na confirmação', [{ fail: 'interrupted' }], undefined, /foi apresentado, mas não foi confirmado que ficou guardado\./, 'presented-unconfirmed', 1],
        ['erro do terminal na confirmação', [{ fail: 'terminal-error' }], undefined, /foi apresentado, mas não foi confirmado que ficou guardado\./, 'presented-unconfirmed', 1],
        ['três confirmações erradas', ['', '', ''], undefined, /A confirmação falhou\.\n[^\n]*foi apresentado, mas não foi confirmado que ficou guardado\./, 'presented-unconfirmed', 3],
        ['nova apresentação falha depois de uma confirmação errada', ['', { confirm: true }], /^Não coincide/, /foi apresentado, mas não foi confirmado que ficou guardado\./, 'presented-unconfirmed', 1],
      ];
      for (const [name, confirmation, failWrite, expected, gap, shownTimes] of cases) {
        const before = inspect(codes);
        const logged = lines.length;
        const terminal = steppedTerminal(
          [administrator.username, replaced, ...confirmation],
          failWrite === undefined ? undefined : failingWrite(failWrite),
        );
        await expect(run(['recovery', 'rotate'], terminal.terminal, lines), name).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed);
        expect(statesOf(inspect(codes)), name).toEqual(afterOne(before, 'SUPERSEDED'));
        const written = terminal.writes.join('');
        expect(written, name).toMatch(expected);
        expect(written, name).toMatch(ROTATION_NEEDED);
        expect(written, name).not.toContain('Confirmado.');
        expect(written, name).not.toMatch(COMMITTED_INCOMPLETE);
        expect(written, name).not.toMatch(NOTHING_CHANGED);
        expect(written, name).not.toContain('não foi possível apresentá-lo');
        // A mensagem nunca contém o código: só as apresentações completas o contêm.
        expect(codesShownIn(written), name).toBe(shownTimes);
        expect(terminal.shown, name).toHaveLength(shownTimes);
        const record = recordsOf(lines.slice(logged)).find(
          (entry) => entry['event'] === 'recovery.presentation_failed' || (entry['event'] === 'recovery.code_presented' && entry['confirmed'] === false),
        );
        expect(record, name).toMatchObject({ presentation: gap });
        expect(eventsOf(lines.slice(logged)), name).not.toContain('recovery.finalization_incomplete');
        delivered.push(...terminal.shown);
      }

      // Precedência: um registo falhado (seria 10) com a confirmação incompleta continua 5.
      const both = steppedTerminal([administrator.username, replaced, { fail: 'end-of-input' }]);
      await expect(
        runFaulty(['recovery', 'rotate'], both.terminal, lines, { failLog: (line) => line.includes('"recovery.code_issued"') }),
      ).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed);
      delivered.push(...both.shown);

      // C: depois do commit falham todas as escritas e todos os registos, incluindo os do encerramento.
      let committed = false;
      const silent = steppedTerminal([administrator.username, replaced, { confirm: true }], () => (committed ? new Error('terminal indisponível') : undefined));
      const issuedBefore = inspect(codes).length;
      await expect(
        runFaulty(['recovery', 'rotate'], silent.terminal, lines, {
          failLog: (line) => {
            if (line.includes('"recovery.code_issued"')) committed = true;
            return committed;
          },
        }),
      ).resolves.toBe(LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed);
      expect(inspect(codes)).toHaveLength(issuedBefore + 1);
      expect(silent.writes.join('')).not.toMatch(CODE_PATTERN);
      expect(reopensExclusively()).toBe(true);

      // Recuperação posterior com a palavra-passe em vigor.
      await issuedThroughCli(administrator, lines, replaced);
      expect(inspect(codes).filter((row) => row.state === 'ACTIVE')).toHaveLength(1);
      expectNoSecrets(lines, [TEST_PASSWORD, replaced], delivered);
    }, 240_000);
  });
});
