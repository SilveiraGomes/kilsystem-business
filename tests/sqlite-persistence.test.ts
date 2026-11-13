import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createSqliteTenantPersistence,
  MIGRATIONS,
  migrationChecksum,
  PersistenceError,
  resolveDatabaseLocation,
  runMigrations,
  type Migration,
  type SqliteDatabase,
  type TenantStores,
} from '../packages/database/src/index';
import {
  createBranch,
  RecordConflictError,
  SECTOR_TYPES,
  type CompanyId,
  type TenantContext,
} from '../packages/shared-types/src/index';
import { branchInput, contextFor, CREATED_AT, newCompany, newId } from './support/fixtures';
import { createTemporaryDatabase, type TemporaryDatabase } from './support/sqlite-harness';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

const insertCompanyRow = (database: SqliteDatabase, values: Record<string, string | null> = {}): void => {
  database
    .prepare(
      `INSERT INTO companies (id, tenant_id, jurisdiction, legal_name, trade_name, nif, status, created_at, updated_at)
       VALUES (@id, @tenant_id, @jurisdiction, @legal_name, @trade_name, @nif, @status, @created_at, @updated_at)`,
    )
    .run({
      created_at: CREATED_AT,
      id: newId(),
      jurisdiction: 'ZZ',
      legal_name: 'Registo directo, Lda.',
      nif: 'NIF-TESTE-0001',
      status: 'ACTIVE',
      tenant_id: newId(),
      trade_name: null,
      updated_at: CREATED_AT,
      ...values,
    });
};

const insertBranchRow = (database: SqliteDatabase, values: Record<string, string>): void => {
  database
    .prepare(
      `INSERT INTO branches (id, tenant_id, company_id, name, code, sector_type, status, created_at, updated_at)
       VALUES (@id, @tenant_id, @company_id, @name, @code, @sector_type, @status, @created_at, @updated_at)`,
    )
    .run({
      code: 'RAW-01',
      created_at: CREATED_AT,
      id: newId(),
      name: 'Registo directo',
      sector_type: 'PHARMACY',
      status: 'ACTIVE',
      updated_at: CREATED_AT,
      ...values,
    });
};

const count = (database: SqliteDatabase, table: 'branches' | 'companies' | 'schema_migrations'): number =>
  database.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;

const expectPersistenceError = (action: () => unknown, reason: string): void => {
  expect(action).toThrow(PersistenceError);
  expect(action).toThrow(`Falha de persistência: ${reason}.`);
};

