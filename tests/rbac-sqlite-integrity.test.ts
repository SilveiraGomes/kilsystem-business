import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
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
  grantTo,
  newRole,
  requestFor,
  TEST_CATALOG,
} from './support/authorization-fixtures';
import { branchInput, contextFor, CREATED_AT, newCompany, UPDATED_AT } from './support/fixtures';
import { newBranchMembership, newCompanyMembership, newUser } from './support/identity-fixtures';
import { createServiceUnderTest, REPOSITORY_ROOT, serviceConfig } from './support/local-service-harness';
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

describe('RBAC SQLite integrity (E1.07-D2, migration 6)', () => {
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
        expect(runMigrations(connection)).toEqual({ applied: [1, 2, 3, 4, 5, 6], currentVersion: 6 });
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

        expect(inspectMigrations(connection)).toMatchObject({ appliedVersions: [1, 2, 3, 4, 5], pendingVersions: [6] });
        expect(runMigrations(connection)).toEqual({ applied: [6], currentVersion: 6 });
        const after = snapshot();
        expect({ ...after, schema_migrations: after['schema_migrations']?.slice(0, 5) }).toEqual(before);
        expect(connection.prepare('SELECT checksum FROM schema_migrations WHERE version = 6').pluck().get()).toBe(
          migrationChecksum(MIGRATIONS[5] as (typeof MIGRATIONS)[number]),
        );
        expect(connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(connection.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
        expect(runMigrations(connection)).toEqual({ applied: [], currentVersion: 6 });
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
        expect(inspectMigrations(connection)).toMatchObject({ appliedVersions: [1, 2, 3, 4, 5], pendingVersions: [6] });
        expect(connection.prepare("SELECT count(*) FROM sqlite_schema WHERE name LIKE 'role%'").pluck().get()).toBe(0);
        runMigrations(connection);
        const altered = [...MIGRATIONS.slice(0, 5), { ...MIGRATIONS[5], sql: `${MIGRATIONS[5]?.sql ?? ''}\n` } as (typeof MIGRATIONS)[number]];
        expect(() => inspectMigrations(connection, altered)).toThrow(PersistenceError);
        expect(() => inspectMigrations(connection, altered)).toThrow(/migration-checksum-mismatch/);
      } finally {
        tamper.dispose();
      }
    });

    it('[RM04] the local service refuses migration 6 under the strict policy without touching the file', async () => {
      const legacy = createTemporaryDatabase();
      try {
        const connection = legacy.open();
        runMigrations(connection, MIGRATIONS.slice(0, 5));
        connection.close();
        const before = readFileSync(legacy.filename);
        const strict = createServiceUnderTest(
          serviceConfig(legacy.filename, { startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'fail' } }),
        );
        await expect(strict.service.start()).rejects.toMatchObject({ reason: 'pending-migrations' });
        expect(readFileSync(legacy.filename).equals(before)).toBe(true);
        const applying = createServiceUnderTest(serviceConfig(legacy.filename));
        await applying.service.start();
        expect(applying.service.startupReport).toMatchObject({ appliedMigrations: [6], schemaVersion: 6 });
        await applying.service.stop();
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
});
