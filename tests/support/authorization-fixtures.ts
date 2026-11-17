import { randomUUID } from 'node:crypto';

import {
  createAuthorizationRequest,
  createBranch,
  createRole,
  createRoleAssignment,
  createRolePermission,
  extendExperimentalPermissionCatalog,
  OFFICIAL_PERMISSION_CATALOG,
  type AuthorizationFacts,
  type AuthorizationRequest,
  type AuthorizationScopeInput,
  type Branch,
  type BranchMembership,
  type Company,
  type CompanyAuthorizationFacts,
  type CompanyMembership,
  type CompanyMembershipInput,
  type PermissionCatalog,
  type Role,
  type RoleAssignment,
  type RoleAssignmentInput,
  type RoleInput,
  type RolePermission,
  type User,
} from '../../packages/shared-types/src/index';
import { branchInput, CREATED_AT, newCompany } from './fixtures';
import { newBranchMembership, newCompanyMembership, newUser } from './identity-fixtures';

// Dados fictícios para testes de autorização (E1.07-D1); nenhum valor corresponde a dados reais.

/**
 * Catálogo dos testes: o oficial mais `sales.create`, um exemplo FICTÍCIO de operação comercial de
 * estabelecimento usado para os cenários obrigatórios. Não é uma funcionalidade disponível. É um
 * catálogo EXPERIMENTAL (E1.07-D1-R1): as concessões avaliadas sobre ele nunca são oficiais.
 */
export const TEST_CATALOG: PermissionCatalog = extendExperimentalPermissionCatalog(OFFICIAL_PERMISSION_CATALOG, 2, [
  {
    authorityScope: 'BRANCH',
    category: 'OPERATION',
    code: 'sales.create',
    description: 'Exemplo fictício exclusivo dos testes',
  },
]);

export const roleInput = (company: Company, overrides: Partial<RoleInput> = {}): RoleInput => ({
  id: randomUUID(),
  tenantId: company.tenantId,
  companyId: company.id,
  code: 'OPERADOR',
  name: 'Operador de Teste',
  status: 'ACTIVE',
  createdAt: CREATED_AT,
  ...overrides,
});

export const newRole = (company: Company, overrides: Partial<RoleInput> = {}): Role =>
  createRole(roleInput(company, overrides));

export const grantTo = (role: Role, permissionCode: string): RolePermission =>
  createRolePermission({ tenantId: role.tenantId, roleId: role.id, permissionCode, createdAt: CREATED_AT });

export const assignmentInput = (
  role: Role,
  membership: CompanyMembership,
  overrides: Partial<RoleAssignmentInput> = {},
): RoleAssignmentInput => ({
  id: randomUUID(),
  tenantId: membership.tenantId,
  companyId: membership.companyId,
  roleId: role.id,
  companyMembershipId: membership.id,
  scope: 'COMPANY_WIDE',
  status: 'ACTIVE',
  createdAt: CREATED_AT,
  ...overrides,
});

export const assignCompanyWide = (
  role: Role,
  membership: CompanyMembership,
  overrides: Partial<RoleAssignmentInput> = {},
): RoleAssignment => createRoleAssignment(assignmentInput(role, membership, overrides));

export const assignAtBranch = (
  role: Role,
  membership: CompanyMembership,
  branch: Branch,
  overrides: Partial<RoleAssignmentInput> = {},
): RoleAssignment =>
  createRoleAssignment(assignmentInput(role, membership, { scope: 'BRANCH', branchId: branch.id, ...overrides }));

export const companyTarget = (company: Company): AuthorizationScopeInput => ({
  kind: 'COMPANY',
  tenantId: company.tenantId,
  companyId: company.id,
});

export const branchTarget = (company: Company, branch: Branch | { readonly id: string }): AuthorizationScopeInput => ({
  kind: 'BRANCH',
  tenantId: company.tenantId,
  companyId: company.id,
  branchId: branch.id,
});

export const requestFor = (user: User, permissionCode: string, scope: AuthorizationScopeInput): AuthorizationRequest =>
  createAuthorizationRequest({ userId: user.id, permissionCode, scope });

/**
 * Empresa activa com dois estabelecimentos activos (A e B), um inactivo (C) e uma identidade
 * associada. `restricted` cria uma associação `BRANCH_RESTRICTED` com os estabelecimentos indicados.
 */
export const tenantScenario = (
  options: {
    readonly membership?: Partial<CompanyMembershipInput>;
    readonly restrictedTo?: readonly ('A' | 'B' | 'C')[];
    readonly companyStatus?: 'ACTIVE' | 'DRAFT';
  } = {},
) => {
  const company = newCompany(options.companyStatus === 'DRAFT' ? { status: 'DRAFT', nif: undefined } : {});
  const branchA = createBranch(branchInput(company, { code: 'LOJA-A' }));
  const branchB = createBranch(branchInput(company, { code: 'LOJA-B', sectorType: 'PHARMACY' }));
  const branchC = createBranch(branchInput(company, { code: 'LOJA-C', status: 'INACTIVE' }));
  const branches = { A: branchA, B: branchB, C: branchC } as const;
  const user = newUser();
  const restricted = options.restrictedTo !== undefined;
  const membership = newCompanyMembership(user, company, {
    scope: restricted ? 'BRANCH_RESTRICTED' : 'COMPANY_WIDE',
    ...options.membership,
  });
  const branchMemberships: BranchMembership[] = (options.restrictedTo ?? []).map((key) =>
    newBranchMembership(membership, branches[key]),
  );
  return { branchA, branchB, branchC, branchMemberships, company, membership, user };
};

export type TenantScenario = ReturnType<typeof tenantScenario>;

export const companyFacts = (
  scenario: TenantScenario,
  grants: {
    readonly roles?: readonly Role[];
    readonly rolePermissions?: readonly RolePermission[];
    readonly assignments?: readonly RoleAssignment[];
    readonly user?: User | undefined;
    readonly membership?: CompanyMembership | undefined;
    readonly branchMemberships?: readonly BranchMembership[];
  } = {},
): CompanyAuthorizationFacts => ({
  membership: {
    company: scenario.company,
    user: 'user' in grants ? grants.user : scenario.user,
    membership: 'membership' in grants ? grants.membership : scenario.membership,
    branchMemberships: grants.branchMemberships ?? scenario.branchMemberships,
    branches: [scenario.branchA, scenario.branchB, scenario.branchC],
  },
  roles: grants.roles ?? [],
  rolePermissions: grants.rolePermissions ?? [],
  assignments: grants.assignments ?? [],
});

export const factsFor = (
  request: AuthorizationRequest,
  company: CompanyAuthorizationFacts | undefined,
  extra: Partial<AuthorizationFacts> = {},
): AuthorizationFacts => ({ catalog: TEST_CATALOG, request, company, ...extra });

/** Factos avaliados sobre o catálogo OFICIAL (sem códigos fictícios). */
export const officialFactsFor = (
  request: AuthorizationRequest,
  company: CompanyAuthorizationFacts | undefined,
  extra: Partial<AuthorizationFacts> = {},
): AuthorizationFacts => factsFor(request, company, { catalog: OFFICIAL_PERMISSION_CATALOG, ...extra });
