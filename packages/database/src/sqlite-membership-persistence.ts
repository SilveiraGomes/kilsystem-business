import type Database from 'better-sqlite3';

import {
  assertSameTenant,
  assertTenantContext,
  createBranchMembership,
  createCompanyMembership,
  evaluateMembershipScope,
  ineligibleMembershipScope,
  RecordConflictError,
  RecordNotFoundError,
  type BranchMembership,
  type BranchMembershipId,
  type BranchMembershipRepository,
  type CompanyId,
  type CompanyMembership,
  type CompanyMembershipId,
  type CompanyMembershipRepository,
  type MembershipScopeEvaluation,
  type MembershipScopeReader,
  type TenantContext,
  type UserId,
} from '@kil-business/shared-types';

import type { SqliteDatabase } from './connection.js';
import { PersistenceError } from './errors.js';
import {
  BRANCH_COLUMNS,
  BRANCH_MEMBERSHIP_COLUMNS,
  COMPANY_COLUMNS,
  COMPANY_MEMBERSHIP_COLUMNS,
  toBranch,
  toBranchMembership,
  toCompany,
  toCompanyMembership,
  toUser,
  USER_COLUMNS,
} from './sqlite-rows.js';
import { isPromiseLike, prepareAll, settle, translated } from './sqlite-support.js';

/** Versões síncronas dos repositórios de associações, disponíveis apenas dentro de `transaction`. */
export interface CompanyMembershipStore {
  findById(context: TenantContext, id: CompanyMembershipId): CompanyMembership | undefined;
  findByUser(context: TenantContext, userId: UserId): CompanyMembership | undefined;
  listByCompany(context: TenantContext, companyId: CompanyId): readonly CompanyMembership[];
  create(context: TenantContext, membership: CompanyMembership): void;
  update(context: TenantContext, membership: CompanyMembership): void;
}

export interface BranchMembershipStore {
  findById(context: TenantContext, id: BranchMembershipId): BranchMembership | undefined;
  listByCompanyMembership(context: TenantContext, companyMembershipId: CompanyMembershipId): readonly BranchMembership[];
  create(context: TenantContext, membership: BranchMembership): void;
  update(context: TenantContext, membership: BranchMembership): void;
}

export interface MembershipStores {
  readonly companyMemberships: CompanyMembershipStore;
  readonly branchMemberships: BranchMembershipStore;
}

export interface SqliteMembershipPersistence {
  readonly companyMemberships: CompanyMembershipRepository;
  readonly branchMemberships: BranchMembershipRepository;
  readonly scopes: MembershipScopeReader;
  /**
   * Alterações relacionadas numa única transacção: qualquer excepção reverte todas. `work` tem de
   * ser síncrono; os `stores` deixam de funcionar quando a transacção termina.
   */
  readonly transaction: <T>(work: (stores: MembershipStores) => T) => T;
}

