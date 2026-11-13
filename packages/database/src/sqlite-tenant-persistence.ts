import Database from 'better-sqlite3';

import {
  assertSameTenant,
  assertTenantContext,
  createBranch,
  DomainValidationError,
  RecordConflictError,
  RecordNotFoundError,
  restoreCompany,
  TenantContextError,
  TenantMismatchError,
  type Branch,
  type BranchId,
  type BranchInput,
  type BranchRepository,
  type Company,
  type CompanyId,
  type CompanyInput,
  type CompanyRepository,
  type TenantContext,
} from '@kil-business/shared-types';

import type { SqliteDatabase } from './connection.js';
import { PersistenceError } from './errors.js';

/** Versões síncronas dos repositórios, disponíveis apenas dentro de `transaction`. */
export interface CompanyStore {
  findById(context: TenantContext, id: CompanyId): Company | undefined;
  create(context: TenantContext, company: Company): void;
  update(context: TenantContext, company: Company): void;
  delete(context: TenantContext, id: CompanyId): void;
}

export interface BranchStore {
  findById(context: TenantContext, id: BranchId): Branch | undefined;
  listByCompany(context: TenantContext, companyId: CompanyId): readonly Branch[];
  create(context: TenantContext, branch: Branch): void;
  update(context: TenantContext, branch: Branch): void;
  delete(context: TenantContext, id: BranchId): void;
}

export interface TenantStores {
  readonly companies: CompanyStore;
  readonly branches: BranchStore;
}

export interface SqliteTenantPersistence {
  readonly companies: CompanyRepository;
  readonly branches: BranchRepository;
  /**
   * Executa alterações relacionadas numa única transacção: qualquer excepção reverte todas.
   * `work` tem de ser síncrono; os `stores` deixam de funcionar quando a transacção termina.
   */
  readonly transaction: <T>(work: (stores: TenantStores) => T) => T;
}

const COMPANY_COLUMNS = `id, tenant_id AS tenantId, jurisdiction, legal_name AS legalName,
  trade_name AS tradeName, nif, status, created_at AS createdAt, updated_at AS updatedAt`;

const BRANCH_COLUMNS = `id, tenant_id AS tenantId, company_id AS companyId, name, code,
  sector_type AS sectorType, status, created_at AS createdAt, updated_at AS updatedAt`;

// Todas as consultas a dados empresariais filtram por `tenant_id`; apenas as verificações de
// unicidade de chave primária são globais, porque os identificadores são UUID globais.
const SQL = {
  companyById: `SELECT ${COMPANY_COLUMNS} FROM companies WHERE tenant_id = @tenantId AND id = @id`,
  companyIdExists: 'SELECT 1 FROM companies WHERE id = ?',
  tenantHasCompany: 'SELECT 1 FROM companies WHERE tenant_id = ?',
  insertCompany: `INSERT INTO companies
    (id, tenant_id, jurisdiction, legal_name, trade_name, nif, status, created_at, updated_at)
    VALUES (@id, @tenantId, @jurisdiction, @legalName, @tradeName, @nif, @status, @createdAt, @updatedAt)`,
  updateCompany: `UPDATE companies SET jurisdiction = @jurisdiction, legal_name = @legalName,
    trade_name = @tradeName, nif = @nif, status = @status, updated_at = @updatedAt
    WHERE tenant_id = @tenantId AND id = @id`,
  deleteCompany: 'DELETE FROM companies WHERE tenant_id = @tenantId AND id = @id',
  companyHasBranches: 'SELECT 1 FROM branches WHERE tenant_id = @tenantId AND company_id = @companyId LIMIT 1',
  branchById: `SELECT ${BRANCH_COLUMNS} FROM branches WHERE tenant_id = @tenantId AND id = @id`,
  branchIdExists: 'SELECT 1 FROM branches WHERE id = ?',
  branchesByCompany: `SELECT ${BRANCH_COLUMNS} FROM branches
    WHERE tenant_id = @tenantId AND company_id = @companyId ORDER BY code`,
  branchCodeTaken: `SELECT 1 FROM branches
    WHERE tenant_id = @tenantId AND company_id = @companyId AND code = @code AND id <> @id`,
  insertBranch: `INSERT INTO branches
    (id, tenant_id, company_id, name, code, sector_type, status, created_at, updated_at)
    VALUES (@id, @tenantId, @companyId, @name, @code, @sectorType, @status, @createdAt, @updatedAt)`,
  updateBranch: `UPDATE branches SET name = @name, code = @code, sector_type = @sectorType,
    status = @status, updated_at = @updatedAt
    WHERE tenant_id = @tenantId AND id = @id AND company_id = @companyId`,
  deleteBranch: 'DELETE FROM branches WHERE tenant_id = @tenantId AND id = @id',
} as const;

