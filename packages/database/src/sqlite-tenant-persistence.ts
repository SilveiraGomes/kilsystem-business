import type Database from 'better-sqlite3';

import {
  assertSameTenant,
  assertTenantContext,
  createBranch,
  RecordConflictError,
  RecordNotFoundError,
  restoreCompany,
  type Branch,
  type BranchId,
  type BranchRepository,
  type Company,
  type CompanyId,
  type CompanyRepository,
  type TenantContext,
} from '@kil-business/shared-types';

import type { SqliteDatabase } from './connection.js';
import { PersistenceError } from './errors.js';
import { BRANCH_COLUMNS, COMPANY_COLUMNS, toBranch, toCompany } from './sqlite-rows.js';
import { isPromiseLike, prepareAll, settle, translated } from './sqlite-support.js';

/** Versões síncronas dos repositórios, disponíveis apenas dentro de `transaction`. */
export interface CompanyStore {
  findById(context: TenantContext, id: CompanyId): Company | undefined;
  create(context: TenantContext, company: Company): void;
  update(context: TenantContext, company: Company): void;
}

export interface BranchStore {
  findById(context: TenantContext, id: BranchId): Branch | undefined;
  listByCompany(context: TenantContext, companyId: CompanyId): readonly Branch[];
  create(context: TenantContext, branch: Branch): void;
  update(context: TenantContext, branch: Branch): void;
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
} as const;

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
  const statements: Record<keyof typeof SQL, Database.Statement> = prepareAll(database, SQL);

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
        if (current.createdAt !== branch.createdAt || current.sectorType !== branch.sectorType) {
          throw new RecordConflictError('immutable-field');
        }
        const result = statements.updateBranch.run(branchParameters(branch));
        if (result.changes !== 1) throw new RecordNotFoundError('Branch');
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
  };

  const branches: BranchRepository = {
    findById: (context, id) => settle(() => shared.branches.findById(context, id)),
    listByCompany: (context, companyId) => settle(() => shared.branches.listByCompany(context, companyId)),
    create: (context, branch) => immediate(() => shared.branches.create(context, branch)),
    update: (context, branch) => immediate(() => shared.branches.update(context, branch)),
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