// Todas as consultas filtram por `tenant_id`. São globais apenas a verificação de chave primária
// (UUID globais) e a existência da identidade referida, que não devolve dados pessoais.
const SQL = {
  companyInTenant: 'SELECT 1 FROM companies WHERE tenant_id = @tenantId AND id = @companyId',
  companyById: `SELECT ${COMPANY_COLUMNS} FROM companies WHERE tenant_id = @tenantId AND id = @companyId`,
  branchInCompany: `SELECT 1 FROM branches
    WHERE tenant_id = @tenantId AND company_id = @companyId AND id = @branchId`,
  branchesByCompany: `SELECT ${BRANCH_COLUMNS} FROM branches
    WHERE tenant_id = @tenantId AND company_id = @companyId ORDER BY code`,
  userExists: 'SELECT 1 FROM users WHERE id = ?',
  memberUser: `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
  companyMembershipById: `SELECT ${COMPANY_MEMBERSHIP_COLUMNS} FROM company_memberships
    WHERE tenant_id = @tenantId AND id = @id`,
  companyMembershipByUser: `SELECT ${COMPANY_MEMBERSHIP_COLUMNS} FROM company_memberships
    WHERE tenant_id = @tenantId AND user_id = @userId`,
  companyMembershipsByCompany: `SELECT ${COMPANY_MEMBERSHIP_COLUMNS} FROM company_memberships
    WHERE tenant_id = @tenantId AND company_id = @companyId ORDER BY created_at, id`,
  companyMembershipIdExists: 'SELECT 1 FROM company_memberships WHERE id = ?',
  insertCompanyMembership: `INSERT INTO company_memberships
    (id, user_id, tenant_id, company_id, scope, status, created_at, updated_at)
    VALUES (@id, @userId, @tenantId, @companyId, @scope, @status, @createdAt, @updatedAt)`,
  updateCompanyMembership: `UPDATE company_memberships SET scope = @scope, status = @status, updated_at = @updatedAt
    WHERE tenant_id = @tenantId AND id = @id`,
  branchMembershipById: `SELECT ${BRANCH_MEMBERSHIP_COLUMNS} FROM branch_memberships
    WHERE tenant_id = @tenantId AND id = @id`,
  branchMembershipsByCompanyMembership: `SELECT ${BRANCH_MEMBERSHIP_COLUMNS} FROM branch_memberships
    WHERE tenant_id = @tenantId AND company_membership_id = @companyMembershipId ORDER BY created_at, id`,
  branchMembershipIdExists: 'SELECT 1 FROM branch_memberships WHERE id = ?',
  branchMembershipTaken: `SELECT 1 FROM branch_memberships
    WHERE tenant_id = @tenantId AND company_membership_id = @companyMembershipId AND branch_id = @branchId`,
  insertBranchMembership: `INSERT INTO branch_memberships
    (id, company_membership_id, tenant_id, company_id, branch_id, status, created_at, updated_at)
    VALUES (@id, @companyMembershipId, @tenantId, @companyId, @branchId, @status, @createdAt, @updatedAt)`,
  updateBranchMembership: `UPDATE branch_memberships SET status = @status, updated_at = @updatedAt
    WHERE tenant_id = @tenantId AND id = @id`,
} as const;

const companyMembershipParameters = (membership: CompanyMembership): Record<string, string> => ({
  companyId: membership.companyId,
  createdAt: membership.createdAt,
  id: membership.id,
  scope: membership.scope,
  status: membership.status,
  tenantId: membership.tenantId,
  updatedAt: membership.updatedAt,
  userId: membership.userId,
});

const branchMembershipParameters = (membership: BranchMembership): Record<string, string> => ({
  branchId: membership.branchId,
  companyId: membership.companyId,
  companyMembershipId: membership.companyMembershipId,
  createdAt: membership.createdAt,
  id: membership.id,
  status: membership.status,
  tenantId: membership.tenantId,
  updatedAt: membership.updatedAt,
});

/**
 * Associações de utilizadores a empresas e estabelecimentos sobre SQLite (E1.07-A). Seguem a
 * semântica de isolamento de D-020 e não expõem dados pessoais das identidades (D-087).
 */
export const createSqliteMembershipPersistence = (database: SqliteDatabase): SqliteMembershipPersistence => {
  const statements: Record<keyof typeof SQL, Database.Statement> = prepareAll(database, SQL);

  const companyMembershipInTenant = (context: TenantContext, id: CompanyMembershipId): CompanyMembership | undefined => {
    const row: unknown = statements.companyMembershipById.get({ id, tenantId: context.tenantId });
    return row === undefined ? undefined : toCompanyMembership(row);
  };

  const companyMembershipOfUser = (context: TenantContext, userId: UserId): CompanyMembership | undefined => {
    const row: unknown = statements.companyMembershipByUser.get({ tenantId: context.tenantId, userId });
    return row === undefined ? undefined : toCompanyMembership(row);
  };

  const branchMembershipInTenant = (context: TenantContext, id: BranchMembershipId): BranchMembership | undefined => {
    const row: unknown = statements.branchMembershipById.get({ id, tenantId: context.tenantId });
    return row === undefined ? undefined : toBranchMembership(row);
  };

  const branchMembershipsOf = (
    context: TenantContext,
    companyMembershipId: CompanyMembershipId,
  ): readonly BranchMembership[] =>
    statements.branchMembershipsByCompanyMembership
      .all({ companyMembershipId, tenantId: context.tenantId })
      .map((row) => toBranchMembership(row));

  const createStores = (assertOpen: () => void): MembershipStores => {
    const guard = (context: TenantContext): void => {
      assertOpen();
      assertTenantContext(context);
    };

    const companyMemberships: CompanyMembershipStore = {
      findById: (context, id) => {
        guard(context);
        return companyMembershipInTenant(context, id);
      },
      findByUser: (context, userId) => {
        guard(context);
        return companyMembershipOfUser(context, userId);
      },
      listByCompany: (context, companyId) => {
        guard(context);
        return statements.companyMembershipsByCompany
          .all({ companyId, tenantId: context.tenantId })
          .map((row) => toCompanyMembership(row));
      },
      create: (context, candidate) => {
        guard(context);
        const membership = createCompanyMembership(candidate);
        assertSameTenant(context, membership);
        const company = { companyId: membership.companyId, tenantId: context.tenantId };
        if (statements.companyInTenant.get(company) === undefined) throw new RecordNotFoundError('Company');
        if (statements.userExists.get(membership.userId) === undefined) throw new RecordNotFoundError('User');
        if (statements.companyMembershipIdExists.get(membership.id) !== undefined) {
          throw new RecordConflictError('duplicate-id');
        }
        if (companyMembershipOfUser(context, membership.userId) !== undefined) {
          throw new RecordConflictError('duplicate-company-membership');
        }
        statements.insertCompanyMembership.run(companyMembershipParameters(membership));
      },
      update: (context, candidate) => {
        guard(context);
        const membership = createCompanyMembership(candidate);
        assertSameTenant(context, membership);
        const current = companyMembershipInTenant(context, membership.id);
        if (current === undefined) throw new RecordNotFoundError('CompanyMembership');
        if (
          current.userId !== membership.userId ||
          current.companyId !== membership.companyId ||
          current.createdAt !== membership.createdAt
        ) {
          throw new RecordConflictError('immutable-field');
        }
        const result = statements.updateCompanyMembership.run(companyMembershipParameters(membership));
        if (result.changes !== 1) throw new RecordNotFoundError('CompanyMembership');
      },
    };

    const branchMemberships: BranchMembershipStore = {
      findById: (context, id) => {
        guard(context);
        return branchMembershipInTenant(context, id);
      },
      listByCompanyMembership: (context, companyMembershipId) => {
        guard(context);
        return branchMembershipsOf(context, companyMembershipId);
      },
      create: (context, candidate) => {
        guard(context);
        const membership = createBranchMembership(candidate);
        assertSameTenant(context, membership);
        const parent = companyMembershipInTenant(context, membership.companyMembershipId);
        if (parent === undefined || parent.companyId !== membership.companyId) {
          throw new RecordNotFoundError('CompanyMembership');
        }
        if (parent.scope !== 'BRANCH_RESTRICTED') throw new RecordConflictError('membership-not-branch-restricted');
        const branch = { branchId: membership.branchId, companyId: membership.companyId, tenantId: context.tenantId };
        if (statements.branchInCompany.get(branch) === undefined) throw new RecordNotFoundError('Branch');
        if (statements.branchMembershipIdExists.get(membership.id) !== undefined) {
          throw new RecordConflictError('duplicate-id');
        }
        const taken = statements.branchMembershipTaken.get({
          branchId: membership.branchId,
          companyMembershipId: membership.companyMembershipId,
          tenantId: context.tenantId,
        });
        if (taken !== undefined) throw new RecordConflictError('duplicate-branch-membership');
        statements.insertBranchMembership.run(branchMembershipParameters(membership));
      },
      update: (context, candidate) => {
        guard(context);
        const membership = createBranchMembership(candidate);
        assertSameTenant(context, membership);
        const current = branchMembershipInTenant(context, membership.id);
        if (current === undefined) throw new RecordNotFoundError('BranchMembership');
        if (
          current.companyMembershipId !== membership.companyMembershipId ||
          current.companyId !== membership.companyId ||
          current.branchId !== membership.branchId ||
          current.createdAt !== membership.createdAt
        ) {
          throw new RecordConflictError('immutable-field');
        }
        const result = statements.updateBranchMembership.run(branchMembershipParameters(membership));
        if (result.changes !== 1) throw new RecordNotFoundError('BranchMembership');
      },
    };

    return { branchMemberships, companyMemberships };
  };

  // Leitura consistente: todos os factos da avaliação vêm da mesma transacção.
  const evaluate = (context: TenantContext, userId: UserId): MembershipScopeEvaluation => {
    assertTenantContext(context);
    return database.transaction((): MembershipScopeEvaluation => {
      const membership = companyMembershipOfUser(context, userId);
      if (membership === undefined) return ineligibleMembershipScope('no-membership');
      const company = { companyId: membership.companyId, tenantId: context.tenantId };
      const companyRow: unknown = statements.companyById.get(company);
      const userRow: unknown = statements.memberUser.get(membership.userId);
      // A integridade referencial garante ambos; a ausência indica uma base corrompida.
      if (companyRow === undefined || userRow === undefined) throw new PersistenceError('invalid-stored-record');
      return evaluateMembershipScope({
        branchMemberships: branchMembershipsOf(context, membership.id),
        branches: statements.branchesByCompany.all(company).map((row) => toBranch(row)),
        company: toCompany(companyRow),
        membership,
        user: toUser(userRow),
      });
    })();
  };

  const alwaysOpen = (): void => undefined;
  const shared = createStores(alwaysOpen);
  const immediate = <T>(operation: () => T): Promise<T> =>
    settle(() => database.transaction(operation).immediate());

  const companyMemberships: CompanyMembershipRepository = {
    findById: (context, id) => settle(() => shared.companyMemberships.findById(context, id)),
    findByUser: (context, userId) => settle(() => shared.companyMemberships.findByUser(context, userId)),
    listByCompany: (context, companyId) => settle(() => shared.companyMemberships.listByCompany(context, companyId)),
    create: (context, membership) => immediate(() => shared.companyMemberships.create(context, membership)),
    update: (context, membership) => immediate(() => shared.companyMemberships.update(context, membership)),
  };

  const branchMemberships: BranchMembershipRepository = {
    findById: (context, id) => settle(() => shared.branchMemberships.findById(context, id)),
    listByCompanyMembership: (context, companyMembershipId) =>
      settle(() => shared.branchMemberships.listByCompanyMembership(context, companyMembershipId)),
    create: (context, membership) => immediate(() => shared.branchMemberships.create(context, membership)),
    update: (context, membership) => immediate(() => shared.branchMemberships.update(context, membership)),
  };

  const scopes: MembershipScopeReader = {
    evaluate: (context, userId) => settle(() => evaluate(context, userId)),
  };

  const transaction = <T>(work: (stores: MembershipStores) => T): T => {
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

  return { branchMemberships, companyMemberships, scopes, transaction };
};