const DOMAIN_ERRORS = [
  DomainValidationError,
  PersistenceError,
  RecordConflictError,
  RecordNotFoundError,
  TenantContextError,
  TenantMismatchError,
] as const;

const translateError = (error: unknown): unknown => {
  if (DOMAIN_ERRORS.some((type) => error instanceof type)) return error;
  if (error instanceof Database.SqliteError) {
    return new PersistenceError(error.code.startsWith('SQLITE_CONSTRAINT') ? 'constraint' : 'sqlite', {
      cause: error,
    });
  }
  return error;
};

const translated = <T>(operation: () => T): T => {
  try {
    return operation();
  } catch (error) {
    throw translateError(error);
  }
};

// Converte excepções síncronas em promessas rejeitadas, mantendo o contrato assíncrono.
const settle = <T>(operation: () => T): Promise<T> =>
  new Promise<T>((resolve) => {
    resolve(translated(operation));
  });

const isPromiseLike = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';

const readRow = (row: unknown): Record<string, unknown> => {
  if (typeof row !== 'object' || row === null) throw new PersistenceError('invalid-stored-record');
  return row as Record<string, unknown>;
};

const text = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new PersistenceError('invalid-stored-record');
  return value;
};

const optionalText = (row: Record<string, unknown>, key: string): string | undefined =>
  row[key] === null ? undefined : text(row, key);

const restoreStored = <T>(restore: () => T): T => {
  try {
    return restore();
  } catch (error) {
    throw new PersistenceError('invalid-stored-record', { cause: error });
  }
};

const toCompany = (value: unknown): Company => {
  const row = readRow(value);
  const input: CompanyInput = {
    createdAt: text(row, 'createdAt'),
    id: text(row, 'id'),
    jurisdiction: text(row, 'jurisdiction'),
    legalName: text(row, 'legalName'),
    nif: optionalText(row, 'nif'),
    status: text(row, 'status'),
    tenantId: text(row, 'tenantId'),
    tradeName: optionalText(row, 'tradeName'),
    updatedAt: text(row, 'updatedAt'),
  };
  return restoreStored(() => restoreCompany(input));
};

const toBranch = (value: unknown): Branch => {
  const row = readRow(value);
  const input: BranchInput = {
    code: text(row, 'code'),
    companyId: text(row, 'companyId'),
    createdAt: text(row, 'createdAt'),
    id: text(row, 'id'),
    name: text(row, 'name'),
    sectorType: text(row, 'sectorType'),
    status: text(row, 'status'),
    tenantId: text(row, 'tenantId'),
    updatedAt: text(row, 'updatedAt'),
  };
  return restoreStored(() => createBranch(input));
};

const companyParameters = (company: Company): Record<string, string | null> => ({
  createdAt: company.createdAt,
  id: company.id,
  jurisdiction: company.jurisdiction,
  legalName: company.legalName,
  nif: company.nif ?? null,
  status: company.status,
  tenantId: company.tenantId,
  tradeName: company.tradeName ?? null,
  updatedAt: company.updatedAt,
});

const branchParameters = (branch: Branch): Record<string, string> => ({
  code: branch.code,
  companyId: branch.companyId,
  createdAt: branch.createdAt,
  id: branch.id,
  name: branch.name,
  sectorType: branch.sectorType,
  status: branch.status,
  tenantId: branch.tenantId,
  updatedAt: branch.updatedAt,
});

/**
 * Repositórios multiempresa sobre SQLite (E1.04). Implementam os contratos de
 * `@kil-business/shared-types` e devem passar a suite de contrato (D-021).
 */
