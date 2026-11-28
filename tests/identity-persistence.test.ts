import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createSqliteMembershipPersistence,
  createSqliteTenantPersistence,
  createSqliteUserDirectory,
  inspectMigrations,
  MIGRATIONS,
  migrationChecksum,
  PersistenceError,
  runMigrations,
  type MembershipStores,
  type Migration,
  type SqliteDatabase,
} from '../packages/database/src/index';
import {
  createBranch,
  parseCompanyMembershipId,
  RecordConflictError,
  type CompanyId,
  type TenantContext,
  type UserId,
} from '../packages/shared-types/src/index';
import { LocalServiceStartupError, LocalServiceStateError } from '../services/local-api/src/local-service';
import { runThenCleanUp } from './support/cleanup-after';
import { branchInput, contextFor, CREATED_AT, newCompany, newId } from './support/fixtures';
import { newBranchMembership, newCompanyMembership, newUser } from './support/identity-fixtures';
import { createServiceUnderTest, REPOSITORY_ROOT, serviceConfig, type ServiceUnderTest } from './support/local-service-harness';
import { stopServicesThenDispose } from './support/service-cleanup';
import { createTemporaryDatabase, type TemporaryDatabase } from './support/sqlite-harness';

const E1_04_MIGRATIONS = MIGRATIONS.slice(0, 1);
// Derivados da lista de migrações (E1.07-B acrescentou a versão 3): verificam sempre o esquema completo.
const ALL_VERSIONS = MIGRATIONS.map((candidate) => candidate.version);
const LATEST_VERSION = MIGRATIONS.length;
const AFTER_E1_04 = ALL_VERSIONS.filter((version) => version > 1);

const migration = (version: number): Migration => {
  const found = MIGRATIONS.find((candidate) => candidate.version === version);
  if (found === undefined) throw new Error(`Migração ${version} inexistente.`);
  return found;
};
const IDENTITY_TABLES = ['branch_memberships', 'company_memberships', 'users'] as const;
const CREDENTIAL_COLUMN = /pass|pin|token|secret|hash|credential|otp|salt/i;

type Table = 'branches' | 'branch_memberships' | 'companies' | 'company_memberships' | 'schema_migrations' | 'users';

const count = (database: SqliteDatabase, table: Table): number =>
  database.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;

const rows = (database: SqliteDatabase, table: 'branches' | 'companies'): unknown[] =>
  database.prepare(`SELECT * FROM ${table} ORDER BY id`).all();

const captureError = async (action: () => Promise<unknown>): Promise<Error> => {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('Era esperado um erro.');
};

const expectConstraint = (action: () => unknown): void => {
  expect(action).toThrow(/constraint/i);
};

/** Base E1.04 (só a migração 1) com dados fictícios de duas empresas e três estabelecimentos. */
const createLegacyDatabase = async (temporary: TemporaryDatabase) => {
  const legacy = temporary.open();
  expect(runMigrations(legacy, E1_04_MIGRATIONS)).toEqual({ applied: [1], currentVersion: 1 });
  const companyA = newCompany({ legalName: 'Empresa Antiga A, Lda.' });
  const companyB = newCompany({ legalName: 'Empresa Antiga B, Lda.', nif: undefined, status: 'DRAFT' });
  const branchA1 = createBranch(branchInput(companyA, { code: 'A-01', sectorType: 'FUEL_STATION' }));
  const branchA2 = createBranch(branchInput(companyA, { code: 'A-02', sectorType: 'PHARMACY' }));
  const branchB1 = createBranch(branchInput(companyB, { code: 'B-01' }));
  const tenant = createSqliteTenantPersistence(legacy);
  await tenant.companies.create(contextFor(companyA.tenantId), companyA);
  await tenant.companies.create(contextFor(companyB.tenantId), companyB);
  for (const branch of [branchA1, branchA2]) await tenant.branches.create(contextFor(companyA.tenantId), branch);
  await tenant.branches.create(contextFor(companyB.tenantId), branchB1);
  const snapshot = { branches: rows(legacy, 'branches'), companies: rows(legacy, 'companies') };
  legacy.close();
  return { branchA1, branchA2, branchB1, companyA, companyB, snapshot };
};

