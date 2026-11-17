import { DomainValidationError, TenantMismatchError } from './errors.js';
import {
  parseBranchId,
  parseUserId,
  type BranchId,
  type CompanyId,
  type RoleAssignmentId,
  type RoleId,
  type TenantId,
  type UserId,
} from './identifiers.js';
import {
  evaluateMembershipScope,
  type MembershipScope,
  type MembershipScopeEvaluation,
  type MembershipScopeFacts,
} from './membership.js';
import {
  authorityOfPermissionScope,
  parsePermissionCode,
  type Permission,
  type PermissionCatalog,
  type PermissionCode,
} from './permission.js';
import type { Role, RolePermission } from './role.js';
import type { RoleAssignment, RoleAssignmentScope } from './role-assignment.js';
import { parseCompanyScope } from './scoped-record.js';
import { isUserEligible, type User } from './user.js';

/*
 * Contratos e regras PURAS de avaliação de concessões (E1.07-D1).
 *
 * NÃO são uma fronteira de segurança efectiva. Estas funções avaliam apenas os factos explícitos que
 * recebem: não consultam SQLite nem sessões, não emitem `TenantContext` e não garantem que os factos
 * sejam autênticos ou correntes. Uma decisão `GRANTED` calculada sobre factos fornecidos pelo
 * consumidor não é prova de sessão, de autoridade nem de contexto confiável, e nenhum componente a
 * aceita como tal. A autoridade dos factos (concessões persistidas, sessão validada, revalidação em
 * cada operação) é garantida em E1.07-D2 a E1.07-D4.
 */

/** Recurso sobre o qual a operação será executada. Só identifica o alvo; não prova acesso a ele. */
export type AuthorizationScope =
  | { readonly kind: 'INSTALLATION' }
  | { readonly kind: 'COMPANY'; readonly tenantId: TenantId; readonly companyId: CompanyId }
  | {
      readonly kind: 'BRANCH';
      readonly tenantId: TenantId;
      readonly companyId: CompanyId;
      readonly branchId: BranchId;
    };

/**
 * Pedido de avaliação. Construído pelo consumidor, NÃO constitui prova de sessão, de autoridade nem
 * de contexto confiável: em E1.07-D4, `userId` virá de uma sessão validada pelo serviço.
 */
export interface AuthorizationRequest {
  readonly userId: UserId;
  readonly permissionCode: PermissionCode;
  readonly scope: AuthorizationScope;
}

export type AuthorizationScopeInput =
  | { readonly kind: 'INSTALLATION' }
  | { readonly kind: 'COMPANY'; readonly tenantId: string; readonly companyId: string }
  | { readonly kind: 'BRANCH'; readonly tenantId: string; readonly companyId: string; readonly branchId: string };

export interface AuthorizationRequestInput {
  readonly userId: string;
  readonly permissionCode: string;
  readonly scope: AuthorizationScopeInput;
}

const parseAuthorizationScope = (input: AuthorizationScopeInput): AuthorizationScope => {
  switch (input.kind) {
    case 'INSTALLATION':
      return Object.freeze({ kind: 'INSTALLATION' });
    case 'COMPANY':
      return Object.freeze({ kind: 'COMPANY', ...parseCompanyScope(input) });
    case 'BRANCH':
      return Object.freeze({ kind: 'BRANCH', ...parseCompanyScope(input), branchId: parseBranchId(input.branchId) });
    default:
      throw new DomainValidationError('scope', 'não é um âmbito permitido');
  }
};

/** Validação estrutural do pedido (identificadores e gramática do código). */
export const createAuthorizationRequest = (input: AuthorizationRequestInput): AuthorizationRequest =>
  Object.freeze({
    userId: parseUserId(input.userId),
    permissionCode: parsePermissionCode(input.permissionCode),
    scope: parseAuthorizationScope(input.scope),
  });

/**
 * Concessão explícita da autoridade da instalação a uma identidade. Contrato conceptual: a emissão,
 * a persistência e a delegação são de E1.07-D3. Nunca concede acesso a empresas.
 */
export interface InstallationAuthorityGrant {
  readonly userId: UserId;
  readonly permissionCode: PermissionCode;
}