export const createSqliteTenantPersistence = (database: SqliteDatabase): SqliteTenantPersistence => {
  const statements = Object.fromEntries(
    Object.entries(SQL).map(([key, sql]) => [key, database.prepare(sql)]),
  ) as Record<keyof typeof SQL, Database.Statement>;

  const createStores = (assertOpen: () => void): TenantStores => {
    const companyInTenant = (context: TenantContext, id: CompanyId): Company | undefined => {
      const row: unknown = statements.companyById.get({ id, tenantId: context.tenantId });
      return row === undefined ? undefined : toCompany(row);
    };

    const branchInTenant = (context: TenantContext, id: BranchId): Branch | undefined => {
      const row: unknown = statements.branchById.get({ id, tenantId: context.tenantId });
      return row === undefined ? undefined : toBranch(row);
    };

    const guard = (context: TenantContext): void => {
      assertOpen();
      assertTenantContext(context);
    };

    const assertBranchWritable = (context: TenantContext, branch: Branch): void => {
      if (!companyInTenant(context, branch.companyId)) throw new RecordNotFoundError('Company');
      const codeTaken = statements.branchCodeTaken.get({
        code: branch.code,
        companyId: branch.companyId,
        id: branch.id,
        tenantId: context.tenantId,
      });
      if (codeTaken !== undefined) throw new RecordConflictError('duplicate-branch-code');
    };

    const companies: CompanyStore = {
      findById: (context, id) => {
        guard(context);
        return companyInTenant(context, id);
      },
      create: (context, candidate) => {
        guard(context);
        const company = restoreCompany(candidate);
        assertSameTenant(context, company);
        if (statements.companyIdExists.get(company.id) !== undefined) {
          throw new RecordConflictError('duplicate-id');
        }
        if (statements.tenantHasCompany.get(context.tenantId) !== undefined) {
          throw new RecordConflictError('tenant-already-has-company');
        }
        statements.insertCompany.run(companyParameters(company));
      },
      update: (context, candidate) => {
        guard(context);
        const company = restoreCompany(candidate);
        assertSameTenant(context, company);
        const current = companyInTenant(context, company.id);
        if (!current) throw new RecordNotFoundError('Company');
        if (current.createdAt !== company.createdAt) throw new RecordConflictError('immutable-field');
        statements.updateCompany.run(companyParameters(company));
      },
      delete: (context, id) => {
        guard(context);
        if (!companyInTenant(context, id)) throw new RecordNotFoundError('Company');
        if (statements.companyHasBranches.get({ companyId: id, tenantId: context.tenantId }) !== undefined) {
          throw new RecordConflictError('company-has-branches');
        }
        statements.deleteCompany.run({ id, tenantId: context.tenantId });
      },
    };

    const branches: BranchStore = {
      findById: (context, id) => {
        guard(context);
        return branchInTenant(context, id);
      },
      listByCompany: (context, companyId) => {
        guard(context);
        return statements.branchesByCompany
          .all({ companyId, tenantId: context.tenantId })
          .map((row) => toBranch(row));
      },
      create: (context, candidate) => {
        guard(context);
        const branch = createBranch(candidate);
        assertSameTenant(context, branch);
        assertBranchWritable(context, branch);
        if (statements.branchIdExists.get(branch.id) !== undefined) {
          throw new RecordConflictError('duplicate-id');
        }
        statements.insertBranch.run(branchParameters(branch));
      },
      update: (context, candidate) => {
        guard(context);
        const branch = createBranch(candidate);
        assertSameTenant(context, branch);
        const current = branchInTenant(context, branch.id);
        if (!current) throw new RecordNotFoundError('Branch');
        assertBranchWritable(context, branch);
        if (current.createdAt !== branch.createdAt) throw new RecordConflictError('immutable-field');
        const result = statements.updateBranch.run(branchParameters(branch));
        if (result.changes !== 1) throw new RecordNotFoundError('Branch');
      },
      delete: (context, id) => {
        guard(context);
        if (!branchInTenant(context, id)) throw new RecordNotFoundError('Branch');
        statements.deleteBranch.run({ id, tenantId: context.tenantId });
      },
    };

    return { branches, companies };
  };

  const alwaysOpen = (): void => undefined;
  const shared = createStores(alwaysOpen);
  const immediate = <T>(operation: () => T): Promise<T> =>
    settle(() => database.transaction(operation).immediate());

  const companies: CompanyRepository = {
    findById: (context, id) => settle(() => shared.companies.findById(context, id)),
    create: (context, company) => immediate(() => shared.companies.create(context, company)),
    update: (context, company) => immediate(() => shared.companies.update(context, company)),
    delete: (context, id) => immediate(() => shared.companies.delete(context, id)),
  };

  const branches: BranchRepository = {
    findById: (context, id) => settle(() => shared.branches.findById(context, id)),
    listByCompany: (context, companyId) => settle(() => shared.branches.listByCompany(context, companyId)),
    create: (context, branch) => immediate(() => shared.branches.create(context, branch)),
    update: (context, branch) => immediate(() => shared.branches.update(context, branch)),
    delete: (context, id) => immediate(() => shared.branches.delete(context, id)),
  };

  const transaction = <T>(work: (stores: TenantStores) => T): T => {
    let open = true;
    const stores = createStores(() => {
      if (!open) throw new PersistenceError('transaction-closed');
    });
    try {
      return translated(() =>
        database
          .transaction(() => {
            const result = work(stores);
            if (isPromiseLike(result)) throw new PersistenceError('async-transaction');
            return result;
          })
          .immediate(),
      );
    } finally {
      open = false;
    }
  };

  return { branches, companies, transaction };
};
