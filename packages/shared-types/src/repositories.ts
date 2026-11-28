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
 * - alteração de registo de outro tenant: `RecordNotFoundError`, sem revelar a existência do registo;
 * - registo estruturalmente inválido (ex.: objecto forjado): `DomainValidationError`;
 * - identificador repetido: `RecordConflictError('duplicate-id')`;
 * - `createdAt` alterado numa actualização: `RecordConflictError('immutable-field')`.
 *
 * Empresas e estabelecimentos nunca são eliminados nem substituídos (D-222, D-253): os contratos
 * não têm eliminação física e a base recusa-a (migração 10). Um registo deixa de operar por
 * alteração do estado, nunca por remoção; os identificadores nunca são reutilizados.
 */

export interface CompanyRepository {
  findById(context: TenantContext, id: CompanyId): Promise<Company | undefined>;
  /** Recusa um segundo registo no mesmo tenant (D-016, D-023) com `RecordConflictError`. */
  create(context: TenantContext, company: Company): Promise<void>;
  update(context: TenantContext, company: Company): Promise<void>;
}

export interface BranchRepository {
  findById(context: TenantContext, id: BranchId): Promise<Branch | undefined>;
  /** Ordenados por código. */
  listByCompany(context: TenantContext, companyId: CompanyId): Promise<readonly Branch[]>;
  /**
   * Exige que a empresa indicada exista no tenant do contexto (`RecordNotFoundError`) e que o
   * código normalizado seja único na empresa (`RecordConflictError('duplicate-branch-code')`, D-026).
   */
  create(context: TenantContext, branch: Branch): Promise<void>;
  /**
   * Mesmas exigências de `create`; o código nunca é tomado de outro estabelecimento. O sector é
   * imutável (`RecordConflictError('immutable-field')`, DP-PD78-04).
   */
  update(context: TenantContext, branch: Branch): Promise<void>;
}

export const assertSameTenant = (
  context: TenantContext,
  record: { readonly tenantId: TenantId },
): void => {
  if (record.tenantId !== context.tenantId) throw new TenantMismatchError();
};