/** Concessão que tornou uma permissão aplicável ao âmbito pedido (proveniência para diagnóstico e auditoria). */
export type PermissionGrant =
  | {
      readonly source: 'ROLE_ASSIGNMENT';
      readonly permissionCode: PermissionCode;
      readonly roleId: RoleId;
      readonly roleAssignmentId: RoleAssignmentId;
      readonly assignmentScope: RoleAssignmentScope;
    }
  | { readonly source: 'INSTALLATION_AUTHORITY'; readonly permissionCode: PermissionCode };

/** Motivos internos de recusa, para diagnóstico e auditoria futura; nunca devolvidos a consumidores externos. */
export const AUTHORIZATION_DENIAL_REASONS = [
  'unknown-permission',
  'permission-unavailable',
  'scope-mismatch',
  'inconsistent-facts',
  'no-installation-authority',
  'no-membership',
  'user-not-active',
  'membership-inactive',
  'company-not-operational',
  'branch-out-of-scope',
  'permission-not-granted',
] as const;

export type AuthorizationDenialReason = (typeof AUTHORIZATION_DENIAL_REASONS)[number];

/** Decisão explícita, imutável; a recusa é o resultado por omissão. Não contém `TenantContext`. */
export type AuthorizationDecision =
  | {
      readonly outcome: 'GRANTED';
      readonly permissionCode: PermissionCode;
      readonly grants: readonly PermissionGrant[];
    }
  | { readonly outcome: 'DENIED'; readonly reason: AuthorizationDenialReason };

export const denyAuthorization = (reason: AuthorizationDenialReason): AuthorizationDecision =>
  Object.freeze({ outcome: 'DENIED', reason });

/** Só uma decisão `GRANTED` explícita conta; qualquer outro valor é recusa. */
export const isAuthorizationGranted = (decision: unknown): boolean =>
  typeof decision === 'object' && decision !== null && 'outcome' in decision && decision.outcome === 'GRANTED';

/** Resposta externa genérica: idêntica para todas as recusas, sem motivos nem identificadores. */
export type ExternalAuthorizationResponse =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly error: 'access-denied' };

const EXTERNAL_ALLOWED: ExternalAuthorizationResponse = Object.freeze({ allowed: true });
const EXTERNAL_DENIED: ExternalAuthorizationResponse = Object.freeze({ allowed: false, error: 'access-denied' });

/**
 * Converte a decisão interna na resposta externa genérica. Uma recusa nunca indica se a identidade,
 * a empresa, o estabelecimento, o perfil ou a permissão existem.
 */
export const toExternalAuthorizationResponse = (decision: AuthorizationDecision): ExternalAuthorizationResponse =>
  isAuthorizationGranted(decision) ? EXTERNAL_ALLOWED : EXTERNAL_DENIED;

/** Factos da autoridade empresarial numa empresa: elegibilidade (D-088) e concessões explícitas. */
export interface CompanyAuthorizationFacts {
  readonly membership: MembershipScopeFacts;
  readonly roles: readonly Role[];
  readonly rolePermissions: readonly RolePermission[];
  readonly assignments: readonly RoleAssignment[];
}

/** Factos da autoridade da instalação. */
export interface InstallationAuthorizationFacts {
  readonly user: User;
  readonly grants: readonly InstallationAuthorityGrant[];
}

export interface AuthorizationFacts {
  readonly catalog: PermissionCatalog;
  readonly request: AuthorizationRequest;
  /** Factos da empresa do âmbito pedido; ausentes, nenhuma permissão empresarial é aplicável. */
  readonly company?: CompanyAuthorizationFacts | undefined;
  /** Factos da autoridade da instalação; ignorados em pedidos empresariais. */
  readonly installation?: InstallationAuthorizationFacts | undefined;
}

type CompanyTarget = Extract<AuthorizationScope, { readonly kind: 'COMPANY' | 'BRANCH' }>;

type GrantResolution =
  | { readonly ok: false; readonly reason: AuthorizationDenialReason }
  | {
      readonly ok: true;
      readonly eligibility: Extract<MembershipScopeEvaluation, { readonly eligible: true }>;
      readonly grants: readonly PermissionGrant[];
    };

