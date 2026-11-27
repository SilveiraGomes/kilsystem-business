import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classifyStoredRolePermission,
  createSqliteAuthorizationPersistence,
  createSqliteMembershipPersistence,
  createSqliteTenantPersistence,
  createSqliteUserDirectory,
  inspectMigrations,
  MIGRATIONS,
  migrationChecksum,
  PersistenceError,
  requireOperationalPermissionCatalog,
  runMigrations,
  type SqliteAuthorizationPersistence,
  type SqliteDatabase,
} from '../packages/database/src/index';
import {
  AuthorizationContractError,
  createBranch,
  createExperimentalPermissionCatalog,
  evaluateAuthorizationFacts,
  inspectDomainDecision,
  isOfficialDomainGrant,
  OFFICIAL_PERMISSION_CATALOG,
  parsePermissionCode,
  type AuthorizationDecision,
  type Branch,
  type Company,
  type CompanyMembership,
  type PermissionCatalog,
  type Role,
  type User,
} from '../packages/shared-types/src/index';
import {
  createInternalDomainAuthorizationEvaluator,
  requireDomainEvaluationCatalog,
} from '../services/local-api/src/authorization/domain-authorization-engine';
import {
  assignAtBranch,
  assignCompanyWide,
  branchTarget,
  companyTarget,
  grantTo,
  newRole,
  requestFor,
  TEST_CATALOG,
} from './support/authorization-fixtures';
import { runThenCleanUp } from './support/cleanup-after';
import { branchInput, contextFor, CREATED_AT, newCompany, UPDATED_AT } from './support/fixtures';
import { newBranchMembership, newCompanyMembership, newUser } from './support/identity-fixtures';
import { createServiceUnderTest, REPOSITORY_ROOT, serviceConfig, type ServiceUnderTest } from './support/local-service-harness';
import { stopServicesThenDispose } from './support/service-cleanup';
import { createTemporaryDatabase, type TemporaryDatabase } from './support/sqlite-harness';

/*
 * Integridade SQLite da persistência RBAC (E1.07-D2, migração 6), com escritas SQL directas e dados
 * fictícios. RM: migração; RI: integridade, unicidade, transacções e fronteiras.
 */

const REFUSED = /constraint|FOREIGN KEY|UNIQUE|CHECK/i;

interface Seed {
  readonly companyA: Company;
  readonly companyB: Company;
  readonly northA: Branch;
  readonly southA: Branch;
  readonly storeB: Branch;
  readonly alice: User;
  readonly aliceAtA: CompanyMembership;
  readonly carol: User;
  readonly carolAtA: CompanyMembership;
  readonly daveAtB: CompanyMembership;
  readonly roleA: Role;
  readonly inactiveRoleA: Role;
  readonly roleB: Role;
}

const seedDatabase = async (database: SqliteDatabase, authorization: SqliteAuthorizationPersistence): Promise<Seed> => {
  const tenant = createSqliteTenantPersistence(database);
  const memberships = createSqliteMembershipPersistence(database);
  const users = createSqliteUserDirectory(database);
  const companyA = newCompany({ legalName: 'Tenant A, Lda.' });
  const companyB = newCompany({ legalName: 'Tenant B, Lda.' });
  const contextA = contextFor(companyA.tenantId);
  const contextB = contextFor(companyB.tenantId);
  await tenant.companies.create(contextA, companyA);
  await tenant.companies.create(contextB, companyB);
  const northA = createBranch(branchInput(companyA, { code: 'A-NORTE' }));
  const southA = createBranch(branchInput(companyA, { code: 'A-SUL' }));
  const storeB = createBranch(branchInput(companyB, { code: 'B-LOJA' }));
  await tenant.branches.create(contextA, northA);
  await tenant.branches.create(contextA, southA);
  await tenant.branches.create(contextB, storeB);
  const alice = newUser();
  const carol = newUser();
  const dave = newUser();
  for (const user of [alice, carol, dave]) await users.create(user);
  const aliceAtA = newCompanyMembership(alice, companyA);
  const carolAtA = newCompanyMembership(carol, companyA, { scope: 'BRANCH_RESTRICTED' });
  const daveAtB = newCompanyMembership(dave, companyB);
  await memberships.companyMemberships.create(contextA, aliceAtA);
  await memberships.companyMemberships.create(contextA, carolAtA);
  await memberships.companyMemberships.create(contextB, daveAtB);
  await memberships.branchMemberships.create(contextA, newBranchMembership(carolAtA, northA));
  await memberships.branchMemberships.create(contextA, newBranchMembership(carolAtA, southA));
  const roleA = newRole(companyA, { code: 'OPERADOR' });
  const inactiveRoleA = newRole(companyA, { code: 'ANTIGO', status: 'INACTIVE' });
  const roleB = newRole(companyB, { code: 'OPERADOR' });
  await authorization.roles.create(contextA, roleA);
  await authorization.roles.create(contextA, inactiveRoleA);
  await authorization.roles.create(contextB, roleB);
  return { alice, aliceAtA, carol, carolAtA, companyA, companyB, daveAtB, inactiveRoleA, northA, roleA, roleB, southA, storeB };
};

const insertRole = (database: SqliteDatabase, values: Record<string, unknown>): void => {
  database
    .prepare(
      `INSERT INTO roles (id, tenant_id, company_id, code, name, description, status, created_at, updated_at)
       VALUES (@id, @tenantId, @companyId, @code, 'Perfil', NULL, @status, @createdAt, @createdAt)`,
    )
    .run({ createdAt: CREATED_AT, id: randomUUID(), status: 'ACTIVE', ...values });
};

const insertPermission = (database: SqliteDatabase, values: Record<string, unknown>, verb = 'INSERT'): void => {
  database
    .prepare(
      `${verb} INTO role_permissions (tenant_id, role_id, permission_code, catalog_version, created_at)
       VALUES (@tenantId, @roleId, @permissionCode, 1, @createdAt)`,
    )
    .run({ createdAt: CREATED_AT, ...values });
};

const insertAssignment = (database: SqliteDatabase, values: Record<string, unknown>, verb = 'INSERT'): void => {
  database
    .prepare(
      `${verb} INTO role_assignments
         (id, tenant_id, company_id, role_id, company_membership_id, scope, branch_id, status, created_at, updated_at)
       VALUES (@id, @tenantId, @companyId, @roleId, @membershipId, @scope, @branchId, @status, @createdAt, @createdAt)`,
    )
    .run({ branchId: null, createdAt: CREATED_AT, id: randomUUID(), scope: 'COMPANY_WIDE', status: 'ACTIVE', ...values });
};

const count = (database: SqliteDatabase, table: string): number =>
  database.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;

const CONFIGURATIONS = [
  { foreignKeys: true, label: 'foreign_keys ON', recursiveTriggers: false },
  { foreignKeys: false, label: 'foreign_keys OFF', recursiveTriggers: false },
  { foreignKeys: true, label: 'foreign_keys ON, recursive_triggers ON', recursiveTriggers: true },
  { foreignKeys: false, label: 'foreign_keys OFF, recursive_triggers ON', recursiveTriggers: true },
] as const;

