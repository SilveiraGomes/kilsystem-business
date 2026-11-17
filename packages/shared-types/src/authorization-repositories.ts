import type { CompanyId, CompanyMembershipId, RoleAssignmentId, RoleId } from './identifiers.js';
import type { PermissionCode } from './permission.js';
import type { Role, RolePermission } from './role.js';
import type { RoleAssignment } from './role-assignment.js';
import type { TenantContext } from './tenant-context.js';

/*
 * Interfaces dos repositórios de autorização para E1.07-D2 (E1.07-D1: só contratos; sem
 * implementações SQLite). Todas as operações exigem `TenantContext` e seguem a semântica de
 * isolamento de D-020: leitura cruzada devolve `undefined` ou lista vazia; alteração cruzada devolve
 * `RecordNotFoundError` sem revelar existência; registo de outro tenant devolve `TenantMismatchError`;
 * contexto ausente ou inválido devolve `TenantContextError`. Não há consultas globais nem eliminação
 * física de perfis ou atribuições (desactivação lógica, D-060).
 *
 * Um `TenantContext` continua a ser construído pelo chamador (PD-27): estas interfaces não decidem
 * autorização. A verificação da autoridade do actor (delegação, prevenção de escalada) é de E1.07-D3.
 */

export interface RoleRepository {
  findById(context: TenantContext, id: RoleId): Promise<Role | undefined>;
  /** Pesquisa pelo código normalizado (`normalizeRoleCode`), dentro do tenant do contexto. */
  findByCode(context: TenantContext, code: string): Promise<Role | undefined>;
  listByCompany(context: TenantContext, companyId: CompanyId): Promise<readonly Role[]>;
  /**
   * Exige a empresa no tenant do contexto (`RecordNotFoundError('Company')`), identificador novo
   * (`RecordConflictError('duplicate-id')`) e código único no tenant
   * (`RecordConflictError('duplicate-role-code')`).
   */
  create(context: TenantContext, role: Role): Promise<void>;
  /**
   * Só `name`, `description`, `status` e `updatedAt` podem mudar; `code`, `companyId` e `createdAt`
   * são imutáveis (`RecordConflictError('immutable-field')`).
   */
  update(context: TenantContext, role: Role): Promise<void>;
}

export interface RolePermissionRepository {
  listByRole(context: TenantContext, roleId: RoleId): Promise<readonly RolePermission[]>;
  /**
   * Exige o perfil no tenant (`RecordNotFoundError('Role')`), uma permissão admitida por
   * `assertRolePermissionAllowed` sobre o catálogo vigente (`AuthorizationContractError`) e nenhuma
   * concessão igual (`RecordConflictError('duplicate-role-permission')`).
   */
  add(context: TenantContext, rolePermission: RolePermission): Promise<void>;
  /** Retira a concessão; perfil ou concessão inexistentes no tenant: `RecordNotFoundError('Role')`. */
  remove(context: TenantContext, roleId: RoleId, permissionCode: PermissionCode): Promise<void>;
}

export interface RoleAssignmentRepository {
  findById(context: TenantContext, id: RoleAssignmentId): Promise<RoleAssignment | undefined>;
  listByCompanyMembership(
    context: TenantContext,
    companyMembershipId: CompanyMembershipId,
  ): Promise<readonly RoleAssignment[]>;
  listByRole(context: TenantContext, roleId: RoleId): Promise<readonly RoleAssignment[]>;
  /**
   * Exige perfil, associação e (com `BRANCH`) estabelecimento do tenant (`RecordNotFoundError`), as
   * regras de `assertRoleAssignmentAllowed` (`AuthorizationContractError`) e a unicidade por
   * `(companyMembershipId, roleId, scope, branchId)` (`RecordConflictError('duplicate-role-assignment')`).
   */
  create(context: TenantContext, assignment: RoleAssignment): Promise<void>;
  /** Só `status` e `updatedAt` podem mudar (`RecordConflictError('immutable-field')`). */
  update(context: TenantContext, assignment: RoleAssignment): Promise<void>;
}

/*
 * O catálogo é definido em código e versionado; não existe repositório de escrita de permissões nem
 * fornecedor injectável de catálogos (E1.07-D1-R1 retirou `PermissionCatalogProvider`, que admitia
 * qualquer objecto estrutural). O caminho operacional de E1.07-D2 usa `OFFICIAL_PERMISSION_CATALOG`
 * (ou valida com `requireOfficialPermissionCatalog`) e decide se a versão vigente é registada na base
 * (por exemplo, para recusar uma base criada por um catálogo mais recente).
 */