const refused = (reason: AuthorizationDenialReason): GrantResolution => ({ ok: false, reason });

/**
 * Aplicabilidade de uma atribuição activa ao alvo, por intersecção dos âmbitos (E1.07-D1):
 * associação empresarial ∩ associação local ∩ âmbito da atribuição ∩ âmbito exigido.
 * - Alvo `COMPANY`: só atribuições `COMPANY_WIDE` sob associação `COMPANY_WIDE`.
 * - Alvo `BRANCH` (já confirmado como abrangido pela associação): atribuições `COMPANY_WIDE` sob
 *   associação `COMPANY_WIDE`, ou atribuições `BRANCH` desse mesmo estabelecimento.
 */
const assignmentApplies = (
  assignment: RoleAssignment,
  membershipScope: MembershipScope,
  target: CompanyTarget,
  coveredBranches: readonly BranchId[],
): boolean => {
  if (assignment.scope === 'COMPANY_WIDE') return membershipScope === 'COMPANY_WIDE';
  return (
    target.kind === 'BRANCH' &&
    assignment.branchId === target.branchId &&
    coveredBranches.includes(assignment.branchId)
  );
};

const grantsPermissionAt = (permission: Permission | undefined, target: CompanyTarget): boolean =>
  permission !== undefined &&
  permission.status === 'AVAILABLE' &&
  authorityOfPermissionScope(permission.authorityScope) === 'COMPANY' &&
  permission.authorityScope === target.kind;

/**
 * Concessões empresariais aplicáveis ao alvo: a união das permissões dos perfis activos atribuídos
 * por atribuições activas e aplicáveis, só dentro do âmbito comum autorizado. Factos de outro tenant,
 * empresa ou identidade recusam tudo (`inconsistent-facts`).
 */
const resolveCompanyGrants = (
  catalog: PermissionCatalog,
  userId: UserId,
  target: CompanyTarget,
  facts: CompanyAuthorizationFacts,
): GrantResolution => {
  const { membership: scopeFacts } = facts;
  const company = scopeFacts.company;
  if (company.tenantId !== target.tenantId || company.id !== target.companyId) return refused('inconsistent-facts');
  if (scopeFacts.user !== undefined && scopeFacts.user.id !== userId) return refused('inconsistent-facts');
  if (scopeFacts.membership !== undefined && scopeFacts.membership.userId !== userId) return refused('inconsistent-facts');
  const sameCompany = (record: { readonly tenantId: TenantId; readonly companyId?: CompanyId }): boolean =>
    record.tenantId === target.tenantId && (record.companyId === undefined || record.companyId === target.companyId);
  if (!facts.roles.every(sameCompany) || !facts.rolePermissions.every(sameCompany) || !facts.assignments.every(sameCompany)) {
    return refused('inconsistent-facts');
  }

  let eligibility: MembershipScopeEvaluation;
  try {
    eligibility = evaluateMembershipScope(scopeFacts);
  } catch (error) {
    if (error instanceof TenantMismatchError) return refused('inconsistent-facts');
    throw error;
  }
  if (!eligibility.eligible) return refused(eligibility.reason);
  const membership = scopeFacts.membership;
  if (membership === undefined) return refused('no-membership');
  if (target.kind === 'BRANCH' && !eligibility.branchIds.includes(target.branchId)) return refused('branch-out-of-scope');

  const activeRoles = new Map(facts.roles.filter((role) => role.status === 'ACTIVE').map((role) => [role.id, role]));
  const grants: PermissionGrant[] = [];
  for (const assignment of facts.assignments) {
    if (assignment.status !== 'ACTIVE' || assignment.companyMembershipId !== membership.id) continue;
    const role = activeRoles.get(assignment.roleId);
    if (role === undefined) continue;
    if (!assignmentApplies(assignment, membership.scope, target, eligibility.branchIds)) continue;
    for (const rolePermission of facts.rolePermissions) {
      if (rolePermission.roleId !== role.id) continue;
      if (!grantsPermissionAt(catalog.find(rolePermission.permissionCode), target)) continue;
      grants.push(
        Object.freeze({
          source: 'ROLE_ASSIGNMENT',
          permissionCode: rolePermission.permissionCode,
          roleId: role.id,
          roleAssignmentId: assignment.id,
          assignmentScope: assignment.scope,
        }),
      );
    }
  }
  return { ok: true, eligibility, grants };
};

