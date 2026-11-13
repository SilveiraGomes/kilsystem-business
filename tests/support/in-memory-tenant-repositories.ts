import {
  assertSameTenant,
  assertTenantContext,
  RecordConflictError,
  RecordNotFoundError,
  type Branch,
  type BranchId,
  type BranchRepository,
  type Company,
  type CompanyId,
  type CompanyRepository,
  type TenantContext,
} from '../../packages/shared-types/src/index';
import type { TenantRepositories } from './tenant-repository-contract';

/*
 * Implementação em memória EXCLUSIVA PARA TESTES. Não é persistência real, não sobrevive ao
 * processo e não deve ser importada por código de produção. Serve para exercitar os contratos
 * de `packages/shared-types` até existir a implementação SQLite (E1.04).
 */

// Converte excepções síncronas em promessas rejeitadas, como numa implementação assíncrona real.
const settle = <T>(operation: () => T): Promise<T> =>
  new Promise<T>((resolve) => {
    resolve(operation());
  });

export const createInMemoryTenantRepositories = (): TenantRepositories => {
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

  const companyRepository: CompanyRepository = {
    findById: (context, id) =>
      settle(() => {
        assertTenantContext(context);
        return companyInTenant(context, id);
      }),
    create: (context, company) =>
      settle(() => {
        assertTenantContext(context);
        assertSameTenant(context, company);
        if (companies.has(company.id)) throw new RecordConflictError('duplicate-id');
        if ([...companies.values()].some((existing) => existing.tenantId === context.tenantId)) {
          throw new RecordConflictError('tenant-already-has-company');
        }
        companies.set(company.id, company);
      }),
    update: (context, company) =>
      settle(() => {
        assertTenantContext(context);
        assertSameTenant(context, company);
        if (!companyInTenant(context, company.id)) throw new RecordNotFoundError('Company');
        companies.set(company.id, company);
      }),
    delete: (context, id) =>
      settle(() => {
        assertTenantContext(context);
        if (!companyInTenant(context, id)) throw new RecordNotFoundError('Company');
        if ([...branches.values()].some((branch) => branch.companyId === id)) {
          throw new RecordConflictError('company-has-branches');
        }
        companies.delete(id);
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
        return [...branches.values()].filter(
          (branch) => branch.tenantId === context.tenantId && branch.companyId === companyId,
        );
      }),
    create: (context, branch) =>
      settle(() => {
        assertTenantContext(context);
        assertSameTenant(context, branch);
        if (branches.has(branch.id)) throw new RecordConflictError('duplicate-id');
        if (!companyInTenant(context, branch.companyId)) throw new RecordNotFoundError('Company');
        branches.set(branch.id, branch);
      }),
    update: (context, branch) =>
      settle(() => {
        assertTenantContext(context);
        assertSameTenant(context, branch);
        if (!branchInTenant(context, branch.id)) throw new RecordNotFoundError('Branch');
        if (!companyInTenant(context, branch.companyId)) throw new RecordNotFoundError('Company');
        branches.set(branch.id, branch);
      }),
    delete: (context, id) =>
      settle(() => {
        assertTenantContext(context);
        if (!branchInTenant(context, id)) throw new RecordNotFoundError('Branch');
        branches.delete(id);
      }),
  };

  return { branches: branchRepository, companies: companyRepository };
};