describe('Identity persistence (E1.07-A)', () => {
  let temporary: TemporaryDatabase;

  beforeEach(() => {
    temporary = createTemporaryDatabase();
  });

  afterEach(() => {
    temporary.dispose();
  });

  const migratedDatabase = (): SqliteDatabase => {
    const database = temporary.open();
    runMigrations(database);
    return database;
  };

  /** Empresa com dois estabelecimentos, uma identidade e uma associação `BRANCH_RESTRICTED`. */
  const seeded = async (database: SqliteDatabase) => {
    const tenant = createSqliteTenantPersistence(database);
    const users = createSqliteUserDirectory(database);
    const memberships = createSqliteMembershipPersistence(database);
    const company = newCompany();
    const context = contextFor(company.tenantId);
    const north = createBranch(branchInput(company, { code: 'NORTE' }));
    const south = createBranch(branchInput(company, { code: 'SUL' }));
    await tenant.companies.create(context, company);
    for (const branch of [north, south]) await tenant.branches.create(context, branch);
    const user = newUser();
    await users.create(user);
    const membership = newCompanyMembership(user, company, { scope: 'BRANCH_RESTRICTED' });
    await memberships.companyMemberships.create(context, membership);
    return { company, context, membership, memberships, north, south, tenant, user, users };
  };

  describe('migration 2', () => {
    it('creates the identity tables, isolation indexes and audit record', () => {
      const database = temporary.open();

      expect(runMigrations(database)).toEqual({ applied: ALL_VERSIONS, currentVersion: LATEST_VERSION });

      const objects = database
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name")
        .pluck()
        .all();
      expect(objects).toEqual(
        expect.arrayContaining([
          ...IDENTITY_TABLES,
          'branches_id_tenant_company_unique',
          'branch_memberships_tenant_membership_idx',
          'company_memberships_tenant_company_idx',
        ]),
      );
      expect(database.prepare('SELECT name, checksum FROM schema_migrations WHERE version = 2').get()).toEqual({
        checksum: migrationChecksum(migration(2)),
        name: 'create_users_and_memberships',
      });
      for (const table of IDENTITY_TABLES) {
        const strict = database.prepare("SELECT strict FROM pragma_table_list WHERE name = ?").pluck().get(table);
        expect(strict).toBe(1);
      }
    });

    it('stores no credential columns in the identity tables', () => {
      const database = migratedDatabase();

      for (const table of IDENTITY_TABLES) {
        const columns = database.prepare(`SELECT name FROM pragma_table_info('${table}')`).pluck().all() as string[];
        expect(columns.length).toBeGreaterThan(0);
        expect(columns.filter((column) => CREDENTIAL_COLUMN.test(column))).toEqual([]);
      }
    });

    it('upgrades an E1.04 database with data, preserving every company and branch', async () => {
      const legacy = await createLegacyDatabase(temporary);
      const original = migrationChecksum(migration(1));

      const upgraded = temporary.open();
      expect(inspectMigrations(upgraded)).toMatchObject({ appliedVersions: [1], pendingVersions: AFTER_E1_04 });
      expect(runMigrations(upgraded)).toEqual({ applied: AFTER_E1_04, currentVersion: LATEST_VERSION });

      expect(rows(upgraded, 'companies')).toEqual(legacy.snapshot.companies);
      expect(rows(upgraded, 'branches')).toEqual(legacy.snapshot.branches);
      expect(upgraded.prepare('SELECT checksum FROM schema_migrations WHERE version = 1').pluck().get()).toBe(original);
      for (const table of IDENTITY_TABLES) expect(count(upgraded, table)).toBe(0);

      const tenant = createSqliteTenantPersistence(upgraded);
      await expect(tenant.companies.findById(contextFor(legacy.companyA.tenantId), legacy.companyA.id)).resolves.toEqual(
        legacy.companyA,
      );
      await expect(
        tenant.branches.listByCompany(contextFor(legacy.companyA.tenantId), legacy.companyA.id),
      ).resolves.toEqual([legacy.branchA1, legacy.branchA2]);
    });

    it('lets pre-existing companies and branches receive memberships after the upgrade', async () => {
      const legacy = await createLegacyDatabase(temporary);
      const upgraded = temporary.open();
      runMigrations(upgraded);
      const users = createSqliteUserDirectory(upgraded);
      const memberships = createSqliteMembershipPersistence(upgraded);
      const context = contextFor(legacy.companyA.tenantId);
      const user = newUser();
      await users.create(user);
      const membership = newCompanyMembership(user, legacy.companyA, { scope: 'BRANCH_RESTRICTED' });
      await memberships.companyMemberships.create(context, membership);
      await memberships.branchMemberships.create(context, newBranchMembership(membership, legacy.branchA2));

      await expect(memberships.scopes.evaluate(context, user.id)).resolves.toMatchObject({
        branchIds: [legacy.branchA2.id],
        eligible: true,
      });
      const draftContext = contextFor(legacy.companyB.tenantId);
      await memberships.companyMemberships.create(draftContext, newCompanyMembership(user, legacy.companyB));
      await expect(memberships.scopes.evaluate(draftContext, user.id)).resolves.toMatchObject({
        branchIds: [legacy.branchB1.id],
        companyOperational: false,
      });
    });

    it('re-runs safely without touching identities or memberships', async () => {
      const database = migratedDatabase();
      const { membership, memberships, north, context } = await seeded(database);
      await memberships.branchMemberships.create(context, newBranchMembership(membership, north));

      expect(runMigrations(database)).toEqual({ applied: [], currentVersion: LATEST_VERSION });
      database.close();
      expect(runMigrations(temporary.open())).toEqual({ applied: [], currentVersion: LATEST_VERSION });

      const reopened = temporary.open();
      expect(count(reopened, 'schema_migrations')).toBe(MIGRATIONS.length);
      expect([count(reopened, 'users'), count(reopened, 'company_memberships'), count(reopened, 'branch_memberships')]).toEqual([
        1, 1, 1,
      ]);
    });

    it('refuses a database whose identity migration was altered', () => {
      const database = migratedDatabase();
      database.prepare("UPDATE schema_migrations SET checksum = 'alterado' WHERE version = 2").run();

      expect(() => runMigrations(database)).toThrow(PersistenceError);
      expect(() => inspectMigrations(database)).toThrow('Falha de persistência: migration-checksum-mismatch.');
    });
  });

  describe('persistence across connections', () => {
    it('keeps identities, memberships and scopes after closing and reopening the file', async () => {
      const first = migratedDatabase();
      const { company, context, membership, memberships, north, user } = await seeded(first);
      const local = newBranchMembership(membership, north);
      await memberships.branchMemberships.create(context, local);
      const before = await memberships.scopes.evaluate(context, user.id);
      first.close();

      const reopened = temporary.open();
      const reader = createSqliteMembershipPersistence(reopened);

      await expect(createSqliteUserDirectory(reopened).findById(user.id)).resolves.toEqual(user);
      await expect(reader.companyMemberships.findByUser(context, user.id)).resolves.toEqual(membership);
      await expect(reader.branchMemberships.findById(context, local.id)).resolves.toEqual(local);
      await expect(reader.scopes.evaluate(context, user.id)).resolves.toEqual(before);
      expect(before).toMatchObject({ branchIds: [north.id], companyId: company.id });
    });
  });

  describe('transactions', () => {
    it('commits related membership changes together', async () => {
      const database = migratedDatabase();
      const { company, context, memberships, north, south, users } = await seeded(database);
      const user = newUser();
      await users.create(user);
      const membership = newCompanyMembership(user, company, { scope: 'BRANCH_RESTRICTED' });

      memberships.transaction(({ branchMemberships, companyMemberships }) => {
        companyMemberships.create(context, membership);
        branchMemberships.create(context, newBranchMembership(membership, north));
        branchMemberships.create(context, newBranchMembership(membership, south));
      });

      await expect(memberships.scopes.evaluate(context, user.id)).resolves.toMatchObject({
        branchIds: [north.id, south.id].sort(),
      });
    });

    it('rolls back every change when the work throws or a later operation breaks a rule', async () => {
      const database = migratedDatabase();
      const { company, context, memberships, north, users } = await seeded(database);
      const user = newUser();
      await users.create(user);
      const membership = newCompanyMembership(user, company, { scope: 'BRANCH_RESTRICTED' });
      const before = [count(database, 'company_memberships'), count(database, 'branch_memberships')];

      expect(() =>
        memberships.transaction(({ branchMemberships, companyMemberships }) => {
          companyMemberships.create(context, membership);
          branchMemberships.create(context, newBranchMembership(membership, north));
          throw new Error('falha simulada');
        }),
      ).toThrow('falha simulada');
      expect(() =>
        memberships.transaction(({ branchMemberships, companyMemberships }) => {
          companyMemberships.create(context, membership);
          branchMemberships.create(context, newBranchMembership(membership, north));
          branchMemberships.create(context, newBranchMembership(membership, north));
        }),
      ).toThrow(RecordConflictError);

      expect([count(database, 'company_memberships'), count(database, 'branch_memberships')]).toEqual(before);
      await expect(memberships.companyMemberships.findByUser(context, user.id)).resolves.toBeUndefined();
    });

    it('rejects asynchronous work and closes the stores afterwards', () => {
      const database = migratedDatabase();
      const memberships = createSqliteMembershipPersistence(database);
      let leaked: MembershipStores | undefined;
      const context = contextFor(newCompany().tenantId);

      expect(() => memberships.transaction(() => Promise.resolve())).toThrow(
        'Falha de persistência: async-transaction.',
      );
      memberships.transaction((stores) => {
        leaked = stores;
      });
      expect(() => leaked?.companyMemberships.findByUser(context, newUser().id)).toThrow(
        'Falha de persistência: transaction-closed.',
      );
    });
  });

  describe('database-level integrity', () => {
    const insertMembership = (database: SqliteDatabase, values: Record<string, string>): void => {
      database
        .prepare(
          `INSERT INTO company_memberships (id, user_id, tenant_id, company_id, scope, status, created_at, updated_at)
           VALUES (@id, @user_id, @tenant_id, @company_id, @scope, @status, @created_at, @created_at)`,
        )
        .run({ created_at: CREATED_AT, id: newId(), scope: 'COMPANY_WIDE', status: 'ACTIVE', ...values });
    };

    const insertBranchMembership = (database: SqliteDatabase, values: Record<string, string>): void => {
      database
        .prepare(
          `INSERT INTO branch_memberships
             (id, company_membership_id, tenant_id, company_id, branch_id, status, created_at, updated_at)
           VALUES (@id, @company_membership_id, @tenant_id, @company_id, @branch_id, @status, @created_at, @created_at)`,
        )
        .run({ created_at: CREATED_AT, id: newId(), status: 'ACTIVE', ...values });
    };

    it('ties memberships to a company of the same tenant and to an existing identity', async () => {
      const database = migratedDatabase();
      const { company, user } = await seeded(database);
      const other = newCompany();
      await createSqliteTenantPersistence(database).companies.create(contextFor(other.tenantId), other);

      expectConstraint(() =>
        insertMembership(database, { company_id: other.id, tenant_id: company.tenantId, user_id: user.id }),
      );
      expectConstraint(() =>
        insertMembership(database, { company_id: company.id, tenant_id: company.tenantId, user_id: newId() }),
      );
      expectConstraint(() =>
        insertMembership(database, { company_id: company.id, tenant_id: company.tenantId, user_id: user.id }),
      );
      expectConstraint(() =>
        insertMembership(database, {
          company_id: other.id,
          scope: 'GLOBAL',
          tenant_id: other.tenantId,
          user_id: user.id,
        }),
      );
    });

    it('ties branch memberships to a branch of the same company and tenant', async () => {
      const database = migratedDatabase();
      const { company, membership, north } = await seeded(database);
      const other = newCompany();
      const foreign = createBranch(branchInput(other));
      const tenant = createSqliteTenantPersistence(database);
      await tenant.companies.create(contextFor(other.tenantId), other);
      await tenant.branches.create(contextFor(other.tenantId), foreign);
      const base = {
        branch_id: north.id,
        company_id: company.id,
        company_membership_id: membership.id,
        tenant_id: company.tenantId,
      };

      expectConstraint(() => insertBranchMembership(database, { ...base, branch_id: foreign.id }));
      expectConstraint(() =>
        insertBranchMembership(database, { ...base, branch_id: foreign.id, company_id: other.id, tenant_id: other.tenantId }),
      );
      expectConstraint(() => insertBranchMembership(database, { ...base, company_membership_id: newId() }));
      insertBranchMembership(database, base);
      expectConstraint(() => insertBranchMembership(database, base));
      expect(count(database, 'branch_memberships')).toBe(1);
    });

    it('enforces normalised unique usernames and valid statuses in the schema', async () => {
      const database = migratedDatabase();
      const { user } = await seeded(database);
      const insertUser = (username: string, status = 'ACTIVE'): void => {
        database
          .prepare(
            `INSERT INTO users (id, username, display_name, status, created_at, updated_at)
             VALUES (?, ?, 'Registo directo', ?, ?, ?)`,
          )
          .run(newId(), username, status, CREATED_AT, CREATED_AT);
      };

      for (const username of [user.username, 'Maiusculas', 'com espaco', 'ab', 'joão', 'a'.repeat(65)]) {
        expectConstraint(() => insertUser(username));
      }
      expectConstraint(() => insertUser('estado.invalido', 'DELETED'));
      insertUser('registo.directo');
      expect(count(database, 'users')).toBe(2);
    });

    it('never cascades deletions over identities, memberships or history', async () => {
      const database = migratedDatabase();
      const { company, context, membership, memberships, north, tenant, user } = await seeded(database);
      await memberships.branchMemberships.create(context, newBranchMembership(membership, north));

      expectConstraint(() => database.prepare('DELETE FROM users WHERE id = ?').run(user.id));
      expectConstraint(() => database.prepare('DELETE FROM company_memberships WHERE id = ?').run(membership.id));
      // E1.07-D3-PD78-C1: the repositories no longer delete; the schema refuses it (migration 10).
      expect('delete' in tenant.branches).toBe(false);
      expect('delete' in tenant.companies).toBe(false);
      expectConstraint(() => database.prepare('DELETE FROM branches WHERE id = ?').run(north.id));
      expectConstraint(() => database.prepare('DELETE FROM companies WHERE id = ?').run(company.id));
      await expect(tenant.branches.findById(context, north.id)).resolves.toEqual(north);
      await expect(tenant.companies.findById(context, company.id)).resolves.toEqual(company);

      expect([count(database, 'users'), count(database, 'company_memberships'), count(database, 'branch_memberships')]).toEqual([
        1, 1, 1,
      ]);
      const definitions = database
        .prepare("SELECT sql FROM sqlite_master WHERE name IN ('users', 'company_memberships', 'branch_memberships')")
        .pluck()
        .all()
        .join('\n');
      expect(definitions).not.toMatch(/ON DELETE CASCADE|ON DELETE SET NULL/i);
    });
  });

  describe('SQL injection', () => {
    const payloads = [
      "'); DROP TABLE users; --",
      "' OR '1'='1",
      'x" OR 1=1 --',
      "Robert'); DELETE FROM company_memberships WHERE ('1'='1",
    ];

    it('stores hostile display names literally and rejects hostile usernames', async () => {
      const database = migratedDatabase();
      const users = createSqliteUserDirectory(database);

      for (const payload of payloads) {
        const user = newUser({ displayName: payload });
        await users.create(user);
        await expect(users.findById(user.id)).resolves.toMatchObject({ displayName: payload });
        expect(() => newUser({ username: payload })).toThrow('username');
      }

      expect(count(database, 'users')).toBe(payloads.length);
    });

    it('never matches memberships of other tenants through forged identifiers', async () => {
      const database = migratedDatabase();
      const { memberships, user } = await seeded(database);
      const attacker: TenantContext = contextFor(newCompany().tenantId);

      for (const payload of payloads) {
        await expect(memberships.companyMemberships.findByUser(attacker, payload as UserId)).resolves.toBeUndefined();
        await expect(memberships.companyMemberships.listByCompany(attacker, payload as CompanyId)).resolves.toEqual([]);
        await expect(
          memberships.branchMemberships.listByCompanyMembership(attacker, payload as never),
        ).resolves.toEqual([]);
        await expect(memberships.scopes.evaluate(attacker, payload as UserId)).resolves.toEqual({
          eligible: false,
          reason: 'no-membership',
        });
        await expect(createSqliteUserDirectory(database).findById(payload as UserId)).resolves.toBeUndefined();
      }
      await expect(memberships.scopes.evaluate(attacker, user.id)).resolves.toMatchObject({ eligible: false });
      expect([count(database, 'users'), count(database, 'company_memberships')]).toEqual([1, 1]);
    });

    it('rejects hostile tenant identifiers before any query', async () => {
      const { memberships } = await seeded(migratedDatabase());
      const hostile = { actorId: 'user:x', correlationId: 'c-1', tenantId: "' OR '1'='1" };

      await expect(
        memberships.companyMemberships.findById(hostile as unknown as TenantContext, parseCompanyMembershipId(newId())),
      ).rejects.toMatchObject({ name: 'TenantContextError', reason: 'invalid' });
    });
  });

  describe('personal data in errors', () => {
    it('does not disclose usernames, names or contacts in error messages', async () => {
      const database = migratedDatabase();
      const users = createSqliteUserDirectory(database);
      const user = newUser({
        displayName: 'Pessoa Privada Teste',
        email: 'pessoa.privada@kil-business.test',
        phone: '+000 911 111 111',
        username: 'pessoa.privada',
      });
      await users.create(user);

      const errors = [
        // Username repetido após normalização.
        await captureError(() => users.create(newUser({ username: 'PESSOA.PRIVADA' }))),
        // Identificador repetido com os mesmos dados pessoais.
        await captureError(() => users.create({ ...user })),
        // Contacto inválido que contém o nome.
        await captureError(() => users.create(newUser({ email: 'Pessoa Privada Teste <sem-dominio>' }))),
      ];

      expect(errors.map((error) => error.name)).toEqual([
        'RecordConflictError',
        'RecordConflictError',
        'DomainValidationError',
      ]);
      for (const error of errors) {
        for (const value of [user.username, user.displayName, String(user.email), String(user.phone)]) {
          expect(error.message).not.toContain(value);
        }
      }
    });

    it('never writes identity fields in service logs', async () => {
      const harness = createServiceUnderTest(serviceConfig(temporary.filename));
      await runThenCleanUp(async () => {
        await harness.service.start();
        const user = newUser({ displayName: 'Nome Registado', email: 'registo@kil-business.test' });
        await harness.service.identityProvisioning.users.create(user);
        await expect(harness.service.identityProvisioning.users.create(user)).rejects.toBeInstanceOf(RecordConflictError);
        await harness.service.stop();

        const output = harness.lines.join('\n');
        for (const value of [user.username, user.displayName, String(user.email), String(user.phone), user.id]) {
          expect(output).not.toContain(value);
        }
      }, stopServicesThenDispose([harness], temporary));
    });
  });

  // PD87-C2 (RV-C1M-03; PD-57, D-158): estes testes iniciam serviços no corpo. Numa asserção falhada
  // com um serviço activo, o `afterEach` apagava a base ainda detida (`EPERM`, pasta pendente e
  // serviço órfão). Agora os serviços são parados e as ligações confirmadas fechadas antes de apagar
  // a base, a asserção continua a ser a falha principal e as falhas de limpeza são secundárias.
  describe('local service composition', () => {
    it('refuses identity and membership operations outside READY, including stale references', async () => {
      const harness = createServiceUnderTest(serviceConfig(temporary.filename));
      const user = newUser();
      const context = contextFor(newCompany().tenantId);
      const expectNotReady = async (): Promise<void> => {
        const operations: readonly (() => Promise<unknown>)[] = [
          () => harness.service.identityProvisioning.users.findById(user.id),
          () => harness.service.identityProvisioning.users.create(newUser()),
          () => harness.service.identityProvisioning.users.changeStatus(user.id, 'INACTIVE', CREATED_AT),
          () => harness.service.companyMemberships.findByUser(context, user.id),
          () => harness.service.branchMemberships.listByCompanyMembership(context, parseCompanyMembershipId(newId())),
          () => harness.service.membershipScopes.evaluate(context, user.id),
        ];
        for (const operation of operations) {
          await expect(operation()).rejects.toMatchObject({ name: LocalServiceStateError.name, reason: 'not-ready' });
        }
      };

      await runThenCleanUp(async () => {
        await expectNotReady();
        await harness.service.start();
        const { users } = harness.service.identityProvisioning;
        const { companyMemberships, membershipScopes } = harness.service;
        await users.create(user);
        await expect(users.findById(user.id)).resolves.toEqual(user);
        await harness.service.stop();

        await expectNotReady();
        await expect(users.findById(user.id)).rejects.toBeInstanceOf(LocalServiceStateError);
        await expect(companyMemberships.findByUser(context, user.id)).rejects.toBeInstanceOf(LocalServiceStateError);
        await expect(membershipScopes.evaluate(context, user.id)).rejects.toBeInstanceOf(LocalServiceStateError);
        expect(Object.isFrozen(harness.service.identityProvisioning)).toBe(true);
      }, stopServicesThenDispose([harness], temporary));
    });

    it('applies the identity migration to an E1.04 database at startup, or refuses it under a strict policy', async () => {
      const services: ServiceUnderTest[] = [];
      await runThenCleanUp(async () => {
        const legacy = await createLegacyDatabase(temporary);

        const strict = createServiceUnderTest(
          serviceConfig(temporary.filename, { startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'fail' } }),
        );
        services.push(strict);
        await expect(strict.service.start()).rejects.toMatchObject({
          name: LocalServiceStartupError.name,
          reason: 'pending-migrations',
        });
        await strict.service.stop();

        const harness = createServiceUnderTest(serviceConfig(temporary.filename));
        services.push(harness);
        await harness.service.start();
        expect(harness.service.startupReport).toEqual({
          appliedMigrations: AFTER_E1_04,
          createdDatabase: false,
          schemaVersion: LATEST_VERSION,
        });
        await expect(
          harness.service.branches.listByCompany(contextFor(legacy.companyA.tenantId), legacy.companyA.id),
        ).resolves.toEqual([legacy.branchA1, legacy.branchA2]);
        await harness.service.stop();
      }, stopServicesThenDispose(services, temporary));
    });

    it('keeps identities and memberships across service restarts', async () => {
      const first = createServiceUnderTest(serviceConfig(temporary.filename));
      const second = createServiceUnderTest(serviceConfig(temporary.filename));
      await runThenCleanUp(async () => {
        await first.service.start();
        const company = newCompany();
        const context = contextFor(company.tenantId);
        const user = newUser();
        await first.service.companies.create(context, company);
        await first.service.identityProvisioning.users.create(user);
        await first.service.companyMemberships.create(context, newCompanyMembership(user, company));
        await first.service.stop();

        await second.service.start();
        await expect(second.service.membershipScopes.evaluate(context, user.id)).resolves.toMatchObject({
          eligible: true,
          scope: 'COMPANY_WIDE',
        });
        await second.service.stop();
      }, stopServicesThenDispose([first, second], temporary));
    });
  });

  describe('no HTTP or Electron exposure', () => {
    const sourcesOf = (...segments: string[]): readonly string[] =>
      readdirSync(path.join(REPOSITORY_ROOT, ...segments), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(ts|tsx|cts)$/.test(entry.name))
        .map((entry) => path.join(entry.parentPath, entry.name));

    it('keeps identity code free of Electron, HTTP and network modules', () => {
      const forbidden = /from '(electron|fastify|node:(http|https|http2|net|tls|dgram|child_process))'/;
      const files = [...sourcesOf('packages', 'shared-types', 'src'), ...sourcesOf('packages', 'database', 'src')];

      expect(files.length).toBeGreaterThanOrEqual(15);
      for (const file of files) expect(readFileSync(file, 'utf8')).not.toMatch(forbidden);
    });

    it('does not reach identities or memberships from the desktop, preload or HTTP factories', () => {
      const identity = /identityProvisioning|UserDirectory|membership|createSqliteUserDirectory|evaluateMembershipScope/i;
      const exposed = [
        ...sourcesOf('apps', 'desktop', 'src'),
        ...sourcesOf('apps', 'admin-portal', 'src'),
        ...sourcesOf('services', 'central-api', 'src'),
        path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'app.ts'),
        path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'cli.ts'),
        path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src', 'main.ts'),
      ];

      for (const file of exposed) expect(readFileSync(file, 'utf8')).not.toMatch(identity);
    });

    it('offers no global user search or listing', () => {
      const directory = readFileSync(
        path.join(REPOSITORY_ROOT, 'packages', 'database', 'src', 'sqlite-user-directory.ts'),
        'utf8',
      );

      expect(directory).not.toMatch(/LIKE|SELECT [^;]*FROM users(?! WHERE (id|username) = \?)/);
      expect(Object.keys(createSqliteUserDirectory(migratedDatabase())).sort()).toEqual([
        'changeStatus',
        'create',
        'findById',
      ]);
    });
  });
});
