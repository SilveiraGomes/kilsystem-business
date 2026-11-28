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
} from '../../packages/shared-types/src/index';
import type { TenantRepositoryHarness } from './tenant-repository-contract';

/*
 * Implementação em memória EXCLUSIVA PARA TESTES. Não é persistência real, não sobrevive ao
 * processo e não deve ser importada por código de produção. Serve de referência executável
 * da suite de contrato, ao lado da implementação SQLite de `packages/database`.
 */

// Converte excepções síncronas em promessas rejeitadas, como numa implementação assíncrona real.
const settle = <T>(operation: () => T): Promise<T> =>
  new Promise<T>((resolve) => {
    resolve(operation());
  });

export const createInMemoryTenantRepositories = (): TenantRepositoryHarness => {
  const companies = new Map<CompanyId, Company>();
  const branches = new Map<BranchId, Branch>();

  const companyInTenant = (context: TenantContext, id: CompanyId): Company | undefined => {
    const company = companies.get(id);
    return company?.tenantId === context.tenantId ? company : undefined;
  };

  const branchInTenant = (context: TenantContext, id: BranchId): Branch | undefined => {
    const branch = branches.get(id);
    return branch?.tenantId === context.tenantId ? branch : undefined;
  };

  const assertBranchWritable = (context: TenantContext, branch: Branch): void => {
    if (!companyInTenant(context, branch.companyId)) throw new RecordNotFoundError('Company');
    const codeTaken = [...branches.values()].some(
      (existing) =>
        existing.companyId === branch.companyId && existing.code === branch.code && existing.id !== branch.id,
    );
    if (codeTaken) throw new RecordConflictError('duplicate-branch-code');
  };

  const companyRepository: CompanyRepository = {
    findById: (context, id) =>
      settle(() => {
        assertTenantContext(context);
        return companyInTenant(context, id);
      }),
    create: (context, candidate) =>
      settle(() => {
        assertTenantContext(context);
        const company = restoreCompany(candidate);
        assertSameTenant(context, company);
        if (companies.has(company.id)) throw new RecordConflictError('duplicate-id');
        if ([...companies.values()].some((existing) => existing.tenantId === context.tenantId)) {
          throw new RecordConflictError('tenant-already-has-company');
        }
        companies.set(company.id, company);
      }),
    update: (context, candidate) =>
      settle(() => {
        assertTenantContext(context);
        const company = restoreCompany(candidate);
        assertSameTenant(context, company);
        const current = companyInTenant(context, company.id);
        if (!current) throw new RecordNotFoundError('Company');
        if (current.createdAt !== company.createdAt) throw new RecordConflictError('immutable-field');
        companies.set(company.id, company);
      }),
  };

  const branchRepository: BranchRepository = {
    findById: (context, id) =>
      settle(() => {
        assertTenantContext(context);
        return branchInTenant(context, id);
      }),
    listByCompany: (context, companyId) =>
      settle(() => {
        assertTenantContext(context);
        return [...branches.values()]
          .filter((branch) => branch.tenantId === context.tenantId && branch.companyId === companyId)
          .sort((left, right) => (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
      }),
    create: (context, candidate) =>
      settle(() => {
        assertTenantContext(context);
        const branch = createBranch(candidate);
        assertSameTenant(context, branch);
        assertBranchWritable(context, branch);
        if (branches.has(branch.id)) throw new RecordConflictError('duplicate-id');
        branches.set(branch.id, branch);
      }),
    update: (context, candidate) =>
      settle(() => {
        assertTenantContext(context);
        const branch = createBranch(candidate);
        assertSameTenant(context, branch);
        const current = branchInTenant(context, branch.id);
        if (!current) throw new RecordNotFoundError('Branch');
        assertBranchWritable(context, branch);
        if (current.createdAt !== branch.createdAt || current.sectorType !== branch.sectorType) {
          throw new RecordConflictError('immutable-field');
        }
        branches.set(branch.id, branch);
      }),
  };

  return { branches: branchRepository, companies: companyRepository };
};
