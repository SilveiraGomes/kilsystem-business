import type { Branch } from './branch.js';
import type { Company } from './company.js';
import { TenantMismatchError } from './errors.js';
import type { BranchId, CompanyId, TenantId } from './identifiers.js';
import type { TenantContext } from './tenant-context.js';

/*
 * Contratos de repositório multiempresa. Todas as implementações (memória em testes,
 * SQLite e PostgreSQL em etapas futuras) devem garantir:
 *
 * - contexto ausente ou inválido: `TenantContextError`;
 * - registo cujo `tenantId` difere do contexto: `TenantMismatchError`;
 * - leitura de registo de outro tenant: `undefined`, indistinguível de inexistente;
 * - alteração ou eliminação de registo de outro tenant: `RecordNotFoundError`,
 *   sem revelar a existência do registo.
 */

export interface CompanyRepository {
  findById(context: TenantContext, id: CompanyId): Promise<Company | undefined>;
  /** Recusa um segundo registo no mesmo tenant (D-016) com `RecordConflictError`. */
  create(context: TenantContext, company: Company): Promise<void>;
  update(context: TenantContext, company: Company): Promise<void>;
  /** Recusa empresas com estabelecimentos associados com `RecordConflictError`. */
  delete(context: TenantContext, id: CompanyId): Promise<void>;
}

export interface BranchRepository {
  findById(context: TenantContext, id: BranchId): Promise<Branch | undefined>;
  listByCompany(context: TenantContext, companyId: CompanyId): Promise<readonly Branch[]>;
  /** Exige que a empresa indicada exista no tenant do contexto (`RecordNotFoundError`). */
  create(context: TenantContext, branch: Branch): Promise<void>;
  update(context: TenantContext, branch: Branch): Promise<void>;
  delete(context: TenantContext, id: BranchId): Promise<void>;
}

export const assertSameTenant = (
  context: TenantContext,
  record: { readonly tenantId: TenantId },
): void => {
  if (record.tenantId !== context.tenantId) throw new TenantMismatchError();
};
