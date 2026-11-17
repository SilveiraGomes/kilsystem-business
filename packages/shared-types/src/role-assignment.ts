import type { Branch } from './branch.js';
import { AuthorizationContractError, DomainValidationError, TenantMismatchError } from './errors.js';
import {
  parseBranchId,
  parseCompanyMembershipId,
  parseRoleAssignmentId,
  parseRoleId,
  type BranchId,
  type CompanyId,
  type CompanyMembershipId,
  type RoleAssignmentId,
  type RoleId,
  type TenantId,
} from './identifiers.js';
import type { BranchMembership, CompanyMembership } from './membership.js';
import type { Role } from './role.js';
import { parseChronology, parseCompanyScope } from './scoped-record.js';
import { parseOneOf, type Timestamp } from './validation.js';

/*
 * Atribuição de um perfil empresarial (E1.07-D1). Um perfil só é atribuído através de uma
 * associação empresarial explícita (nunca directamente a uma identidade) e com um âmbito que nunca
 * amplia o da associação.
 *
 * Unicidade: no máximo uma atribuição por `(tenantId, companyMembershipId, roleId, scope, branchId)`,
 * qualquer que seja o estado. Uma atribuição desactivada é reactivada, não duplicada. O mesmo perfil
 * pode ser atribuído à mesma associação em estabelecimentos diferentes.
 */

/**
 * - `COMPANY_WIDE`: o perfil vale para a empresa e para os estabelecimentos abrangidos pela
 *   associação; exige uma associação `COMPANY_WIDE`.
 * - `BRANCH`: o perfil vale só no estabelecimento indicado.
 */
export const ROLE_ASSIGNMENT_SCOPES = ['COMPANY_WIDE', 'BRANCH'] as const;

export type RoleAssignmentScope = (typeof ROLE_ASSIGNMENT_SCOPES)[number];

export const ROLE_ASSIGNMENT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export type RoleAssignmentStatus = (typeof ROLE_ASSIGNMENT_STATUSES)[number];

export interface RoleAssignment {
  readonly id: RoleAssignmentId;
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly roleId: RoleId;
  readonly companyMembershipId: CompanyMembershipId;
  readonly scope: RoleAssignmentScope;
  /** Presente só com âmbito `BRANCH`. */
  readonly branchId?: BranchId;
  readonly status: RoleAssignmentStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface RoleAssignmentInput {
  readonly id: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly roleId: string;
  readonly companyMembershipId: string;
  readonly scope: string;
  readonly branchId?: string | undefined;
  readonly status: string;
  readonly createdAt: Date | string;
  /** Por omissão, igual a `createdAt`. */
  readonly updatedAt?: Date | string | undefined;
}

/** Validação estrutural: `branchId` obrigatório com `BRANCH` e proibido com `COMPANY_WIDE`. */
export const createRoleAssignment = (input: RoleAssignmentInput): RoleAssignment => {
  const { createdAt, updatedAt } = parseChronology(input);
  const { companyId, tenantId } = parseCompanyScope(input);
  const scope = parseOneOf(input.scope, ROLE_ASSIGNMENT_SCOPES, 'scope');
  if (scope === 'BRANCH' && input.branchId === undefined) {
    throw new DomainValidationError('branchId', 'é obrigatório numa atribuição de estabelecimento');
  }
  if (scope === 'COMPANY_WIDE' && input.branchId !== undefined) {
    throw new DomainValidationError('branchId', 'não se aplica a uma atribuição empresarial');
  }
  return Object.freeze({
    id: parseRoleAssignmentId(input.id, 'id'),
    tenantId,
    companyId,
    roleId: parseRoleId(input.roleId),
    companyMembershipId: parseCompanyMembershipId(input.companyMembershipId),
    scope,
    ...(scope === 'BRANCH' ? { branchId: parseBranchId(input.branchId) } : {}),
    status: parseOneOf(input.status, ROLE_ASSIGNMENT_STATUSES, 'status'),
    createdAt,
    updatedAt,
  });
};

/** Desactivação lógica (D-060). */
export const deactivateRoleAssignment = (assignment: RoleAssignment, at: Date | string): RoleAssignment =>
  createRoleAssignment({ ...assignment, status: 'INACTIVE', updatedAt: at });

export interface RoleAssignmentFacts {
  readonly role: Role;
  readonly membership: CompanyMembership;
  /** Estabelecimento indicado, obrigatório com âmbito `BRANCH`. */
  readonly branch?: Branch | undefined;
  /** Associações locais da associação empresarial (relevantes em `BRANCH_RESTRICTED`). */
  readonly branchMemberships: readonly BranchMembership[];
}

const sameCompany = (
  record: { readonly tenantId: TenantId; readonly companyId: CompanyId },
  assignment: RoleAssignment,
): boolean => record.tenantId === assignment.tenantId && record.companyId === assignment.companyId;

/**
 * Regras de uma atribuição nova:
 * - perfil, associação e estabelecimento do mesmo tenant e empresa (`TenantMismatchError`);
 * - referências coerentes com os factos (`DomainValidationError`);
 * - perfil e associação activos (`role-inactive`, `membership-inactive`) e estabelecimento activo
 *   (`branch-inactive`);
 * - âmbito contido no da associação (`assignment-scope-exceeds-membership`): `COMPANY_WIDE` exige
 *   associação `COMPANY_WIDE`; `BRANCH` sob `BRANCH_RESTRICTED` exige associação local activa.
 * Não verifica a autoridade do actor que atribui (delegação, E1.07-D3).
 */
export const assertRoleAssignmentAllowed = (assignment: RoleAssignment, facts: RoleAssignmentFacts): void => {
  const { branch, branchMemberships, membership, role } = facts;
  if (!sameCompany(role, assignment) || !sameCompany(membership, assignment)) throw new TenantMismatchError();
  if (role.id !== assignment.roleId) throw new DomainValidationError('roleId', 'não corresponde ao perfil indicado');
  if (membership.id !== assignment.companyMembershipId) {
    throw new DomainValidationError('companyMembershipId', 'não corresponde à associação indicada');
  }
  if (role.status !== 'ACTIVE') throw new AuthorizationContractError('role-inactive');
  if (membership.status !== 'ACTIVE') throw new AuthorizationContractError('membership-inactive');

  if (assignment.scope === 'COMPANY_WIDE') {
    if (membership.scope !== 'COMPANY_WIDE') throw new AuthorizationContractError('assignment-scope-exceeds-membership');
    return;
  }
  if (branch === undefined) throw new DomainValidationError('branchId', 'exige o estabelecimento indicado');
  if (!sameCompany(branch, assignment)) throw new TenantMismatchError();
  if (branch.id !== assignment.branchId) throw new DomainValidationError('branchId', 'não corresponde ao estabelecimento indicado');
  if (branch.status !== 'ACTIVE') throw new AuthorizationContractError('branch-inactive');
  if (membership.scope === 'BRANCH_RESTRICTED') {
    const covered = branchMemberships.some(
      (local) =>
        local.status === 'ACTIVE' &&
        local.branchId === branch.id &&
        local.companyMembershipId === membership.id &&
        local.tenantId === assignment.tenantId,
    );
    if (!covered) throw new AuthorizationContractError('assignment-scope-exceeds-membership');
  }
};