describe('SQLite persistence (E1.04)', () => {
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

  describe('connection', () => {
    it('creates the database file with foreign keys and WAL enabled', () => {
      expect(existsSync(temporary.filename)).toBe(false);

      const database = temporary.open();

      expect(existsSync(temporary.filename)).toBe(true);
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
    });

    it('reopens an existing database with its schema', () => {
      migratedDatabase().close();

      const reopened = temporary.open();

      expect(reopened.prepare('SELECT version FROM schema_migrations').pluck().all()).toEqual([1]);
      expect(reopened.pragma('foreign_keys', { simple: true })).toBe(1);
    });
  });

  describe('migrations', () => {
    it('creates the versioned schema, isolation indexes and audit record', () => {
      const database = temporary.open();

      expect(runMigrations(database)).toEqual({ applied: [1], currentVersion: 1 });

      const objects = database
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name")
        .pluck()
        .all();
      expect(objects).toEqual(
        expect.arrayContaining(['branches', 'branches_tenant_company_idx', 'companies', 'schema_migrations', 'sector_types']),
      );
      expect(database.prepare('SELECT version, name, checksum FROM schema_migrations').all()).toEqual([
        { checksum: migrationChecksum(MIGRATIONS[0] as Migration), name: 'create_companies_and_branches', version: 1 },
      ]);
    });

    it('keeps the sector catalogue aligned with SECTOR_TYPES', () => {
      const database = migratedDatabase();

      expect(database.prepare('SELECT code FROM sector_types').pluck().all()).toEqual(
        expect.arrayContaining([...SECTOR_TYPES]),
      );
      expect(database.prepare('SELECT count(*) FROM sector_types').pluck().get()).toBe(SECTOR_TYPES.length);
    });

    it('re-runs safely without touching existing data', async () => {
      const database = migratedDatabase();
      const company = newCompany();
      await createSqliteTenantPersistence(database).companies.create(contextFor(company.tenantId), company);

      expect(runMigrations(database)).toEqual({ applied: [], currentVersion: 1 });
      database.close();
      expect(runMigrations(temporary.open())).toEqual({ applied: [], currentVersion: 1 });

      const reopened = temporary.open();
      expect(count(reopened, 'schema_migrations')).toBe(1);
      expect(count(reopened, 'companies')).toBe(1);
    });

    it('refuses a database whose applied migration was altered', () => {
      const database = migratedDatabase();
      database.prepare("UPDATE schema_migrations SET checksum = 'alterado'").run();

      expectPersistenceError(() => runMigrations(database), 'migration-checksum-mismatch');
    });

    it('refuses a database created by a newer schema version', () => {
      const database = migratedDatabase();
      database
        .prepare("INSERT INTO schema_migrations VALUES (2, 'futura', 'x', '2026-12-01T00:00:00.000Z')")
        .run();

      expectPersistenceError(() => runMigrations(database), 'unknown-schema-version');
    });

    it('rolls back a failing migration entirely', () => {
      const database = migratedDatabase();
      const broken: Migration = {
        name: 'broken',
        sql: 'CREATE TABLE partial_table (id TEXT) STRICT; INSERT INTO missing_table VALUES (1);',
        version: 2,
      };

      expect(() => runMigrations(database, [...MIGRATIONS, broken])).toThrow(/missing_table/);

      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'partial_table'").get()).toBeUndefined();
      expect(count(database, 'schema_migrations')).toBe(1);
    });

    it('rejects a non-sequential migration list', () => {
      const database = temporary.open();
      const gap: Migration = { name: 'gap', sql: 'SELECT 1;', version: 3 };

      expectPersistenceError(() => runMigrations(database, [...MIGRATIONS, gap]), 'migration-sequence-invalid');
    });
  });

  describe('persistence across connections', () => {
    it('keeps companies and branches after closing and reopening the file', async () => {
      const first = migratedDatabase();
      const company = newCompany();
      const context = contextFor(company.tenantId);
      const branches = SECTOR_TYPES.map((sectorType) =>
        createBranch(branchInput(company, { code: sectorType, sectorType })),
      );
      const writer = createSqliteTenantPersistence(first);
      await writer.companies.create(context, company);
      for (const branch of branches) await writer.branches.create(context, branch);
      first.close();

      const reader = createSqliteTenantPersistence(temporary.open());

      await expect(reader.companies.findById(context, company.id)).resolves.toEqual(company);
      await expect(reader.branches.listByCompany(context, company.id)).resolves.toEqual(
        [...branches].sort((left, right) => (left.code < right.code ? -1 : 1)),
      );
      const outsider = contextFor(newCompany().tenantId);
      await expect(reader.companies.findById(outsider, company.id)).resolves.toBeUndefined();
      await expect(reader.branches.listByCompany(outsider, company.id)).resolves.toEqual([]);
    });
  });

  describe('database-level integrity', () => {
    it('ties every branch to a company of the same tenant', () => {
      const database = migratedDatabase();
      const companyId = newId();
      const tenantId = newId();
      insertCompanyRow(database, { id: companyId, tenant_id: tenantId });

      expect(() => insertBranchRow(database, { company_id: companyId, tenant_id: newId() })).toThrow(
        'FOREIGN KEY constraint failed',
      );
      expect(() => insertBranchRow(database, { company_id: newId(), tenant_id: tenantId })).toThrow(
        'FOREIGN KEY constraint failed',
      );
      insertBranchRow(database, { company_id: companyId, tenant_id: tenantId });
      expect(count(database, 'branches')).toBe(1);
    });

    it('blocks physical deletion of a company that has branches', () => {
      const database = migratedDatabase();
      const companyId = newId();
      const tenantId = newId();
      insertCompanyRow(database, { id: companyId, tenant_id: tenantId });
      insertBranchRow(database, { company_id: companyId, tenant_id: tenantId });

      expect(() => database.prepare('DELETE FROM companies WHERE id = ?').run(companyId)).toThrow(
        'FOREIGN KEY constraint failed',
      );
      expect(count(database, 'companies')).toBe(1);
    });

    it('enforces unique company identifiers and one company per tenant', () => {
      const database = migratedDatabase();
      const companyId = newId();
      const tenantId = newId();
      insertCompanyRow(database, { id: companyId, tenant_id: tenantId });

      expect(() => insertCompanyRow(database, { id: companyId })).toThrow('UNIQUE constraint failed: companies.id');
      expect(() => insertCompanyRow(database, { tenant_id: tenantId })).toThrow(
        'UNIQUE constraint failed: companies.tenant_id',
      );
    });

    it('enforces branch code uniqueness per company only', () => {
      const database = migratedDatabase();
      const first = { company_id: newId(), tenant_id: newId() };
      const second = { company_id: newId(), tenant_id: newId() };
      insertCompanyRow(database, { id: first.company_id, tenant_id: first.tenant_id });
      insertCompanyRow(database, { id: second.company_id, tenant_id: second.tenant_id });
      insertBranchRow(database, { ...first, code: 'LOJA-1' });

      expect(() => insertBranchRow(database, { ...first, code: 'LOJA-1' })).toThrow(
        'UNIQUE constraint failed: branches.company_id, branches.code',
      );
      insertBranchRow(database, { ...second, code: 'LOJA-1' });
      expect(count(database, 'branches')).toBe(2);
    });

    it.each([
      [{ status: 'DELETED' }, 'CHECK constraint failed'],
      [{ nif: null, status: 'ACTIVE' }, 'companies_active_requires_nif'],
      [{ jurisdiction: 'zz' }, 'CHECK constraint failed'],
      [{ legal_name: '   ' }, 'CHECK constraint failed'],
      [{ created_at: '2026-11-14T00:00:00.000Z' }, 'companies_chronology'],
    ] as const)('rejects the invalid company row %j', (values, message) => {
      const database = migratedDatabase();

      expect(() => insertCompanyRow(database, values)).toThrow(message);
    });

    it('rejects a company whose identifier equals its tenant (D-023)', () => {
      const database = migratedDatabase();
      const shared = newId();

      expect(() => insertCompanyRow(database, { id: shared, tenant_id: shared })).toThrow(
        'companies_id_distinct_from_tenant',
      );
    });

    it('accepts a draft company without NIF at database level (D-024)', () => {
      const database = migratedDatabase();

      insertCompanyRow(database, { nif: null, status: 'DRAFT' });

      expect(count(database, 'companies')).toBe(1);
    });

    it('rejects unknown sectors and lowercase codes', () => {
      const database = migratedDatabase();
      const owner = { company_id: newId(), tenant_id: newId() };
      insertCompanyRow(database, { id: owner.company_id, tenant_id: owner.tenant_id });

      expect(() => insertBranchRow(database, { ...owner, sector_type: 'CASINO' })).toThrow(
        'FOREIGN KEY constraint failed',
      );
      expect(() => insertBranchRow(database, { ...owner, code: 'loja-1' })).toThrow('CHECK constraint failed');
    });
  });

  describe('transactions', () => {
    it('commits related changes together', () => {
      const database = migratedDatabase();
      const persistence = createSqliteTenantPersistence(database);
      const company = newCompany();
      const context = contextFor(company.tenantId);

      persistence.transaction(({ branches, companies }) => {
        companies.create(context, company);
        branches.create(context, createBranch(branchInput(company, { code: 'SEDE' })));
        branches.create(context, createBranch(branchInput(company, { code: 'FILIAL' })));
      });

      expect(count(database, 'companies')).toBe(1);
      expect(count(database, 'branches')).toBe(2);
    });

    it('rolls back every change when the work throws', () => {
      const database = migratedDatabase();
      const persistence = createSqliteTenantPersistence(database);
      const company = newCompany();
      const context = contextFor(company.tenantId);

      expect(() =>
        persistence.transaction(({ branches, companies }) => {
          companies.create(context, company);
          branches.create(context, createBranch(branchInput(company)));
          throw new Error('falha simulada');
        }),
      ).toThrow('falha simulada');

      expect(count(database, 'companies')).toBe(0);
      expect(count(database, 'branches')).toBe(0);
    });

    it('rolls back earlier changes when a later operation breaks a rule', () => {
      const database = migratedDatabase();
      const persistence = createSqliteTenantPersistence(database);
      const company = newCompany();
      const context = contextFor(company.tenantId);

      expect(() =>
        persistence.transaction(({ branches, companies }) => {
          companies.create(context, company);
          branches.create(context, createBranch(branchInput(company, { code: 'SEDE' })));
          branches.create(context, createBranch(branchInput(company, { code: ' sede ' })));
        }),
      ).toThrow(RecordConflictError);

      expect(count(database, 'companies')).toBe(0);
      expect(count(database, 'branches')).toBe(0);
    });

    it('rejects asynchronous work and closes the stores afterwards', () => {
      const database = migratedDatabase();
      const persistence = createSqliteTenantPersistence(database);
      const company = newCompany();
      const context = contextFor(company.tenantId);
      let leaked: TenantStores | undefined;

      expectPersistenceError(
        () =>
          persistence.transaction((stores) => {
            leaked = stores;
            stores.companies.create(context, company);
            return Promise.resolve();
          }),
        'async-transaction',
      );

      expect(count(database, 'companies')).toBe(0);
      expectPersistenceError(() => leaked?.companies.create(context, company), 'transaction-closed');
      expect(count(database, 'companies')).toBe(0);
    });

    it('translates raw SQLite failures into PersistenceError', () => {
      const database = migratedDatabase();
      const persistence = createSqliteTenantPersistence(database);

      const action = (): unknown =>
        persistence.transaction(() =>
          database.prepare("INSERT INTO sector_types (code) VALUES ('PHARMACY')").run(),
        );

      expectPersistenceError(action, 'constraint');
      expect(database.prepare('SELECT count(*) FROM sector_types').pluck().get()).toBe(SECTOR_TYPES.length);
    });
  });

  describe('invalid data', () => {
    it('reports corrupted stored records instead of returning them', async () => {
      const database = migratedDatabase();
      const persistence = createSqliteTenantPersistence(database);
      const company = newCompany();
      const context = contextFor(company.tenantId);
      await persistence.companies.create(context, company);
      database.prepare("UPDATE companies SET jurisdiction = 'Z1' WHERE id = ?").run(company.id);

      await expect(persistence.companies.findById(context, company.id)).rejects.toMatchObject({
        name: 'PersistenceError',
        reason: 'invalid-stored-record',
      });
    });
  });

  describe('SQL injection', () => {
    const payloads = [
      "'); DROP TABLE companies; --",
      "' OR '1'='1",
      'x" OR 1=1 --',
      "Robert'); DELETE FROM branches WHERE ('1'='1",
    ];

    it('stores hostile text literally without altering the schema', async () => {
      const database = migratedDatabase();
      const persistence = createSqliteTenantPersistence(database);

      for (const payload of payloads) {
        const company = newCompany({ legalName: payload, tradeName: payload });
        const context = contextFor(company.tenantId);
        const branch = createBranch(branchInput(company, { code: payload, name: payload }));
        await persistence.companies.create(context, company);
        await persistence.branches.create(context, branch);

        await expect(persistence.companies.findById(context, company.id)).resolves.toMatchObject({
          legalName: payload,
        });
        await expect(persistence.branches.listByCompany(context, company.id)).resolves.toEqual([branch]);
      }

      expect(count(database, 'companies')).toBe(payloads.length);
      expect(count(database, 'branches')).toBe(payloads.length);
    });

    it('never matches other tenants through forged identifiers', async () => {
      const database = migratedDatabase();
      const persistence = createSqliteTenantPersistence(database);
      const victim = newCompany();
      await persistence.companies.create(contextFor(victim.tenantId), victim);
      const attacker: TenantContext = contextFor(newCompany().tenantId);

      for (const payload of payloads) {
        const forged = payload as CompanyId;
        await expect(persistence.companies.findById(attacker, forged)).resolves.toBeUndefined();
        await expect(persistence.branches.listByCompany(attacker, forged)).resolves.toEqual([]);
        await expect(persistence.companies.delete(attacker, forged)).rejects.toMatchObject({
          name: 'RecordNotFoundError',
        });
      }

      expect(count(database, 'companies')).toBe(1);
    });

    it('rejects hostile tenant identifiers before any query', async () => {
      const persistence = createSqliteTenantPersistence(migratedDatabase());
      const hostile = { actorId: 'user:x', correlationId: 'c-1', tenantId: "' OR '1'='1" };

      await expect(
        persistence.companies.findById(hostile as unknown as TenantContext, newId() as CompanyId),
      ).rejects.toMatchObject({ name: 'TenantContextError', reason: 'invalid' });
    });
  });

  describe('database location', () => {
    const options = { protectedDirectories: [repositoryRoot] };

    it('requires an explicit absolute location with a database extension', () => {
      expectPersistenceError(() => resolveDatabaseLocation(undefined, options), 'location-not-configured');
      expectPersistenceError(() => resolveDatabaseLocation('  ', options), 'location-not-configured');
      expectPersistenceError(
        () => resolveDatabaseLocation('data/kil-business.sqlite', options),
        'location-not-absolute',
      );
      expectPersistenceError(
        () => resolveDatabaseLocation(path.join(temporary.directory, 'base.txt'), options),
        'location-invalid-extension',
      );
    });

    it('refuses locations inside protected directories such as the repository', () => {
      const inside = path.join(repositoryRoot, 'data', 'kil-business.sqlite');
      const build = path.join(repositoryRoot, 'apps', 'desktop', 'dist', 'kil.db');

      expectPersistenceError(() => resolveDatabaseLocation(inside, options), 'location-inside-protected-directory');
      expectPersistenceError(() => resolveDatabaseLocation(build, options), 'location-inside-protected-directory');
    });

    it('accepts a location outside the protected directories', () => {
      const outside = path.join(temporary.directory, 'kil-business.sqlite');

      expect(resolveDatabaseLocation(outside, options)).toBe(path.resolve(outside));
    });
  });
});