describe('RBAC SQLite integrity (E1.07-D2/R1, migrations 6-7)', () => {
  let temporary: TemporaryDatabase;
  let database: SqliteDatabase;
  let authorization: SqliteAuthorizationPersistence;
  let s: Seed;

  beforeEach(async () => {
    temporary = createTemporaryDatabase();
    database = temporary.open();
    runMigrations(database);
    authorization = createSqliteAuthorizationPersistence(database);
    s = await seedDatabase(database, authorization);
  });

  afterEach(() => {
    temporary.dispose();
  });

  describe('migration 6', () => {
    it('[RM01] creates STRICT tables, partial unique indexes and no implicit roles, grants or assignments', () => {
      const fresh = createTemporaryDatabase();
      try {
        const connection = fresh.open();
        expect(runMigrations(connection)).toEqual({ applied: [1, 2, 3, 4, 5, 6, 7, 8, 9], currentVersion: 9 });
        const tables = connection
          .prepare("SELECT name, strict FROM pragma_table_list WHERE name IN ('roles', 'role_permissions', 'role_assignments') ORDER BY name")
          .all();
        expect(tables).toEqual([
          { name: 'role_assignments', strict: 1 },
          { name: 'role_permissions', strict: 1 },
          { name: 'roles', strict: 1 },
        ]);
        const partial = connection
          .prepare("SELECT name, \"unique\", partial FROM pragma_index_list('role_assignments') WHERE partial = 1 ORDER BY name")
          .all();
        expect(partial).toEqual([
          { name: 'role_assignments_branch_unique', partial: 1, unique: 1 },
          { name: 'role_assignments_company_wide_unique', partial: 1, unique: 1 },
        ]);
        for (const table of ['roles', 'role_permissions', 'role_assignments']) expect(count(connection, table)).toBe(0);
        expect(connection.prepare("SELECT count(*) FROM sqlite_schema WHERE name LIKE '%permission_catalog%'").pluck().get()).toBe(0);
        expect(connection.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
      } finally {
        fresh.dispose();
      }
    });

    it('[RM02] upgrades a database with migrations 1 to 5 and fictitious data without losing anything', async () => {
      const legacy = createTemporaryDatabase();
      try {
        const connection = legacy.open();
        expect(runMigrations(connection, MIGRATIONS.slice(0, 5))).toEqual({ applied: [1, 2, 3, 4, 5], currentVersion: 5 });
        const company = newCompany();
        const branch = createBranch(branchInput(company));
        const user = newUser();
        const membership = newCompanyMembership(user, company, { scope: 'BRANCH_RESTRICTED' });
        connection
          .prepare(
            `INSERT INTO companies (id, tenant_id, jurisdiction, legal_name, trade_name, nif, status, created_at, updated_at)
             VALUES (?, ?, 'ZZ', 'Empresa Fictícia, Lda.', NULL, 'NIF-TESTE-0001', 'ACTIVE', ?, ?)`,
          )
          .run(company.id, company.tenantId, CREATED_AT, CREATED_AT);
        connection
          .prepare(
            `INSERT INTO branches (id, tenant_id, company_id, name, code, sector_type, status, created_at, updated_at)
             VALUES (?, ?, ?, 'Loja Fictícia', 'LOJA-01', 'SUPERMARKET', 'ACTIVE', ?, ?)`,
          )
          .run(branch.id, company.tenantId, company.id, CREATED_AT, CREATED_AT);
        connection
          .prepare(
            `INSERT INTO users (id, username, display_name, email, phone, status, created_at, updated_at)
             VALUES (?, ?, 'Utilizador Fictício', NULL, NULL, 'ACTIVE', ?, ?)`,
          )
          .run(user.id, user.username, CREATED_AT, CREATED_AT);
        connection
          .prepare(
            `INSERT INTO company_memberships (id, user_id, tenant_id, company_id, scope, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'BRANCH_RESTRICTED', 'ACTIVE', ?, ?)`,
          )
          .run(membership.id, user.id, company.tenantId, company.id, CREATED_AT, CREATED_AT);
        connection
          .prepare(
            `INSERT INTO branch_memberships (id, company_membership_id, tenant_id, company_id, branch_id, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
          )
          .run(randomUUID(), membership.id, company.tenantId, company.id, branch.id, CREATED_AT, CREATED_AT);
        connection
          .prepare(
            `INSERT INTO password_credentials (user_id, algorithm, algorithm_version, memory_kib, passes, parallelism, salt, hash,
               created_at, updated_at) VALUES (?, 'argon2id', 19, 19456, 2, 1, ?, ?, ?, ?)`,
          )
          .run(user.id, randomBytes(16), randomBytes(32), CREATED_AT, CREATED_AT);
        connection.prepare('INSERT INTO installation_bootstrap (id, initial_administrator_id, completed_at) VALUES (1, ?, ?)').run(user.id, CREATED_AT);
        connection
          .prepare(
            `INSERT INTO authentication_throttle (throttle_key, failures, window_started_at, locked_until, last_attempt_at)
             VALUES ('instance', 1, ?, NULL, ?)`,
          )
          .run(CREATED_AT, CREATED_AT);
        connection
          .prepare(
            `INSERT INTO local_sessions (id, user_id, token_digest, security_version, credential_version, service_run_id,
               created_at, last_activity_at, absolute_expires_at, revoked_at, revocation_reason)
             VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, NULL, NULL)`,
          )
          .run(randomUUID(), user.id, randomBytes(32), randomBytes(16).toString('hex'), CREATED_AT, CREATED_AT, UPDATED_AT);
        const tables = [
          'companies', 'branches', 'users', 'company_memberships', 'branch_memberships', 'password_credentials',
          'installation_bootstrap', 'authentication_throttle', 'local_sessions', 'schema_migrations', 'sector_types',
        ];
        const snapshot = () => Object.fromEntries(tables.map((table) => [table, connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
        const before = snapshot();

        expect(inspectMigrations(connection)).toMatchObject({ appliedVersions: [1, 2, 3, 4, 5], pendingVersions: [6, 7, 8, 9] });
        expect(runMigrations(connection)).toEqual({ applied: [6, 7, 8, 9], currentVersion: 9 });
        const after = snapshot();
        expect({ ...after, schema_migrations: after['schema_migrations']?.slice(0, 5) }).toEqual(before);
        expect(connection.prepare('SELECT checksum FROM schema_migrations WHERE version = 6').pluck().get()).toBe(
          migrationChecksum(MIGRATIONS[5] as (typeof MIGRATIONS)[number]),
        );
        expect(connection.prepare('SELECT checksum FROM schema_migrations WHERE version = 7').pluck().get()).toBe(
          migrationChecksum(MIGRATIONS[6] as (typeof MIGRATIONS)[number]),
        );
        expect(connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(connection.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
        expect(runMigrations(connection)).toEqual({ applied: [], currentVersion: 9 });
        // A base actualizada aceita imediatamente perfis e atribuições da associação existente.
        const upgraded = createSqliteAuthorizationPersistence(connection);
        const role = newRole(company, { code: 'LEITOR' });
        const context = contextFor(company.tenantId);
        await upgraded.roles.create(context, role);
        await upgraded.rolePermissions.add(context, grantTo(role, 'branches.read'));
        await upgraded.roleAssignments.create(context, assignAtBranch(role, membership, branch));
        expect(count(connection, 'role_assignments')).toBe(1);
      } finally {
        legacy.dispose();
      }
    });

    it('[RM03] refuses a tampered migration 6 and rolls back a failing migration 6 atomically', () => {
      const tamper = createTemporaryDatabase();
      try {
        const connection = tamper.open();
        runMigrations(connection, MIGRATIONS.slice(0, 5));
        const broken = { ...MIGRATIONS[5], sql: `${MIGRATIONS[5]?.sql ?? ''}\nSELECT * FROM missing_table;` } as (typeof MIGRATIONS)[number];
        expect(() => runMigrations(connection, [...MIGRATIONS.slice(0, 5), broken])).toThrow(/missing_table/);
        expect(inspectMigrations(connection)).toMatchObject({ appliedVersions: [1, 2, 3, 4, 5], pendingVersions: [6, 7, 8, 9] });
        expect(connection.prepare("SELECT count(*) FROM sqlite_schema WHERE name LIKE 'role%'").pluck().get()).toBe(0);
        runMigrations(connection);
        const altered = [...MIGRATIONS.slice(0, 5), { ...MIGRATIONS[5], sql: `${MIGRATIONS[5]?.sql ?? ''}\n` } as (typeof MIGRATIONS)[number]];
        expect(() => inspectMigrations(connection, altered)).toThrow(PersistenceError);
        expect(() => inspectMigrations(connection, altered)).toThrow(/migration-checksum-mismatch/);
      } finally {
        tamper.dispose();
      }
    });

    it('[RM04] the local service refuses migration 7 under the strict policy without touching a migration-6 file', async () => {
      const legacy = createTemporaryDatabase();
      // PD87-C1 (RV-PD87M-03): os serviços são parados e as ligações confirmadas fechadas antes de
      // apagar a base; uma falha da limpeza depois de uma asserção falhada não substitui a asserção.
      const services: ServiceUnderTest[] = [];
      await runThenCleanUp(async () => {
        const connection = legacy.open();
        runMigrations(connection, MIGRATIONS.slice(0, 6));
        connection.close();
        const before = readFileSync(legacy.filename);
        const strict = createServiceUnderTest(
          serviceConfig(legacy.filename, { startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'fail' } }),
        );
        services.push(strict);
        await expect(strict.service.start()).rejects.toMatchObject({ reason: 'pending-migrations' });
        expect(readFileSync(legacy.filename).equals(before)).toBe(true);
        const applying = createServiceUnderTest(serviceConfig(legacy.filename));
        services.push(applying);
        await applying.service.start();
        expect(applying.service.startupReport).toMatchObject({ appliedMigrations: [7, 8, 9], schemaVersion: 9 });
        await applying.service.stop();
      }, stopServicesThenDispose(services, legacy));
    });

    it('[RM05] upgrades a migration-6 database with valid RBAC data without changing rows or checksums 1-6', async () => {
      const legacy = createTemporaryDatabase();
      try {
        const connection = legacy.open();
        expect(runMigrations(connection, MIGRATIONS.slice(0, 6))).toEqual({
          applied: [1, 2, 3, 4, 5, 6],
          currentVersion: 6,
        });
        const persistence = createSqliteAuthorizationPersistence(connection);
        const seeded = await seedDatabase(connection, persistence);
        await persistence.rolePermissions.add(contextFor(seeded.companyA.tenantId), grantTo(seeded.roleA, 'company.read'));
        await persistence.roleAssignments.create(
          contextFor(seeded.companyA.tenantId),
          assignCompanyWide(seeded.roleA, seeded.aliceAtA),
        );
        const tables = [
          'companies',
          'branches',
          'users',
          'company_memberships',
          'branch_memberships',
          'roles',
          'role_permissions',
          'role_assignments',
        ];
        const snapshot = () =>
          Object.fromEntries(tables.map((table) => [table, connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
        const rowsBefore = snapshot();
        const checksumsBefore = connection
          .prepare('SELECT version, checksum FROM schema_migrations WHERE version <= 6 ORDER BY version')
          .all();

        expect(runMigrations(connection)).toEqual({ applied: [7, 8, 9], currentVersion: 9 });
        expect(snapshot()).toEqual(rowsBefore);
        expect(
          connection.prepare('SELECT version, checksum FROM schema_migrations WHERE version <= 6 ORDER BY version').all(),
        ).toEqual(checksumsBefore);
        expect(connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(connection.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
        // E1.07-D2-R3: a autorização depois da actualização corresponde aos dados válidos existentes.
        const engine = createInternalDomainAuthorizationEvaluator(persistence.readCompanyAuthorizationFacts);
        const readA = (userId: User['id']) =>
          engine.evaluate({ permissionCode: 'company.read', scope: companyTarget(seeded.companyA), userId });
        expect(isOfficialDomainGrant(await readA(seeded.alice.id))).toBe(true);
        expect(await readA(seeded.carol.id)).toMatchObject({ outcome: 'DENIED', reason: 'permission-not-granted' });
        expect(await readA(seeded.daveAtB.userId)).toMatchObject({ outcome: 'DENIED', reason: 'no-membership' });
      } finally {
        legacy.dispose();
      }
    });

    it('[RM06] rolls back a failing migration 7 atomically and refuses migration 7 altered after it is applied', () => {
      const tamper = createTemporaryDatabase();
      try {
        const connection = tamper.open();
        runMigrations(connection, MIGRATIONS.slice(0, 6));
        const triggers = () => connection.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name").pluck().all();
        const before = triggers();
        const latest = MIGRATIONS[6] as (typeof MIGRATIONS)[number];
        const broken = { ...latest, sql: `${latest.sql}\nSELECT * FROM missing_table;` };
        expect(() => runMigrations(connection, [...MIGRATIONS.slice(0, 6), broken])).toThrow(/missing_table/);
        expect(inspectMigrations(connection)).toMatchObject({ appliedVersions: [1, 2, 3, 4, 5, 6], pendingVersions: [7, 8, 9] });
        expect(triggers()).toEqual(before);
        expect(connection.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');

        // Só a migração 7 (a 8 tem o seu próprio ensaio em identity-persistence-gate.test.ts).
        expect(runMigrations(connection, MIGRATIONS.slice(0, 7))).toEqual({ applied: [7], currentVersion: 7 });
        const created = [...latest.sql.matchAll(/CREATE TRIGGER (\w+)/g)].map((match) => match[1]);
        expect(created.length).toBeGreaterThan(20);
        expect(triggers()).toEqual([...before, ...created].sort());
        expect(connection.prepare('SELECT version, checksum FROM schema_migrations ORDER BY version').all()).toEqual(
          MIGRATIONS.slice(0, 7).map((migration) => ({ checksum: migrationChecksum(migration), version: migration.version })),
        );
        const altered = [...MIGRATIONS.slice(0, 6), { ...latest, sql: `${latest.sql}\n` }];
        expect(() => inspectMigrations(connection, altered)).toThrow(/migration-checksum-mismatch/);
      } finally {
        tamper.dispose();
      }
    });

    it('[RM07] upgrades a migration-6 database that already holds non-positive rowids without blocking normal inserts (PD-72)', async () => {
      const legacy = createTemporaryDatabase();
      try {
        const connection = legacy.open();
        runMigrations(connection, MIGRATIONS.slice(0, 6));
        const persistence = createSqliteAuthorizationPersistence(connection);
        const seeded = await seedDatabase(connection, persistence);
        const contextA = contextFor(seeded.companyA.tenantId);
        // Linhas com rowid -1 só podem vir de SQL directo anterior à migração 7, nunca da aplicação.
        const legacyUser = newUser();
        connection
          .prepare(
            `INSERT INTO users (rowid, id, username, display_name, status, created_at, updated_at)
             VALUES (-1, ?, ?, 'Legado', 'ACTIVE', ?, ?)`,
          )
          .run(legacyUser.id, legacyUser.username, CREATED_AT, CREATED_AT);
        connection
          .prepare(
            `INSERT INTO roles (rowid, id, tenant_id, company_id, code, name, status, created_at, updated_at)
             VALUES (-1, ?, ?, ?, 'LEGADO', 'Legado', 'ACTIVE', ?, ?)`,
          )
          .run(randomUUID(), seeded.companyA.tenantId, seeded.companyA.id, CREATED_AT, CREATED_AT);
        const tables = ['users', 'roles'] as const;
        const snapshot = () =>
          Object.fromEntries(tables.map((table) => [table, connection.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all()]));
        const before = snapshot();

        // Comportamento da própria migração 7 (D-196). O serviço local recusa esta actualização antes de
        // migrar (pré-verificação PD-76, E1.07-D3-G0): ver identity-persistence-gate.test.ts.
        expect(runMigrations(connection, MIGRATIONS.slice(0, 7))).toEqual({ applied: [7], currentVersion: 7 });
        expect(snapshot()).toEqual(before);
        connection.pragma('foreign_keys = OFF');
        // Uma linha legada com rowid -1 não bloqueia as inserções normais dos repositórios.
        const fresh = newUser();
        await createSqliteUserDirectory(connection).create(fresh);
        await persistence.roles.create(contextA, newRole(seeded.companyA, { code: 'NOVO' }));
        const rowids = (table: string) => connection.prepare(`SELECT rowid FROM ${table} ORDER BY rowid`).pluck().all() as number[];
        expect(rowids('users').filter((rowid) => rowid <= 0)).toEqual([-1]);
        expect(rowids('roles').filter((rowid) => rowid <= 0)).toEqual([-1]);
        // E não pode ser substituída: um rowid explícito não positivo é recusado depois da inserção.
        const intruder = newUser();
        for (const verb of ['REPLACE', 'INSERT OR REPLACE']) {
          expect(() =>
            connection
              .prepare(
                `${verb} INTO users (rowid, id, username, display_name, status, created_at, updated_at)
                 VALUES (-1, ?, ?, 'Intruso', 'ACTIVE', ?, ?)`,
              )
              .run(intruder.id, intruder.username, CREATED_AT, CREATED_AT),
          ).toThrow(REFUSED);
        }
        expect(connection.prepare('SELECT id FROM users WHERE rowid = -1').pluck().get()).toBe(legacyUser.id);
        expect(connection.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
      } finally {
        legacy.dispose();
      }
    });

    it('[RM08] keeps a migration-6 database intact after a real process interruption in the middle of migration 7', () => {
      const legacy = createTemporaryDatabase();
      try {
        const connection = legacy.open();
        runMigrations(connection, MIGRATIONS.slice(0, 6));
        const triggers = () => connection.prepare("SELECT count(*) FROM sqlite_schema WHERE type = 'trigger'").pluck().get();
        const before = triggers();
        connection.close();
        const latest = MIGRATIONS[6] as (typeof MIGRATIONS)[number];
        const sqlFile = path.join(legacy.directory, 'migration-7.sql');
        writeFileSync(sqlFile, latest.sql, 'utf8');
        const requireFromDatabase = createRequire(path.join(REPOSITORY_ROOT, 'packages', 'database', 'package.json'));
        const script = `
          const fs = require('node:fs');
          const Database = require(process.argv[1]);
          const db = new Database(process.argv[2]);
          db.pragma('journal_mode = WAL');
          db.exec('BEGIN IMMEDIATE');
          db.exec(fs.readFileSync(process.argv[3], 'utf8'));
          db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (7, 'x', 'x', 'x')").run();
          fs.writeSync(1, 'MIGRATION_7_EXECUTED');
          process.kill(process.pid, 'SIGKILL');
        `;
        const result = spawnSync(
          process.execPath,
          ['-e', script, requireFromDatabase.resolve('better-sqlite3'), legacy.filename, sqlFile],
          { encoding: 'utf8', timeout: 20_000 },
        );
        expect(result.stdout).toBe('MIGRATION_7_EXECUTED');
        expect(result.status).not.toBe(0);

        const reopened = legacy.open();
        expect(reopened.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
        expect(inspectMigrations(reopened)).toMatchObject({ appliedVersions: [1, 2, 3, 4, 5, 6], pendingVersions: [7, 8, 9] });
        expect(reopened.prepare("SELECT count(*) FROM sqlite_schema WHERE type = 'trigger'").pluck().get()).toBe(before);
        expect(runMigrations(reopened)).toEqual({ applied: [7, 8, 9], currentVersion: 9 });
      } finally {
        legacy.dispose();
      }
    });
  });

  describe.each(CONFIGURATIONS)('direct SQL writes with $label', ({ foreignKeys, recursiveTriggers }) => {
    beforeEach(() => {
      database.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
      database.pragma(`recursive_triggers = ${recursiveTriggers ? 'ON' : 'OFF'}`);
    });

    it('[RI01] refuses roles and grants across tenants or without references', () => {
      const before = { grants: count(database, 'role_permissions'), roles: count(database, 'roles') };
      // Perfil do tenant A sobre a empresa do tenant B; empresa inexistente.
      expect(() => insertRole(database, { code: 'CRUZADO', companyId: s.companyB.id, tenantId: s.companyA.tenantId })).toThrow(REFUSED);
      expect(() => insertRole(database, { code: 'ORFAO', companyId: randomUUID(), tenantId: s.companyA.tenantId })).toThrow(REFUSED);
      // Concessão do tenant A sobre um perfil do tenant B; perfil inexistente.
      expect(() =>
        insertPermission(database, { permissionCode: 'company.read', roleId: s.roleB.id, tenantId: s.companyA.tenantId }),
      ).toThrow(REFUSED);
      expect(() =>
        insertPermission(database, { permissionCode: 'company.read', roleId: randomUUID(), tenantId: s.companyA.tenantId }),
      ).toThrow(REFUSED);
      expect({ grants: count(database, 'role_permissions'), roles: count(database, 'roles') }).toEqual(before);
    });

    it('[RI02] refuses assignments with cross-tenant, missing, contradictory or ineligible references', () => {
      const a = { companyId: s.companyA.id, tenantId: s.companyA.tenantId };
      const attempts: Record<string, Record<string, unknown>> = {
        'role of B, membership of A': { ...a, membershipId: s.aliceAtA.id, roleId: s.roleB.id },
        'membership of B, role of A': { ...a, membershipId: s.daveAtB.id, roleId: s.roleA.id },
        'branch of B': { ...a, branchId: s.storeB.id, membershipId: s.aliceAtA.id, roleId: s.roleA.id, scope: 'BRANCH' },
        'missing branch': { ...a, branchId: randomUUID(), membershipId: s.aliceAtA.id, roleId: s.roleA.id, scope: 'BRANCH' },
        'missing membership': { ...a, membershipId: randomUUID(), roleId: s.roleA.id },
        'missing role': { ...a, membershipId: s.aliceAtA.id, roleId: randomUUID() },
        'company of B in tenant A': { companyId: s.companyB.id, membershipId: s.aliceAtA.id, roleId: s.roleA.id, tenantId: s.companyA.tenantId },
        'COMPANY_WIDE with branch': { ...a, branchId: s.northA.id, membershipId: s.aliceAtA.id, roleId: s.roleA.id },
        'BRANCH without branch': { ...a, membershipId: s.aliceAtA.id, roleId: s.roleA.id, scope: 'BRANCH' },
        'COMPANY_WIDE under BRANCH_RESTRICTED': { ...a, membershipId: s.carolAtA.id, roleId: s.roleA.id },
        'inactive role': { ...a, membershipId: s.aliceAtA.id, roleId: s.inactiveRoleA.id },
        'unknown scope': { ...a, membershipId: s.aliceAtA.id, roleId: s.roleA.id, scope: 'GLOBAL' },
      };
      for (const [label, values] of Object.entries(attempts)) {
        expect(() => insertAssignment(database, values), label).toThrow(REFUSED);
      }
      // Estabelecimento sem associação local activa sob `BRANCH_RESTRICTED`.
      database.prepare("UPDATE branch_memberships SET status = 'INACTIVE', updated_at = ? WHERE company_membership_id = ?").run(
        UPDATED_AT,
        s.carolAtA.id,
      );
      expect(() => insertAssignment(database, { ...a, branchId: s.northA.id, membershipId: s.carolAtA.id, roleId: s.roleA.id, scope: 'BRANCH' })).toThrow(REFUSED);
      database.prepare("UPDATE company_memberships SET status = 'INACTIVE', updated_at = ? WHERE id = ?").run(UPDATED_AT, s.aliceAtA.id);
      expect(() => insertAssignment(database, { ...a, membershipId: s.aliceAtA.id, roleId: s.roleA.id })).toThrow(REFUSED);
      expect(count(database, 'role_assignments')).toBe(0);
      database.pragma('foreign_keys = ON');
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    });

    it('[RI03] keeps roles, grants and assignments unique, including COMPANY_WIDE with NULL branch, in any state', () => {
      const a = { companyId: s.companyA.id, tenantId: s.companyA.tenantId };
      expect(() => insertRole(database, { ...a, code: 'OPERADOR' })).toThrow(REFUSED);
      insertPermission(database, { permissionCode: 'company.read', roleId: s.roleA.id, tenantId: a.tenantId });
      expect(() => insertPermission(database, { permissionCode: 'company.read', roleId: s.roleA.id, tenantId: a.tenantId })).toThrow(REFUSED);

      const wide = randomUUID();
      insertAssignment(database, { ...a, id: wide, membershipId: s.aliceAtA.id, roleId: s.roleA.id });
      expect(() => insertAssignment(database, { ...a, membershipId: s.aliceAtA.id, roleId: s.roleA.id })).toThrow(REFUSED);
      database.prepare("UPDATE role_assignments SET status = 'INACTIVE', updated_at = ? WHERE id = ?").run(UPDATED_AT, wide);
      expect(() => insertAssignment(database, { ...a, membershipId: s.aliceAtA.id, roleId: s.roleA.id })).toThrow(REFUSED);
      expect(() => insertAssignment(database, { ...a, membershipId: s.aliceAtA.id, roleId: s.roleA.id, status: 'INACTIVE' })).toThrow(REFUSED);

      const branch = { ...a, branchId: s.northA.id, membershipId: s.carolAtA.id, roleId: s.roleA.id, scope: 'BRANCH' };
      insertAssignment(database, branch);
      expect(() => insertAssignment(database, branch)).toThrow(REFUSED);
      insertAssignment(database, { ...branch, branchId: s.southA.id });
      // Reinserções por REPLACE, UPSERT e INSERT OR REPLACE nunca substituem a linha existente.
      for (const verb of ['REPLACE', 'INSERT OR REPLACE']) {
        expect(() => insertAssignment(database, { ...a, id: wide, membershipId: s.aliceAtA.id, roleId: s.roleA.id }, verb)).toThrow(REFUSED);
        expect(() => insertPermission(database, { permissionCode: 'company.read', roleId: s.roleA.id, tenantId: a.tenantId }, verb)).toThrow(REFUSED);
      }
      expect(() =>
        database
          .prepare(
            `INSERT INTO roles (id, tenant_id, company_id, code, name, status, created_at, updated_at)
             VALUES (?, ?, ?, 'OPERADOR', 'x', 'ACTIVE', ?, ?) ON CONFLICT (tenant_id, code) DO UPDATE SET name = 'y'`,
          )
          .run(randomUUID(), a.tenantId, a.companyId, CREATED_AT, CREATED_AT),
      ).toThrow(REFUSED);
      expect(() => insertAssignment(database, { ...a, id: wide, membershipId: s.aliceAtA.id, roleId: s.roleA.id }, 'INSERT OR IGNORE')).toThrow(REFUSED);
      expect(database.prepare('SELECT status FROM role_assignments WHERE id = ?').pluck().get(wide)).toBe('INACTIVE');
      expect(count(database, 'role_assignments')).toBe(3);
    });

    it('[RI04] keeps references immutable and never deletes roles or assignments; grants are revoked explicitly', () => {
      const a = { companyId: s.companyA.id, tenantId: s.companyA.tenantId };
      const id = randomUUID();
      insertAssignment(database, { ...a, branchId: s.northA.id, id, membershipId: s.carolAtA.id, roleId: s.roleA.id, scope: 'BRANCH' });
      insertPermission(database, { permissionCode: 'branches.read', roleId: s.roleA.id, tenantId: a.tenantId });
      const refused = [
        ['UPDATE roles SET code = ? WHERE id = ?', 'OUTRO', s.roleA.id],
        ['UPDATE roles SET tenant_id = ? WHERE id = ?', s.companyB.tenantId, s.roleA.id],
        ['UPDATE roles SET company_id = ? WHERE id = ?', s.companyB.id, s.roleA.id],
        ['UPDATE roles SET created_at = ? WHERE id = ?', '2026-01-01T00:00:00.000Z', s.roleA.id],
        ['UPDATE role_permissions SET permission_code = ? WHERE role_id = ?', 'company.update', s.roleA.id],
        ['UPDATE role_permissions SET role_id = ? WHERE role_id = ?', s.inactiveRoleA.id, s.roleA.id],
        ['UPDATE role_assignments SET branch_id = ? WHERE id = ?', s.southA.id, id],
        ['UPDATE role_assignments SET role_id = ? WHERE id = ?', s.inactiveRoleA.id, id],
        ['UPDATE role_assignments SET company_membership_id = ? WHERE id = ?', s.aliceAtA.id, id],
        ['UPDATE role_assignments SET scope = ? WHERE id = ?', 'COMPANY_WIDE', id],
        ['UPDATE role_assignments SET tenant_id = ? WHERE id = ?', s.companyB.tenantId, id],
        ['DELETE FROM roles WHERE id = ?', s.inactiveRoleA.id],
        ['DELETE FROM role_assignments WHERE id = ?', id],
      ] as const;
      for (const [sql, ...parameters] of refused) expect(() => database.prepare(sql).run(...parameters), sql).toThrow(REFUSED);
      database.prepare("UPDATE roles SET name = 'Novo nome', status = 'INACTIVE', updated_at = ? WHERE id = ?").run(UPDATED_AT, s.roleA.id);
      database.prepare("UPDATE role_assignments SET status = 'INACTIVE', updated_at = ? WHERE id = ?").run(UPDATED_AT, id);
      database.prepare('DELETE FROM role_permissions WHERE role_id = ?').run(s.roleA.id);
      expect(count(database, 'role_permissions')).toBe(0);
      expect(count(database, 'roles')).toBe(3);
    });

    it('[RI05] refuses reactivating an assignment unless role, membership, branch and local membership are active', () => {
      const a = { companyId: s.companyA.id, tenantId: s.companyA.tenantId };
      const id = randomUUID();
      insertAssignment(database, { ...a, branchId: s.northA.id, id, membershipId: s.carolAtA.id, roleId: s.roleA.id, scope: 'BRANCH' });
      const reactivate = () => database.prepare("UPDATE role_assignments SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(UPDATED_AT, id);
      database.prepare("UPDATE role_assignments SET status = 'INACTIVE', updated_at = ? WHERE id = ?").run(UPDATED_AT, id);
      const toggles = [
        ['roles', 'id', s.roleA.id],
        ['company_memberships', 'id', s.carolAtA.id],
        ['branches', 'id', s.northA.id],
        ['branch_memberships', 'branch_id', s.northA.id],
      ] as const;
      for (const [table, column, value] of toggles) {
        database.prepare(`UPDATE ${table} SET status = 'INACTIVE', updated_at = ? WHERE ${column} = ?`).run(UPDATED_AT, value);
        expect(reactivate, table).toThrow(REFUSED);
        database.prepare(`UPDATE ${table} SET status = 'ACTIVE', updated_at = ? WHERE ${column} = ?`).run(UPDATED_AT, value);
      }
      reactivate();
      expect(database.prepare('SELECT status FROM role_assignments WHERE id = ?').pluck().get(id)).toBe('ACTIVE');
    });

    it('[RI05a] refuses REPLACE and UPDATE OR REPLACE through occupied RBAC rowids without changing history', () => {
      const a = { companyId: s.companyA.id, tenantId: s.companyA.tenantId };
      insertPermission(database, { permissionCode: 'company.read', roleId: s.roleA.id, tenantId: a.tenantId });
      const wide = randomUUID();
      const branch = randomUUID();
      insertAssignment(database, { ...a, id: wide, membershipId: s.aliceAtA.id, roleId: s.roleA.id });
      insertAssignment(database, {
        ...a,
        branchId: s.northA.id,
        id: branch,
        membershipId: s.carolAtA.id,
        roleId: s.roleA.id,
        scope: 'BRANCH',
      });
      const snapshot = () => ({
        assignments: database.prepare('SELECT rowid, * FROM role_assignments ORDER BY rowid').all(),
        grants: database.prepare('SELECT rowid, * FROM role_permissions ORDER BY rowid').all(),
        roles: database.prepare('SELECT rowid, * FROM roles ORDER BY rowid').all(),
      });
      const before = snapshot();
      const roleRowid = database.prepare('SELECT rowid FROM roles WHERE id = ?').pluck().get(s.roleA.id) as number;
      const otherRoleRowid = database.prepare('SELECT rowid FROM roles WHERE id = ?').pluck().get(s.inactiveRoleA.id) as number;
      const grantRowid = database
        .prepare('SELECT rowid FROM role_permissions WHERE tenant_id = ? AND role_id = ? AND permission_code = ?')
        .pluck()
        .get(a.tenantId, s.roleA.id, 'company.read') as number;
      const wideRowid = database.prepare('SELECT rowid FROM role_assignments WHERE id = ?').pluck().get(wide) as number;
      const branchRowid = database.prepare('SELECT rowid FROM role_assignments WHERE id = ?').pluck().get(branch) as number;

      expect(() =>
        database
          .prepare(
            `REPLACE INTO roles
               (rowid, id, tenant_id, company_id, code, name, description, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'SUBSTITUTO', 'Substituto', NULL, 'ACTIVE', ?, ?)`,
          )
          .run(roleRowid, randomUUID(), a.tenantId, a.companyId, CREATED_AT, CREATED_AT),
      ).toThrow(REFUSED);
      expect(() =>
        database.prepare('UPDATE OR REPLACE roles SET rowid = ? WHERE id = ?').run(otherRoleRowid, s.roleA.id),
      ).toThrow(REFUSED);
      expect(() =>
        database
          .prepare(
            `REPLACE INTO role_permissions
               (rowid, tenant_id, role_id, permission_code, catalog_version, created_at)
             VALUES (?, ?, ?, 'company.update', 1, ?)`,
          )
          .run(grantRowid, a.tenantId, s.roleA.id, CREATED_AT),
      ).toThrow(REFUSED);
      expect(() =>
        database
          .prepare(
            `REPLACE INTO role_assignments
               (rowid, id, tenant_id, company_id, role_id, company_membership_id, scope, branch_id, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'BRANCH', ?, 'ACTIVE', ?, ?)`,
          )
          .run(wideRowid, randomUUID(), a.tenantId, a.companyId, s.roleA.id, s.carolAtA.id, s.southA.id, CREATED_AT, CREATED_AT),
      ).toThrow(REFUSED);
      expect(() =>
        database.prepare('UPDATE OR REPLACE role_assignments SET rowid = ? WHERE id = ?').run(branchRowid, wide),
      ).toThrow(REFUSED);
      expect(snapshot()).toEqual(before);
    });

    it('[RI05b] keeps parent identities and membership owners immutable, including associations without assignments', () => {
      const a = { companyId: s.companyA.id, tenantId: s.companyA.tenantId };
      insertAssignment(database, { ...a, membershipId: s.aliceAtA.id, roleId: s.roleA.id });
      const localMembershipId = database
        .prepare('SELECT id FROM branch_memberships WHERE company_membership_id = ? AND branch_id = ?')
        .pluck()
        .get(s.carolAtA.id, s.northA.id) as string;
      const aliceRowid = database.prepare('SELECT rowid FROM company_memberships WHERE id = ?').pluck().get(s.aliceAtA.id) as number;
      const carolRowid = database.prepare('SELECT rowid FROM company_memberships WHERE id = ?').pluck().get(s.carolAtA.id) as number;
      const before = {
        assignments: database.prepare('SELECT * FROM role_assignments ORDER BY id').all(),
        branches: database.prepare('SELECT * FROM branches ORDER BY id').all(),
        companies: database.prepare('SELECT * FROM companies ORDER BY id').all(),
        companyMemberships: database.prepare('SELECT * FROM company_memberships ORDER BY id').all(),
        localMemberships: database.prepare('SELECT * FROM branch_memberships ORDER BY id').all(),
      };
      const refused = [
        ['UPDATE company_memberships SET user_id = ? WHERE id = ?', s.daveAtB.userId, s.aliceAtA.id],
        ['UPDATE company_memberships SET user_id = ? WHERE id = ?', s.alice.id, s.daveAtB.id],
        ['UPDATE OR REPLACE company_memberships SET rowid = ? WHERE id = ?', carolRowid, s.aliceAtA.id],
        ['UPDATE companies SET tenant_id = ? WHERE id = ?', s.companyB.tenantId, s.companyA.id],
        ['UPDATE branches SET company_id = ? WHERE id = ?', s.companyB.id, s.northA.id],
        ['UPDATE branch_memberships SET branch_id = ? WHERE id = ?', s.southA.id, localMembershipId],
      ] as const;
      for (const [sql, ...parameters] of refused) expect(() => database.prepare(sql).run(...parameters), sql).toThrow(REFUSED);
      expect(() =>
        database
          .prepare(
            `INSERT OR REPLACE INTO company_memberships
               (rowid, id, user_id, tenant_id, company_id, scope, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'COMPANY_WIDE', 'ACTIVE', ?, ?)`,
          )
          .run(aliceRowid, s.aliceAtA.id, s.daveAtB.userId, a.tenantId, a.companyId, CREATED_AT, CREATED_AT),
      ).toThrow(REFUSED);
      expect({
        assignments: database.prepare('SELECT * FROM role_assignments ORDER BY id').all(),
        branches: database.prepare('SELECT * FROM branches ORDER BY id').all(),
        companies: database.prepare('SELECT * FROM companies ORDER BY id').all(),
        companyMemberships: database.prepare('SELECT * FROM company_memberships ORDER BY id').all(),
        localMemberships: database.prepare('SELECT * FROM branch_memberships ORDER BY id').all(),
      }).toEqual(before);
    });

    it('[RI05c] preserves migration-4/5 identity, credential and session rows against rowid replacement', () => {
      database
        .prepare(
          `INSERT INTO password_credentials
             (user_id, algorithm, algorithm_version, memory_kib, passes, parallelism, salt, hash, created_at, updated_at)
           VALUES (?, 'argon2id', 19, 19456, 2, 1, ?, ?, ?, ?)`,
        )
        .run(s.alice.id, randomBytes(16), randomBytes(32), CREATED_AT, CREATED_AT);
      const sessionId = randomUUID();
      database
        .prepare(
          `INSERT INTO local_sessions
             (id, user_id, token_digest, security_version, credential_version, service_run_id,
              created_at, last_activity_at, absolute_expires_at, revoked_at, revocation_reason)
           VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, NULL, NULL)`,
        )
        .run(sessionId, s.alice.id, randomBytes(32), randomBytes(16).toString('hex'), CREATED_AT, CREATED_AT, UPDATED_AT);
      const snapshot = () => ({
        credentials: database.prepare('SELECT rowid, * FROM password_credentials ORDER BY rowid').all(),
        sessions: database.prepare('SELECT rowid, * FROM local_sessions ORDER BY rowid').all(),
        users: database.prepare('SELECT rowid, * FROM users ORDER BY rowid').all(),
      });
      const before = snapshot();
      const aliceRowid = database.prepare('SELECT rowid FROM users WHERE id = ?').pluck().get(s.alice.id) as number;
      const carolRowid = database.prepare('SELECT rowid FROM users WHERE id = ?').pluck().get(s.carol.id) as number;
      const credentialRowid = database.prepare('SELECT rowid FROM password_credentials WHERE user_id = ?').pluck().get(s.alice.id) as number;
      const sessionRowid = database.prepare('SELECT rowid FROM local_sessions WHERE id = ?').pluck().get(sessionId) as number;
      const replacement = newUser();

      expect(() =>
        database
          .prepare(
            `REPLACE INTO users
               (rowid, id, username, display_name, email, phone, status, created_at, updated_at, security_version)
             VALUES (?, ?, ?, ?, NULL, NULL, 'ACTIVE', ?, ?, 1)`,
          )
          .run(aliceRowid, replacement.id, replacement.username, replacement.displayName, CREATED_AT, CREATED_AT),
      ).toThrow(REFUSED);
      expect(() => database.prepare('UPDATE OR REPLACE users SET rowid = ? WHERE id = ?').run(carolRowid, s.alice.id)).toThrow(REFUSED);
      expect(() =>
        database
          .prepare(
            `REPLACE INTO password_credentials
               (rowid, user_id, algorithm, algorithm_version, memory_kib, passes, parallelism, salt, hash,
                created_at, updated_at, credential_version)
             VALUES (?, ?, 'argon2id', 19, 19456, 2, 1, ?, ?, ?, ?, 1)`,
          )
          .run(credentialRowid, s.carol.id, randomBytes(16), randomBytes(32), CREATED_AT, CREATED_AT),
      ).toThrow(REFUSED);
      expect(() =>
        database
          .prepare(
            `REPLACE INTO local_sessions
               (rowid, id, user_id, token_digest, security_version, credential_version, service_run_id,
                created_at, last_activity_at, absolute_expires_at, revoked_at, revocation_reason)
             VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, NULL, NULL)`,
          )
          .run(
            sessionRowid,
            randomUUID(),
            s.carol.id,
            randomBytes(32),
            randomBytes(16).toString('hex'),
            CREATED_AT,
            CREATED_AT,
            UPDATED_AT,
          ),
      ).toThrow(REFUSED);
      expect(snapshot()).toEqual(before);
    });

    it('[RI05d] rolls back earlier writes when a protected parent binding change is refused', () => {
      const beforeName = database.prepare('SELECT name FROM roles WHERE id = ?').pluck().get(s.roleA.id);
      const work = database.transaction(() => {
        database.prepare("UPDATE roles SET name = 'Temporario', updated_at = ? WHERE id = ?").run(UPDATED_AT, s.roleA.id);
        database.prepare('UPDATE company_memberships SET user_id = ? WHERE id = ?').run(s.daveAtB.userId, s.aliceAtA.id);
      });
      expect(() => work.immediate()).toThrow(REFUSED);
      expect(database.prepare('SELECT name FROM roles WHERE id = ?').pluck().get(s.roleA.id)).toBe(beforeName);
    });

    it('[RI05e] never deletes a company membership, so DELETE + INSERT cannot move assignments to another identity (PD-70)', async () => {
      const a = { companyId: s.companyA.id, tenantId: s.companyA.tenantId };
      const context = contextFor(a.tenantId);
      await authorization.rolePermissions.add(context, grantTo(s.roleA, 'company.read'));
      await authorization.roleAssignments.create(context, assignCompanyWide(s.roleA, s.aliceAtA));
      const mallory = newUser();
      await createSqliteUserDirectory(database).create(mallory);
      const engine = createInternalDomainAuthorizationEvaluator(authorization.readCompanyAuthorizationFacts);
      const authority = async (user: User): Promise<string> => {
        const decision = await engine.evaluate({ permissionCode: 'company.read', scope: companyTarget(s.companyA), userId: user.id });
        return decision.outcome === 'GRANTED' ? 'GRANTED' : decision.reason;
      };
      expect([await authority(s.alice), await authority(mallory)]).toEqual(['GRANTED', 'no-membership']);

      const reinsertForMallory = (verb: string) =>
        database
          .prepare(
            `${verb} INTO company_memberships (id, user_id, tenant_id, company_id, scope, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'COMPANY_WIDE', 'ACTIVE', ?, ?)`,
          )
          .run(s.aliceAtA.id, mallory.id, a.tenantId, a.companyId, CREATED_AT, CREATED_AT);
      const bindings = () => ({
        assignments: database.prepare('SELECT rowid, * FROM role_assignments ORDER BY rowid').all(),
        local: database.prepare('SELECT rowid, * FROM branch_memberships ORDER BY rowid').all(),
        memberships: database
          .prepare('SELECT rowid, id, user_id, tenant_id, company_id, scope, created_at FROM company_memberships ORDER BY rowid')
          .all(),
      });
      const before = bindings();
      const attempts: Record<string, () => unknown> = {
        'DELETE': () => database.prepare('DELETE FROM company_memberships WHERE id = ?').run(s.aliceAtA.id),
        'DELETE + INSERT for another identity': () =>
          database
            .transaction(() => {
              database.prepare('DELETE FROM company_memberships WHERE id = ?').run(s.aliceAtA.id);
              reinsertForMallory('INSERT');
            })
            .immediate(),
        'INSERT OR REPLACE': () => reinsertForMallory('INSERT OR REPLACE'),
        'REPLACE INTO': () => reinsertForMallory('REPLACE'),
        'UPDATE user_id': () => database.prepare('UPDATE company_memberships SET user_id = ? WHERE id = ?').run(mallory.id, s.aliceAtA.id),
        'UPDATE OR REPLACE user_id': () =>
          database.prepare('UPDATE OR REPLACE company_memberships SET user_id = ? WHERE id = ?').run(mallory.id, s.aliceAtA.id),
        'UPDATE id': () => database.prepare('UPDATE company_memberships SET id = ? WHERE id = ?').run(randomUUID(), s.aliceAtA.id),
        'UPDATE tenant_id': () =>
          database.prepare('UPDATE company_memberships SET tenant_id = ? WHERE id = ?').run(randomUUID(), s.aliceAtA.id),
        'UPDATE company_id': () =>
          database.prepare('UPDATE company_memberships SET company_id = ? WHERE id = ?').run(s.companyB.id, s.aliceAtA.id),
        'DELETE without assignments': () => database.prepare('DELETE FROM company_memberships WHERE id = ?').run(s.daveAtB.id),
        'DELETE every membership': () => database.prepare('DELETE FROM company_memberships').run(),
      };
      for (const status of ['ACTIVE', 'INACTIVE'] as const) {
        database.prepare('UPDATE company_memberships SET status = ?, updated_at = ? WHERE id = ?').run(status, UPDATED_AT, s.aliceAtA.id);
        for (const [label, attempt] of Object.entries(attempts)) expect(attempt, `${status}: ${label}`).toThrow(REFUSED);
        expect(bindings(), status).toEqual(before);
      }
      // Revogação e reactivação pela manutenção legítima (estado), sem mudar o titular.
      expect(await authority(s.alice)).toBe('membership-inactive');
      database.prepare("UPDATE company_memberships SET status = 'ACTIVE', updated_at = ? WHERE id = ?").run(UPDATED_AT, s.aliceAtA.id);
      expect([await authority(s.alice), await authority(mallory)]).toEqual(['GRANTED', 'no-membership']);
      // Uma associação nova (id novo) para outra identidade continua aceite e não herda atribuições.
      await createSqliteMembershipPersistence(database).companyMemberships.create(context, newCompanyMembership(mallory, s.companyA));
      expect([await authority(s.alice), await authority(mallory)]).toEqual(['GRANTED', 'permission-not-granted']);
    });

    it('[RI05f] refuses non-positive rowids, keeps normal inserts working and still refuses REPLACE through occupied rowids (PD-72)', () => {
      const a = { companyId: s.companyA.id, tenantId: s.companyA.tenantId };
      const token = () => randomBytes(4).toString('hex').toUpperCase();
      const freshUser = (): string => {
        const user = newUser();
        database
          .prepare(`INSERT INTO users (id, username, display_name, status, created_at, updated_at) VALUES (?, ?, 'Utilizador', 'ACTIVE', ?, ?)`)
          .run(user.id, user.username, CREATED_AT, CREATED_AT);
        return user.id;
      };
      const freshMembership = (): string => {
        const id = randomUUID();
        database
          .prepare(
            `INSERT INTO company_memberships (id, user_id, tenant_id, company_id, scope, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'COMPANY_WIDE', 'ACTIVE', ?, ?)`,
          )
          .run(id, freshUser(), a.tenantId, a.companyId, CREATED_AT, CREATED_AT);
        return id;
      };
      const freshRole = (): string => {
        const id = randomUUID();
        insertRole(database, { ...a, code: `P${token()}`, id });
        return id;
      };
      // Cada linha nova só colide com a existente pelo rowid indicado: nenhuma outra restrição a recusa.
      const rows: Record<string, { readonly columns: string; readonly values: () => readonly unknown[] }> = {
        companies: {
          columns: 'id, tenant_id, jurisdiction, legal_name, nif, status, created_at, updated_at',
          values: () => [randomUUID(), randomUUID(), 'ZZ', 'Empresa Ficticia', `NIF-${token()}`, 'ACTIVE', CREATED_AT, CREATED_AT],
        },
        branches: {
          columns: 'id, tenant_id, company_id, name, code, sector_type, status, created_at, updated_at',
          values: () => [randomUUID(), a.tenantId, a.companyId, 'Loja', `L-${token()}`, 'SUPERMARKET', 'ACTIVE', CREATED_AT, CREATED_AT],
        },
        users: {
          columns: 'id, username, display_name, status, created_at, updated_at',
          values: () => {
            const user = newUser();
            return [user.id, user.username, 'Utilizador', 'ACTIVE', CREATED_AT, CREATED_AT];
          },
        },
        password_credentials: {
          columns: 'user_id, algorithm, algorithm_version, memory_kib, passes, parallelism, salt, hash, created_at, updated_at',
          values: () => [freshUser(), 'argon2id', 19, 19456, 2, 1, randomBytes(16), randomBytes(32), CREATED_AT, CREATED_AT],
        },
        local_sessions: {
          columns:
            'id, user_id, token_digest, security_version, credential_version, service_run_id, created_at, last_activity_at, absolute_expires_at',
          values: () => [randomUUID(), s.alice.id, randomBytes(32), 1, 1, randomBytes(16).toString('hex'), CREATED_AT, CREATED_AT, UPDATED_AT],
        },
        company_memberships: {
          columns: 'id, user_id, tenant_id, company_id, scope, status, created_at, updated_at',
          values: () => [randomUUID(), freshUser(), a.tenantId, a.companyId, 'COMPANY_WIDE', 'ACTIVE', CREATED_AT, CREATED_AT],
        },
        branch_memberships: {
          columns: 'id, company_membership_id, tenant_id, company_id, branch_id, status, created_at, updated_at',
          values: () => [randomUUID(), freshMembership(), a.tenantId, a.companyId, s.northA.id, 'ACTIVE', CREATED_AT, CREATED_AT],
        },
        roles: {
          columns: 'id, tenant_id, company_id, code, name, status, created_at, updated_at',
          values: () => [randomUUID(), a.tenantId, a.companyId, `P${token()}`, 'Perfil', 'ACTIVE', CREATED_AT, CREATED_AT],
        },
        role_permissions: {
          columns: 'tenant_id, role_id, permission_code, catalog_version, created_at',
          values: () => [a.tenantId, freshRole(), 'company.read', 1, CREATED_AT],
        },
        role_assignments: {
          columns: 'id, tenant_id, company_id, role_id, company_membership_id, scope, branch_id, status, created_at, updated_at',
          values: () => [randomUUID(), a.tenantId, a.companyId, freshRole(), s.aliceAtA.id, 'COMPANY_WIDE', null, 'ACTIVE', CREATED_AT, CREATED_AT],
        },
      };
      const insert = (table: string, verb = 'INSERT', rowid?: number) => {
        const row = rows[table];
        if (row === undefined) throw new Error(table);
        const values = [...(rowid === undefined ? [] : [rowid]), ...row.values()];
        database
          .prepare(`${verb} INTO ${table} (${rowid === undefined ? '' : 'rowid, '}${row.columns}) VALUES (${values.map(() => '?').join(', ')})`)
          .run(...values);
      };
      for (const table of Object.keys(rows)) {
        const snapshot = () => database.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all();
        insert(table);
        const occupied = database.prepare(`SELECT min(rowid) FROM ${table}`).pluck().get() as number;
        const before = snapshot();
        for (const rowid of [-1, 0, -2]) {
          for (const verb of ['INSERT', 'INSERT OR IGNORE', 'INSERT OR REPLACE', 'REPLACE']) {
            expect(() => insert(table, verb, rowid), `${table}: ${verb} rowid ${rowid}`).toThrow(REFUSED);
          }
        }
        for (const verb of ['INSERT OR REPLACE', 'REPLACE']) {
          expect(() => insert(table, verb, occupied), `${table}: ${verb} occupied rowid`).toThrow(REFUSED);
        }
        expect(snapshot(), table).toEqual(before);
        // As inserções normais (rowid implícito) continuam aceites depois de todas as recusas.
        insert(table);
        insert(table, 'INSERT', (database.prepare(`SELECT max(rowid) FROM ${table}`).pluck().get() as number) + 10);
        expect(database.prepare(`SELECT count(*) FROM ${table} WHERE rowid <= 0`).pluck().get(), table).toBe(0);
      }
      database.pragma('foreign_keys = ON');
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    });

    it('[RI05g] detects parent-binding regressions with values that collide with no other constraint (PD-74)', async () => {
      const tenant = createSqliteTenantPersistence(database);
      const memberships = createSqliteMembershipPersistence(database);
      const users = createSqliteUserDirectory(database);
      const contextA = contextFor(s.companyA.tenantId);
      // Empresa sem dependentes: só o trigger pode recusar a mudança de tenant (também com FK ligadas).
      const lone = newCompany({ legalName: 'Sem Dependentes, Lda.' });
      await tenant.companies.create(contextFor(lone.tenantId), lone);
      // Estabelecimento sem associação local da carol: a mudança de branch_id não colide com UNIQUE nem FK.
      const eastA = createBranch(branchInput(s.companyA, { code: 'A-ESTE' }));
      await tenant.branches.create(contextA, eastA);
      // Associação sem atribuições nem associações locais e identidade sem associação no tenant A.
      const eve = newUser();
      const mallory = newUser();
      await users.create(eve);
      await users.create(mallory);
      const eveAtA = newCompanyMembership(eve, s.companyA);
      await memberships.companyMemberships.create(contextA, eveAtA);
      const localId = database
        .prepare('SELECT id FROM branch_memberships WHERE company_membership_id = ? AND branch_id = ?')
        .pluck()
        .get(s.carolAtA.id, s.northA.id) as string;
      const eveRowid = database.prepare('SELECT rowid FROM company_memberships WHERE id = ?').pluck().get(eveAtA.id) as number;
      const snapshot = () =>
        Object.fromEntries(
          ['companies', 'branches', 'company_memberships', 'branch_memberships'].map((table) => [
            table,
            database.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all(),
          ]),
        );
      const before = snapshot();
      const refused = [
        ['UPDATE companies SET tenant_id = ? WHERE id = ?', randomUUID(), lone.id],
        ['UPDATE companies SET tenant_id = ? WHERE id = ?', randomUUID(), s.companyA.id],
        ['UPDATE branch_memberships SET branch_id = ? WHERE id = ?', eastA.id, localId],
        ['UPDATE branches SET company_id = ? WHERE id = ?', lone.id, eastA.id],
        ['UPDATE company_memberships SET user_id = ? WHERE id = ?', mallory.id, eveAtA.id],
        ['UPDATE company_memberships SET tenant_id = ? WHERE id = ?', randomUUID(), eveAtA.id],
        ['UPDATE company_memberships SET company_id = ? WHERE id = ?', lone.id, eveAtA.id],
      ] as const;
      for (const [sql, ...parameters] of refused) expect(() => database.prepare(sql).run(...parameters), sql).toThrow(REFUSED);
      for (const verb of ['REPLACE', 'INSERT OR REPLACE']) {
        expect(
          () =>
            database
              .prepare(
                `${verb} INTO company_memberships (rowid, id, user_id, tenant_id, company_id, scope, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 'COMPANY_WIDE', 'ACTIVE', ?, ?)`,
              )
              .run(eveRowid, randomUUID(), mallory.id, s.companyA.tenantId, s.companyA.id, CREATED_AT, CREATED_AT),
          `${verb} by rowid with a new id`,
        ).toThrow(REFUSED);
      }
      expect(snapshot()).toEqual(before);
    });

    it('[RI05h] records the installation bootstrap once and never redirects the initial administrator (PD-73)', () => {
      const record = () => database.prepare('SELECT rowid, * FROM installation_bootstrap').all();
      expect(record()).toEqual([]);
      const insert = (verb: string, administratorId: string, id = 1) =>
        database
          .prepare(`${verb} INTO installation_bootstrap (id, initial_administrator_id, completed_at) VALUES (?, ?, ?)`)
          .run(id, administratorId, CREATED_AT);
      // A inicialização legítima (uma única inserção, como em E1.07-B) continua aceite.
      insert('INSERT', s.alice.id);
      const before = record();
      const attempts: Record<string, () => unknown> = {
        'INSERT again': () => insert('INSERT', s.carol.id),
        'INSERT OR IGNORE': () => insert('INSERT OR IGNORE', s.carol.id),
        'INSERT OR REPLACE': () => insert('INSERT OR REPLACE', s.carol.id),
        'REPLACE INTO': () => insert('REPLACE', s.carol.id),
        'INSERT id 2': () => insert('INSERT', s.carol.id, 2),
        'UPDATE administrator': () => database.prepare('UPDATE installation_bootstrap SET initial_administrator_id = ?').run(s.carol.id),
        'UPDATE OR REPLACE administrator': () =>
          database.prepare('UPDATE OR REPLACE installation_bootstrap SET initial_administrator_id = ?').run(s.carol.id),
        'UPDATE completion': () => database.prepare('UPDATE installation_bootstrap SET completed_at = ?').run(UPDATED_AT),
        'UPDATE id': () => database.prepare('UPDATE installation_bootstrap SET id = 2').run(),
        'DELETE': () => database.prepare('DELETE FROM installation_bootstrap').run(),
        'DELETE + INSERT': () =>
          database
            .transaction(() => {
              database.prepare('DELETE FROM installation_bootstrap').run();
              insert('INSERT', s.carol.id);
            })
            .immediate(),
      };
      for (const [label, attempt] of Object.entries(attempts)) expect(attempt, label).toThrow(REFUSED);
      expect(record()).toEqual(before);
      expect(database.prepare('SELECT initial_administrator_id FROM installation_bootstrap WHERE id = 1').pluck().get()).toBe(s.alice.id);
    });
  });

  it('[RI06] enforces each uniqueness layer independently: partial indexes without triggers and triggers without indexes', async () => {
    const a = { companyId: s.companyA.id, tenantId: s.companyA.tenantId };
    database.exec('DROP TRIGGER role_assignments_insert_requires_new_eligible_assignment; DROP TRIGGER roles_insert_requires_new_role_in_company;');
    insertAssignment(database, { ...a, membershipId: s.aliceAtA.id, roleId: s.roleA.id });
    expect(() => insertAssignment(database, { ...a, membershipId: s.aliceAtA.id, roleId: s.roleA.id })).toThrow(/UNIQUE/);
    const branch = { ...a, branchId: s.northA.id, membershipId: s.carolAtA.id, roleId: s.roleA.id, scope: 'BRANCH' };
    insertAssignment(database, branch);
    expect(() => insertAssignment(database, branch)).toThrow(/UNIQUE/);
    expect(() => insertRole(database, { ...a, code: 'OPERADOR' })).toThrow(/UNIQUE/);

    const other = createTemporaryDatabase();
    try {
      const connection = other.open();
      runMigrations(connection);
      const t = await seedDatabase(connection, createSqliteAuthorizationPersistence(connection));
      connection.exec('DROP INDEX role_assignments_company_wide_unique; DROP INDEX role_assignments_branch_unique;');
      const b = { companyId: t.companyA.id, tenantId: t.companyA.tenantId };
      insertAssignment(connection, { ...b, membershipId: t.aliceAtA.id, roleId: t.roleA.id });
      expect(() => insertAssignment(connection, { ...b, membershipId: t.aliceAtA.id, roleId: t.roleA.id })).toThrow(/constraint failed/);
      const atNorth = { ...b, branchId: t.northA.id, membershipId: t.carolAtA.id, roleId: t.roleA.id, scope: 'BRANCH' };
      insertAssignment(connection, atNorth);
      expect(() => insertAssignment(connection, atNorth)).toThrow(/constraint failed/);
    } finally {
      other.dispose();
    }
  });

  it('[RI07] enforces the basic grammar of permission and role codes in the schema', () => {
    const tenantId = s.companyA.tenantId;
    const invalid = [
      'company', 'Company.read', 'company..read', '.company.read', 'company.read.', 'company.*', 'company.read%',
      'company.all', 'any.read', '_company.read', 'company_.read', 'company.read_', 'company__x.read', '1company.read',
      'company.1read', 'a.b.c.d.e', 'company.réad', 'company read', 'installation.settings.read', 'platform.tenants.read',
      `a.${'b'.repeat(95)}`,
    ];
    for (const permissionCode of invalid) {
      expect(() => insertPermission(database, { permissionCode, roleId: s.roleA.id, tenantId }), permissionCode).toThrow(REFUSED);
    }
    for (const permissionCode of ['sales.create', 'roles.permissions.grant', 'a1.b2_c3.d', 'x.y']) {
      insertPermission(database, { permissionCode, roleId: s.roleA.id, tenantId });
    }
    for (const code of ['a', 'operador', '1PERFIL', 'PER FIL', 'PERFIL!', '-PERFIL', `P${'X'.repeat(64)}`]) {
      expect(() => insertRole(database, { code, companyId: s.companyA.id, tenantId }), code).toThrow(REFUSED);
    }
  });

  it('[RI08] rolls back related writes and refuses asynchronous work in transactions', async () => {
    const context = contextFor(s.companyA.tenantId);
    const before = ['roles', 'role_permissions', 'role_assignments'].map((table) => count(database, table));
    const role = newRole(s.companyA, { code: 'TRANSACCAO' });
    expect(() =>
      authorization.transaction((stores) => {
        stores.roles.create(context, role);
        stores.rolePermissions.add(context, grantTo(role, 'company.read'));
        stores.roleAssignments.create(context, assignCompanyWide(role, s.aliceAtA));
        throw new Error('falha simulada');
      }),
    ).toThrow('falha simulada');
    // Falha parcial: a segunda concessão é recusada e reverte também o perfil e a primeira concessão.
    expect(() =>
      authorization.transaction((stores) => {
        stores.roles.create(context, role);
        stores.rolePermissions.add(context, grantTo(role, 'company.read'));
        stores.rolePermissions.add(context, grantTo(role, 'company.read'));
      }),
    ).toThrow(/duplicate-role-permission/);
    expect(() => authorization.transaction(async () => Promise.resolve())).toThrow(/async-transaction/);
    let leaked: Parameters<Parameters<typeof authorization.transaction>[0]>[0] | undefined;
    authorization.transaction((stores) => {
      leaked = stores;
    });
    expect(() => leaked?.roles.findById(context, role.id)).toThrow(/transaction-closed/);
    expect(['roles', 'role_permissions', 'role_assignments'].map((table) => count(database, table))).toEqual(before);
    await expect(authorization.roles.findById(context, role.id)).resolves.toBeUndefined();
  });

  it('[RI09] keeps integrity after a real process interruption in the middle of a write transaction', () => {
    database.close();
    const requireFromDatabase = createRequire(path.join(REPOSITORY_ROOT, 'packages', 'database', 'package.json'));
    const driver = requireFromDatabase.resolve('better-sqlite3');
    // O processo filho escreve dentro de uma transacção e é terminado à força antes (ou depois) do
    // COMMIT. A marca no stdout prova que as escritas foram executadas antes da terminação.
    const script = `
      const fs = require('node:fs');
      const Database = require(process.argv[1]);
      const db = new Database(process.argv[2]);
      db.pragma('journal_mode = WAL');
      db.exec('BEGIN IMMEDIATE');
      db.prepare("UPDATE roles SET name = 'Interrompido', updated_at = ? WHERE id = ?").run(process.argv[5], process.argv[4]);
      db.prepare("INSERT INTO role_permissions (tenant_id, role_id, permission_code, catalog_version, created_at) VALUES (?, ?, 'company.read', 1, ?)")
        .run(process.argv[3], process.argv[4], process.argv[5]);
      if (process.argv[6] === 'commit') db.exec('COMMIT');
      fs.writeSync(1, 'WRITES_DONE');
      process.kill(process.pid, 'SIGKILL');
    `;
    const interrupt = (mode: 'commit' | 'no-commit') => {
      const result = spawnSync(
        process.execPath,
        ['-e', script, driver, temporary.filename, s.companyA.tenantId, s.roleA.id, UPDATED_AT, mode],
        { encoding: 'utf8', timeout: 20_000 },
      );
      expect(result.stdout).toBe('WRITES_DONE');
      expect(result.status).not.toBe(0);
      const reopened = temporary.open();
      try {
        expect(reopened.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
        expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(inspectMigrations(reopened).pendingVersions).toEqual([]);
        return {
          grants: count(reopened, 'role_permissions'),
          name: reopened.prepare('SELECT name FROM roles WHERE id = ?').pluck().get(s.roleA.id),
        };
      } finally {
        reopened.close();
      }
    };
    expect(interrupt('no-commit')).toEqual({ grants: 0, name: s.roleA.name });
    expect(interrupt('commit')).toEqual({ grants: 1, name: 'Interrompido' });
  });

  it('[RI10] scopes a fictitious sales.create at branch A and reading at branch B (experimental catalogue only)', async () => {
    const context = contextFor(s.companyA.tenantId);
    const cashier = newRole(s.companyA, { code: 'CAIXA' });
    const reader = newRole(s.companyA, { code: 'LEITOR' });
    await authorization.roles.create(context, cashier);
    await authorization.roles.create(context, reader);
    // `sales.create` não existe no catálogo oficial: o repositório recusa-a; só a escrita directa de
    // teste a persiste, para demonstrar a intersecção de âmbitos com o catálogo experimental.
    await expect(authorization.rolePermissions.add(context, grantTo(cashier, 'sales.create'))).rejects.toMatchObject({
      reason: 'unknown-permission',
    });
    insertPermission(database, { permissionCode: 'sales.create', roleId: cashier.id, tenantId: s.companyA.tenantId });
    await authorization.rolePermissions.add(context, grantTo(reader, 'branches.read'));
    await authorization.roleAssignments.create(context, assignAtBranch(cashier, s.carolAtA, s.northA));
    await authorization.roleAssignments.create(context, assignAtBranch(reader, s.carolAtA, s.southA));

    const experimental = async (code: string, branch: Branch): Promise<AuthorizationDecision> => {
      const request = requestFor(s.carol, code, branchTarget(s.companyA, branch));
      const company = await authorization.readCompanyAuthorizationFacts(context, s.carol.id, s.companyA.id);
      return evaluateAuthorizationFacts({ catalog: TEST_CATALOG, company, request });
    };
    const atNorth = await experimental('sales.create', s.northA);
    expect(inspectDomainDecision(atNorth)).toEqual({ catalog: 'EXPERIMENTAL', outcome: 'GRANTED', recognized: true });
    expect(isOfficialDomainGrant(atNorth)).toBe(false);
    expect(await experimental('sales.create', s.southA)).toMatchObject({ outcome: 'DENIED', reason: 'permission-not-granted' });
    expect(await experimental('branches.read', s.southA)).toMatchObject({ outcome: 'GRANTED' });
    expect(await experimental('branches.read', s.northA)).toMatchObject({ outcome: 'DENIED', reason: 'permission-not-granted' });

    const engine = createInternalDomainAuthorizationEvaluator(authorization.readCompanyAuthorizationFacts);
    const official = (code: string, branch: Branch) =>
      engine.evaluate({ permissionCode: code, scope: branchTarget(s.companyA, branch), userId: s.carol.id });
    expect(await official('sales.create', s.northA)).toMatchObject({ outcome: 'DENIED', reason: 'unknown-permission' });
    expect(await official('sales.create', s.southA)).toMatchObject({ outcome: 'DENIED', reason: 'unknown-permission' });
    expect(isOfficialDomainGrant(await official('branches.read', s.southA))).toBe(true);
    expect(await official('branches.read', s.northA)).toMatchObject({ outcome: 'DENIED', reason: 'permission-not-granted' });
  });

  it('[RI11] accepts only the official catalogue in the operational path; classifies withdrawn and unknown codes', () => {
    for (const guard of [requireOperationalPermissionCatalog, requireDomainEvaluationCatalog]) {
      expect(guard(OFFICIAL_PERMISSION_CATALOG)).toBe(OFFICIAL_PERMISSION_CATALOG);
      expect(() => guard(TEST_CATALOG)).toThrow(AuthorizationContractError);
      expect(() => guard(TEST_CATALOG)).toThrow(/catalog-not-official/);
      const fabricated = { ...OFFICIAL_PERMISSION_CATALOG } as PermissionCatalog;
      const cloned = structuredClone({ permissions: OFFICIAL_PERMISSION_CATALOG.permissions, version: 1 });
      for (const value of [fabricated, cloned, new Proxy(OFFICIAL_PERMISSION_CATALOG, {}), null, undefined]) {
        expect(() => guard(value)).toThrow(/untrusted-catalog/);
      }
    }
    const withdrawn = createExperimentalPermissionCatalog(1, [
      { authorityScope: 'COMPANY', category: 'ADMINISTRATION', code: 'company.read', description: 'Exemplo', status: 'WITHDRAWN' },
      { authorityScope: 'COMPANY', category: 'ADMINISTRATION', code: 'company.update', description: 'Exemplo' },
    ]);
    const code = parsePermissionCode;
    expect(classifyStoredRolePermission(withdrawn, code('company.read'), 1)).toBe('WITHDRAWN');
    expect(classifyStoredRolePermission(withdrawn, code('company.update'), 1)).toBe('RECOGNIZED');
    expect(classifyStoredRolePermission(withdrawn, code('company.update'), 2)).toBe('NEWER_CATALOG');
    expect(classifyStoredRolePermission(withdrawn, code('company.archive'), 1)).toBe('UNREGISTERED');
    expect(classifyStoredRolePermission(OFFICIAL_PERMISSION_CATALOG, code('installation.settings.read'), 1)).toBe('AUTHORITY_INCOMPATIBLE');
    expect(() => classifyStoredRolePermission({ ...withdrawn }, code('company.read'), 1)).toThrow(/untrusted-catalog/);
  });

  it('[RI12] exposes no HTTP, IPC, network or Electron surface and persists no decisions', () => {
    const files = [
      path.join(REPOSITORY_ROOT, 'packages', 'database', 'src', 'sqlite-authorization-persistence.ts'),
      path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'authorization', 'domain-authorization-engine.ts'),
    ];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/from '(electron|fastify|node:(http|https|http2|net|tls|dgram|dns|child_process))'|ipcMain|ipcRenderer|listen\(|\bfetch\(/);
      expect(text, file).not.toMatch(/JSON\.stringify|localStorage|writeFile/);
    }
    const desktop = readdirSync(path.join(REPOSITORY_ROOT, 'apps', 'desktop', 'src'), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
    expect(desktop.length).toBeGreaterThan(3);
    for (const file of desktop) expect(readFileSync(file, 'utf8'), file).not.toMatch(/internalAuthorization|domainEvaluator|role_assignments|RoleRepository/);
    const schema = database.prepare("SELECT group_concat(sql, ' ') FROM sqlite_schema").pluck().get() as string;
    expect(schema).not.toMatch(/decision|session_permissions|permission_catalog\b|authorization_token/i);
  });

  it('[RI13] relies on NEW.rowid only when it is a positive, explicit rowid (PD-72, SQLite semantics)', () => {
    // O SQLite declara NEW.rowid indefinido num BEFORE INSERT sem rowid explícito. As guardas da
    // migração 7 só o usam quando é positivo (um rowid explícito ocupado); o AFTER INSERT vê o valor real.
    const probe = createTemporaryDatabase();
    try {
      const connection = probe.open();
      connection.exec(`
        CREATE TABLE probe (id TEXT PRIMARY KEY NOT NULL) STRICT;
        CREATE TABLE seen (label TEXT NOT NULL, before_rowid INTEGER, after_rowid INTEGER) STRICT;
        CREATE TABLE current_label (label TEXT NOT NULL) STRICT;
        INSERT INTO current_label VALUES ('');
        CREATE TRIGGER probe_before BEFORE INSERT ON probe
        BEGIN INSERT INTO seen (label, before_rowid) VALUES ((SELECT label FROM current_label), NEW.rowid); END;
        CREATE TRIGGER probe_after AFTER INSERT ON probe
        BEGIN UPDATE seen SET after_rowid = NEW.rowid WHERE rowid = (SELECT max(rowid) FROM seen); END;
      `);
      const run = (label: string, sql: string) => {
        connection.prepare('UPDATE current_label SET label = ?').run(label);
        connection.exec(sql);
      };
      run('implicit', "INSERT INTO probe (id) VALUES ('a')");
      run('implicit select', "INSERT INTO probe (id) SELECT 'b'");
      run('explicit null', "INSERT INTO probe (rowid, id) VALUES (NULL, 'c')");
      run('explicit 10', "INSERT INTO probe (rowid, id) VALUES (10, 'd')");
      run('replace implicit', "REPLACE INTO probe (id) VALUES ('a')");
      const seen = connection.prepare('SELECT label, before_rowid AS before, after_rowid AS after FROM seen ORDER BY rowid').all() as {
        label: string;
        before: number;
        after: number;
      }[];
      for (const row of seen.filter((entry) => entry.label !== 'explicit 10')) {
        expect(row.before, row.label).toBeLessThanOrEqual(0);
        expect(row.after, row.label).toBeGreaterThan(0);
      }
      expect(seen.find((entry) => entry.label === 'explicit 10')).toMatchObject({ after: 10, before: 10 });
    } finally {
      probe.dispose();
    }
  });
});