/**
 * União das permissões empresariais aplicáveis a um alvo `COMPANY` ou `BRANCH`, ordenada e sem
 * repetições. Vazia em qualquer recusa (por omissão). Não é uma lista “global” do utilizador: as
 * concessões de um estabelecimento nunca contam noutro.
 */
export const listApplicablePermissionCodes = (input: {
  readonly catalog: PermissionCatalog;
  readonly userId: UserId;
  readonly scope: AuthorizationScope;
  readonly company: CompanyAuthorizationFacts;
}): readonly PermissionCode[] => {
  if (input.scope.kind === 'INSTALLATION') return Object.freeze([]);
  try {
    const resolution = resolveCompanyGrants(input.catalog, input.userId, input.scope, input.company);
    if (!resolution.ok) return Object.freeze([]);
    return Object.freeze([...new Set(resolution.grants.map((grant) => grant.permissionCode))].sort());
  } catch {
    return Object.freeze([]);
  }
};

const granted = (permissionCode: PermissionCode, grants: readonly PermissionGrant[]): AuthorizationDecision =>
  Object.freeze({ outcome: 'GRANTED', permissionCode, grants: Object.freeze([...grants]) });

const evaluateInstallation = (
  request: AuthorizationRequest,
  facts: InstallationAuthorizationFacts | undefined,
): AuthorizationDecision => {
  if (facts === undefined) return denyAuthorization('no-installation-authority');
  if (facts.user.id !== request.userId || facts.grants.some((grant) => grant.userId !== request.userId)) {
    return denyAuthorization('inconsistent-facts');
  }
  if (!isUserEligible(facts.user)) return denyAuthorization('user-not-active');
  const matching = facts.grants.filter((grant) => grant.permissionCode === request.permissionCode);
  if (matching.length === 0) return denyAuthorization('permission-not-granted');
  return granted(
    request.permissionCode,
    matching.map((grant) => Object.freeze({ source: 'INSTALLATION_AUTHORITY', permissionCode: grant.permissionCode })),
  );
};

const evaluate = (facts: AuthorizationFacts): AuthorizationDecision => {
  const { catalog, request } = facts;
  const permission = catalog.find(request.permissionCode);
  if (permission === undefined) return denyAuthorization('unknown-permission');
  if (permission.status !== 'AVAILABLE') return denyAuthorization('permission-unavailable');
  if (permission.authorityScope !== request.scope.kind) return denyAuthorization('scope-mismatch');
  if (request.scope.kind === 'INSTALLATION') return evaluateInstallation(request, facts.installation);

  // Pedido empresarial: a autoridade da instalação é ignorada (não concede acesso comercial).
  if (facts.company === undefined) return denyAuthorization('no-membership');
  const resolution = resolveCompanyGrants(catalog, request.userId, request.scope, facts.company);
  if (!resolution.ok) return denyAuthorization(resolution.reason);
  if (permission.category === 'OPERATION' && !resolution.eligibility.companyOperational) {
    return denyAuthorization('company-not-operational');
  }
  const matching = resolution.grants.filter((grant) => grant.permissionCode === request.permissionCode);
  if (matching.length === 0) return denyAuthorization('permission-not-granted');
  return granted(request.permissionCode, matching);
};

/**
 * Avaliação pura de um pedido sobre factos explícitos; recusa por omissão. Qualquer excepção na
 * avaliação (factos malformados) resulta em recusa (`inconsistent-facts`).
 *
 * Só para modelação e testes até E1.07-D4: não é autorização integrada e o resultado não deve ser
 * usado para autorizar operações enquanto os factos não vierem de fontes confiáveis (E1.07-D2/D4).
 */
export const evaluateAuthorizationFacts = (facts: AuthorizationFacts): AuthorizationDecision => {
  try {
    return evaluate(facts);
  } catch {
    return denyAuthorization('inconsistent-facts');
  }
};
