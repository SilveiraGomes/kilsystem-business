import type { Branch } from './branch.js';
import type { Company } from './company.js';
import { DomainValidationError, TenantMismatchError } from './errors.js';
import {
  parseBranchId,
  parseBranchMembershipId,
  parseCompanyId,
  parseCompanyMembershipId,
  parseTenantId,
  parseUserId,
  type BranchId,
  type BranchMembershipId,
  type CompanyId,
  type CompanyMembershipId,
  type TenantId,
  type UserId,
} from './identifiers.js';
import { isUserEligible, type User } from './user.js';
import { assertChronology, parseOneOf, parseTimestamp, type Timestamp } from './validation.js';

/**
 * Âmbito de uma associação empresarial (D-082). Não concede permissões funcionais:
 * `COMPANY_WIDE` abrange todos os estabelecimentos activos da empresa; `BRANCH_RESTRICTED`
 * abrange apenas os estabelecimentos explicitamente associados (nenhum, se não houver).
 */
export const MEMBERSHIP_SCOPES = ['COMPANY_WIDE', 'BRANCH_RESTRICTED'] as const;

export type MembershipScope = (typeof MEMBERSHIP_SCOPES)[number];

export const MEMBERSHIP_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Associação explícita entre um utilizador e uma empresa/tenant; única por utilizador e tenant (D-081). */
export interface CompanyMembership {
  readonly id: CompanyMembershipId;
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly scope: MembershipScope;
  readonly status: MembershipStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface CompanyMembershipInput {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly scope: string;
  readonly status: string;
  readonly createdAt: Date | string;
  /** Por omissão, igual a `createdAt`. */
  readonly updatedAt?: Date | string | undefined;
}

/**
 * Associação de uma associação empresarial `BRANCH_RESTRICTED` a um estabelecimento da mesma
 * empresa. Repete `tenantId` e `companyId` para que a base garanta essa pertença (D-086).
 */
export interface BranchMembership {
  readonly id: BranchMembershipId;
  readonly companyMembershipId: CompanyMembershipId;
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly branchId: BranchId;
  readonly status: MembershipStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface BranchMembershipInput {
  readonly id: string;
  readonly companyMembershipId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly status: string;
  readonly createdAt: Date | string;
  /** Por omissão, igual a `createdAt`. */
  readonly updatedAt?: Date | string | undefined;
}

const parseChronology = (
  input: { readonly createdAt: Date | string; readonly updatedAt?: Date | string | undefined },
): { readonly createdAt: Timestamp; readonly updatedAt: Timestamp } => {
  const createdAt = parseTimestamp(input.createdAt, 'createdAt');
  const updatedAt =
    input.updatedAt === undefined ? createdAt : parseTimestamp(input.updatedAt, 'updatedAt');
  assertChronology(createdAt, updatedAt);
  return { createdAt, updatedAt };
};

const parseCompanyAndTenant = (
  input: { readonly companyId: string; readonly tenantId: string },
): { readonly companyId: CompanyId; readonly tenantId: TenantId } => {
  const companyId = parseCompanyId(input.companyId);
  const tenantId = parseTenantId(input.tenantId);
  if ((companyId as string) === tenantId) {
    throw new DomainValidationError('tenantId', 'deve ser distinto do identificador da empresa');
  }
  return { companyId, tenantId };
};

export const createCompanyMembership = (input: CompanyMembershipInput): CompanyMembership => {
  const { createdAt, updatedAt } = parseChronology(input);
  const { companyId, tenantId } = parseCompanyAndTenant(input);
  return Object.freeze({
    id: parseCompanyMembershipId(input.id, 'id'),
    userId: parseUserId(input.userId),
    tenantId,
    companyId,
    scope: parseOneOf(input.scope, MEMBERSHIP_SCOPES, 'scope'),
    status: parseOneOf(input.status, MEMBERSHIP_STATUSES, 'status'),
    createdAt,
    updatedAt,
  });
};

export const createBranchMembership = (input: BranchMembershipInput): BranchMembership => {
  const { createdAt, updatedAt } = parseChronology(input);
  const { companyId, tenantId } = parseCompanyAndTenant(input);
  return Object.freeze({
    id: parseBranchMembershipId(input.id, 'id'),
    companyMembershipId: parseCompanyMembershipId(input.companyMembershipId),
    tenantId,
    companyId,
    branchId: parseBranchId(input.branchId),
    status: parseOneOf(input.status, MEMBERSHIP_STATUSES, 'status'),
    createdAt,
    updatedAt,
  });
};

/** Desactivação lógica; preserva o histórico (D-060). */
export const deactivateCompanyMembership = (membership: CompanyMembership, at: Date | string): CompanyMembership =>
  createCompanyMembership({ ...membership, status: 'INACTIVE', updatedAt: at });

/** Desactivação lógica; preserva o histórico (D-060). */
export const deactivateBranchMembership = (membership: BranchMembership, at: Date | string): BranchMembership =>
  createBranchMembership({ ...membership, status: 'INACTIVE', updatedAt: at });

export type MembershipIneligibilityReason = 'no-membership' | 'user-not-active' | 'membership-inactive';

/**
 * Resultado da avaliação interna de elegibilidade (D-088). NÃO é autenticação nem autorização
 * funcional: indica apenas o âmbito empresarial e local que uma futura autorização poderá
 * considerar. `companyOperational` sinaliza se a empresa está `ACTIVE`; as futuras regras de
 * autorização devem impedir operações comerciais quando for `false`.
 */
export type MembershipScopeEvaluation =
  | { readonly eligible: false; readonly reason: MembershipIneligibilityReason }
  | {
      readonly eligible: true;
      readonly userId: UserId;
      readonly tenantId: TenantId;
      readonly companyId: CompanyId;
      readonly scope: MembershipScope;
      readonly companyOperational: boolean;
      /** Estabelecimentos activos abrangidos, ordenados; pode ser vazio. */
      readonly branchIds: readonly BranchId[];
    };

export interface MembershipScopeFacts {
  readonly company: Company;
  /** Identidade associada; `undefined` é tratado como ausência de associação. */
  readonly user: User | undefined;
  readonly membership: CompanyMembership | undefined;
  readonly branchMemberships: readonly BranchMembership[];
  /** Estabelecimentos da empresa. */
  readonly branches: readonly Branch[];
}

/** Resultado não elegível, sem âmbito nem estabelecimentos. */
export const ineligibleMembershipScope = (reason: MembershipIneligibilityReason): MembershipScopeEvaluation =>
  Object.freeze({ eligible: false, reason });

const ineligible = ineligibleMembershipScope;

/**
 * Avalia o âmbito efectivo de uma associação (D-082, D-088):
 * - sem associação (ou sem identidade): `no-membership`;
 * - identidade não `ACTIVE`: `user-not-active`;
 * - associação empresarial `INACTIVE`: `membership-inactive`;
 * - `COMPANY_WIDE`: todos os estabelecimentos `ACTIVE` da empresa;
 * - `BRANCH_RESTRICTED`: estabelecimentos `ACTIVE` com associação local `ACTIVE`.
 * Factos de outro tenant ou de outra empresa são recusados com `TenantMismatchError`.
 */
export const evaluateMembershipScope = (facts: MembershipScopeFacts): MembershipScopeEvaluation => {
  const { branchMemberships, branches, company, membership, user } = facts;
  if (membership === undefined || user === undefined) return ineligible('no-membership');
  const sameCompany = (record: { readonly tenantId: TenantId; readonly companyId?: CompanyId }): boolean =>
    record.tenantId === company.tenantId && (record.companyId === undefined || record.companyId === company.id);
  if (!sameCompany(membership) || membership.userId !== user.id) throw new TenantMismatchError();
  if (!branches.every((branch) => sameCompany(branch))) throw new TenantMismatchError();
  if (!branchMemberships.every((local) => sameCompany(local) && local.companyMembershipId === membership.id)) {
    throw new TenantMismatchError();
  }

  if (!isUserEligible(user)) return ineligible('user-not-active');
  if (membership.status !== 'ACTIVE') return ineligible('membership-inactive');

  const activeBranches = new Set(branches.filter((branch) => branch.status === 'ACTIVE').map((branch) => branch.id));
  const covered =
    membership.scope === 'COMPANY_WIDE'
      ? [...activeBranches]
      : branchMemberships
          .filter((local) => local.status === 'ACTIVE' && activeBranches.has(local.branchId))
          .map((local) => local.branchId);

  return Object.freeze({
    eligible: true,
    userId: user.id,
    tenantId: company.tenantId,
    companyId: company.id,
    scope: membership.scope,
    companyOperational: company.status === 'ACTIVE',
    branchIds: Object.freeze([...new Set(covered)].sort()),
  });
};
