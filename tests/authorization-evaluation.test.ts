import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS, migrationChecksum } from '../packages/database/src/index';
import {
  assertTenantContext,
  AUTHORIZATION_DENIAL_REASONS,
  changeUserStatus,
  createRoleAssignment,
  deactivateBranch,
  deactivateBranchMembership,
  deactivateCompanyMembership,
  deactivateRole,
  deactivateRoleAssignment,
  createExperimentalPermissionCatalog,
  evaluateAuthorizationFacts,
  INITIAL_PERMISSION_CATALOG_VERSION,
  INITIAL_PERMISSION_DEFINITIONS,
  inspectDomainDecision,
  isOfficialDomainGrant,
  listApplicablePermissionCodes,
  parsePermissionCode,
  toExternalDomainEvaluationResponse,
  type AuthorizationDecision,
  type AuthorizationFacts,
  type AuthorizationRequest,
  type InstallationAuthorityGrant,
  type PermissionCatalog,
} from '../packages/shared-types/src/index';
import {
  assignAtBranch,
  assignCompanyWide,
  assignmentInput,
  branchTarget,
  companyFacts,
  companyTarget,
  factsFor,
  grantTo,
  newRole,
  officialFactsFor,
  requestFor,
  TEST_CATALOG,
  tenantScenario,
} from './support/authorization-fixtures';
import { UPDATED_AT } from './support/fixtures';

/*
 * E1.07-D1 — avaliação PURA de concessões (requisitos 31 a 44) e fronteiras (45 a 50). Estas regras
 * não são autorização integrada: avaliam factos explícitos e não substituem E1.07-D2 a E1.07-D4.
 */

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED_TYPES_SOURCES = path.join(REPOSITORY_ROOT, 'packages', 'shared-types', 'src');
const AUTHORIZATION_SOURCES = ['authorization.ts', 'authorization-repositories.ts', 'permission.ts', 'role.ts', 'role-assignment.ts', 'scoped-record.ts'].map(
  (file) => path.join(SHARED_TYPES_SOURCES, file),
);
// E1.07-D1-R1: inclui os nomes novos (catálogo oficial e decisões de domínio) para manter a guarda.
const RBAC_SYMBOLS = /evaluateAuthorizationFacts|listApplicablePermissionCodes|PermissionCatalog|OFFICIAL_PERMISSION_CATALOG|INITIAL_PERMISSION|RoleAssignment|RolePermission|RoleRepository|createRole\b|AuthorizationDecision|DomainDecision|DomainEvaluation|DomainGrant|InstallationAuthorityGrant/;

const sources = (directory: string): readonly string[] =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx|cts|mts)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));

const evaluate = (facts: AuthorizationFacts): AuthorizationDecision => evaluateAuthorizationFacts(facts);

// E1.07-D1-R1: o reconhecimento passa pela proveniência registada (`inspectDomainDecision`), não pela
// propriedade `outcome`; os cenários usam o catálogo experimental, cujas concessões não são oficiais.
const isGrantedEvaluation = (decision: unknown): boolean => {
  const inspection = inspectDomainDecision(decision);
  return inspection.recognized && inspection.outcome === 'GRANTED';
};

const expectDenied = (decision: AuthorizationDecision, reason: string): void => {
  expect(decision).toEqual({ outcome: 'DENIED', reason });
  expect(inspectDomainDecision(decision)).toMatchObject({ recognized: true, outcome: 'DENIED' });
  expect(isGrantedEvaluation(decision)).toBe(false);
  expect(isOfficialDomainGrant(decision)).toBe(false);
};

const expectGranted = (decision: AuthorizationDecision): void => {
  expect(decision.outcome).toBe('GRANTED');
  expect(isGrantedEvaluation(decision)).toBe(true);
};

/** Cenário com uma associação `COMPANY_WIDE`, um perfil activo e uma atribuição empresarial. */
const companyWideGrant = (codes: readonly string[]) => {
  const scenario = tenantScenario();
  const role = newRole(scenario.company);
  const assignment = assignCompanyWide(role, scenario.membership);
  const facts = companyFacts(scenario, { roles: [role], rolePermissions: codes.map((code) => grantTo(role, code)), assignments: [assignment] });
  return { ...scenario, assignment, facts, role };
};

describe('E1.07-D1 pure evaluation', () => {
  it('D40 denies by default', () => {
    const { company, user } = tenantScenario();
    const request = requestFor(user, 'company.read', companyTarget(company));
    expectDenied(evaluate(factsFor(request, undefined)), 'no-membership');
    const scenario = tenantScenario();
    const own = requestFor(scenario.user, 'company.read', companyTarget(scenario.company));
    expectDenied(evaluate(factsFor(own, companyFacts(scenario))), 'permission-not-granted');
    const role = newRole(scenario.company);
    expectDenied(evaluate(factsFor(own, companyFacts(scenario, { roles: [role], rolePermissions: [grantTo(role, 'company.read')] }))), 'permission-not-granted');
    for (const value of [undefined, null, {}, { outcome: 'granted' }, { outcome: true }, 'GRANTED', { allowed: true }]) {
      expect(isGrantedEvaluation(value)).toBe(false);
      expect(isOfficialDomainGrant(value)).toBe(false);
    }
  });

  it('D41 grants an explicit applicable permission and records its provenance', () => {
    const { assignment, company, facts, role, user } = companyWideGrant(['company.read']);
    const decision = evaluate(factsFor(requestFor(user, 'company.read', companyTarget(company)), facts));
    expectGranted(decision);
    expect(decision).toEqual({
      outcome: 'GRANTED',
      permissionCode: 'company.read',
      grants: [{ source: 'ROLE_ASSIGNMENT', permissionCode: 'company.read', roleId: role.id, roleAssignmentId: assignment.id, assignmentScope: 'COMPANY_WIDE' }],
    });
  });

  it('D42 denies a permission that no applicable role grants', () => {
    const { company, facts, user } = companyWideGrant(['roles.read', 'company.read']);
    expectDenied(evaluate(factsFor(requestFor(user, 'company.update', companyTarget(company)), facts)), 'permission-not-granted');
    expectDenied(evaluate(factsFor(requestFor(user, 'roles.assign', companyTarget(company)), facts)), 'permission-not-granted');
  });

  it('D43 unites explicit permissions from several roles', () => {
    const scenario = tenantScenario();
    const reader = newRole(scenario.company, { code: 'LEITOR' });
    const manager = newRole(scenario.company, { code: 'GESTOR_PERFIS' });
    const facts = companyFacts(scenario, {
      roles: [reader, manager],
      rolePermissions: [grantTo(reader, 'company.read'), grantTo(manager, 'roles.read'), grantTo(manager, 'roles.assign'), grantTo(reader, 'branches.read')],
      assignments: [assignCompanyWide(reader, scenario.membership), assignCompanyWide(manager, scenario.membership)],
    });
    for (const code of ['company.read', 'roles.read', 'roles.assign']) {
      expectGranted(evaluate(factsFor(requestFor(scenario.user, code, companyTarget(scenario.company)), facts)));
    }
    const atCompany = requestFor(scenario.user, 'company.read', companyTarget(scenario.company));
    expect(listApplicablePermissionCodes({ catalog: TEST_CATALOG, userId: scenario.user.id, scope: atCompany.scope, company: facts })).toEqual(['company.read', 'roles.assign', 'roles.read']);
    const atBranch = requestFor(scenario.user, 'branches.read', branchTarget(scenario.company, scenario.branchA));
    expectGranted(evaluate(factsFor(atBranch, facts)));
    expect(listApplicablePermissionCodes({ catalog: TEST_CATALOG, userId: scenario.user.id, scope: atBranch.scope, company: facts })).toEqual(['branches.read']);
  });

  it('D44 gives no grants through an inactive role', () => {
    const { assignment, company, facts, role, user } = companyWideGrant(['company.read']);
    const request = requestFor(user, 'company.read', companyTarget(company));
    const inactive = { ...facts, roles: [deactivateRole(role, UPDATED_AT)] };
    expectDenied(evaluate(factsFor(request, inactive)), 'permission-not-granted');
    expect(listApplicablePermissionCodes({ catalog: TEST_CATALOG, userId: user.id, scope: request.scope, company: inactive })).toEqual([]);
    expect(assignment.status).toBe('ACTIVE');
  });

  it('D45 gives no grants through an inactive assignment', () => {
    const { assignment, company, facts, user } = companyWideGrant(['company.read']);
    const inactive = { ...facts, assignments: [deactivateRoleAssignment(assignment, UPDATED_AT)] };
    expectDenied(evaluate(factsFor(requestFor(user, 'company.read', companyTarget(company)), inactive)), 'permission-not-granted');
  });

  it('D46 denies unknown and withdrawn permissions even when a role lists them', () => {
    const { company, facts, role, user } = companyWideGrant(['company.read']);
    const unknown = { ...facts, rolePermissions: [...facts.rolePermissions, grantTo(role, 'reports.export')] };
    expectDenied(evaluate(factsFor(requestFor(user, 'reports.export', companyTarget(company)), unknown)), 'unknown-permission');
    // E1.07-D1-R1: um catálogo fabricado por cópia seria recusado como `untrusted-catalog`; a retirada
    // é exercitada com um catálogo experimental reconhecido em que `company.read` está `WITHDRAWN`.
    const withdrawn: PermissionCatalog = createExperimentalPermissionCatalog(
      INITIAL_PERMISSION_CATALOG_VERSION,
      INITIAL_PERMISSION_DEFINITIONS.map((definition) => (definition.code === 'company.read' ? { ...definition, status: 'WITHDRAWN' } : definition)),
    );
    expectDenied(evaluate(factsFor(requestFor(user, 'company.read', companyTarget(company)), facts, { catalog: withdrawn })), 'permission-unavailable');
  });

  it('D47 isolates grants by tenant', () => {
    const own = companyWideGrant(['company.read', 'roles.read']);
    const other = tenantScenario();
    // Mesmo código de perfil e mesma permissão noutra empresa: nada se transporta entre tenants.
    const otherRole = newRole(other.company, { code: own.role.code });
    const otherFacts = companyFacts(other, { roles: [otherRole], rolePermissions: [grantTo(otherRole, 'company.read')], assignments: [assignCompanyWide(otherRole, other.membership)] });
    const crossRequest = requestFor(own.user, 'company.read', companyTarget(other.company));
    // Sem associação no tenant B, a identidade não tem acesso, mesmo com perfis homónimos em B.
    const withoutMembership = companyFacts(other, { user: undefined, membership: undefined, roles: [otherRole], rolePermissions: [grantTo(otherRole, 'company.read')], assignments: [] });
    expectDenied(evaluate(factsFor(crossRequest, withoutMembership)), 'no-membership');
    // Factos de B com a identidade de outra pessoa, ou factos de A num pedido sobre B: recusa total.
    expectDenied(evaluate(factsFor(crossRequest, otherFacts)), 'inconsistent-facts');
    expectDenied(evaluate(factsFor(crossRequest, own.facts)), 'inconsistent-facts');
    // Elegibilidade de A com perfis e atribuições forjados de B que apontam para a associação de A.
    const forgedAssignment = createRoleAssignment({ ...assignmentInput(otherRole, other.membership), companyMembershipId: own.membership.id });
    const forged = companyFacts(own, { roles: [otherRole], rolePermissions: [grantTo(otherRole, 'company.read')], assignments: [forgedAssignment] });
    expectDenied(evaluate(factsFor(crossRequest, forged)), 'inconsistent-facts');
    expect(listApplicablePermissionCodes({ catalog: TEST_CATALOG, userId: own.user.id, scope: crossRequest.scope, company: forged })).toEqual([]);
    expectGranted(evaluate(factsFor(requestFor(other.user, 'company.read', companyTarget(other.company)), otherFacts)));
    const mixed = { ...own.facts, roles: [...own.facts.roles, otherRole], rolePermissions: [...own.facts.rolePermissions, grantTo(otherRole, 'roles.assign')] };
    expectDenied(evaluate(factsFor(requestFor(own.user, 'company.read', companyTarget(own.company)), mixed)), 'inconsistent-facts');
    const foreignAssignment = { ...own.facts, assignments: [...own.facts.assignments, assignCompanyWide(otherRole, other.membership)] };
    expectDenied(evaluate(factsFor(requestFor(own.user, 'company.read', companyTarget(own.company)), foreignAssignment)), 'inconsistent-facts');
    expect(listApplicablePermissionCodes({ catalog: TEST_CATALOG, userId: own.user.id, scope: crossRequest.scope, company: own.facts })).toEqual([]);
  });

  it('D48 isolates grants by branch', () => {
    const scenario = tenantScenario({ restrictedTo: ['A'] });
    const role = newRole(scenario.company);
    const facts = companyFacts(scenario, { roles: [role], rolePermissions: [grantTo(role, 'branches.read')], assignments: [assignAtBranch(role, scenario.membership, scenario.branchA)] });
    expectGranted(evaluate(factsFor(requestFor(scenario.user, 'branches.read', branchTarget(scenario.company, scenario.branchA)), facts)));
    expectDenied(evaluate(factsFor(requestFor(scenario.user, 'branches.read', branchTarget(scenario.company, scenario.branchB)), facts)), 'branch-out-of-scope');
    // Um BranchId arbitrário não é prova de autoridade.
    const arbitrary = { id: '6f1c2d9e-8a4b-4c3d-9e2f-1a2b3c4d5e6f' };
    expectDenied(evaluate(factsFor(requestFor(scenario.user, 'branches.read', branchTarget(scenario.company, arbitrary)), facts)), 'branch-out-of-scope');
    const lostLocal = { ...facts, membership: { ...facts.membership, branchMemberships: scenario.branchMemberships.map((local) => deactivateBranchMembership(local, UPDATED_AT)) } };
    expectDenied(evaluate(factsFor(requestFor(scenario.user, 'branches.read', branchTarget(scenario.company, scenario.branchA)), lostLocal)), 'branch-out-of-scope');
  });

  it('D49 (mandatory example) refuses a sale in branch B when sales.create was only granted in branch A', () => {
    for (const restrictedTo of [['A', 'B'] as const, undefined]) {
      const scenario = tenantScenario(restrictedTo === undefined ? {} : { restrictedTo });
      const cashier = newRole(scenario.company, { code: 'CAIXA' });
      const viewer = newRole(scenario.company, { code: 'CONSULTA' });
      const facts = companyFacts(scenario, {
        roles: [cashier, viewer],
        rolePermissions: [grantTo(cashier, 'sales.create'), grantTo(viewer, 'branches.read')],
        assignments: [assignAtBranch(cashier, scenario.membership, scenario.branchA), assignAtBranch(viewer, scenario.membership, scenario.branchB)],
      });
      const saleA = requestFor(scenario.user, 'sales.create', branchTarget(scenario.company, scenario.branchA));
      const saleB = requestFor(scenario.user, 'sales.create', branchTarget(scenario.company, scenario.branchB));
      expectGranted(evaluate(factsFor(saleA, facts)));
      expectGranted(evaluate(factsFor(requestFor(scenario.user, 'branches.read', branchTarget(scenario.company, scenario.branchB)), facts)));
      expectDenied(evaluate(factsFor(saleB, facts)), 'permission-not-granted');
      const listAt = (scope: typeof saleA.scope) => listApplicablePermissionCodes({ catalog: TEST_CATALOG, userId: scenario.user.id, scope, company: facts });
      expect(listAt(saleA.scope)).toEqual(['sales.create']);
      expect(listAt(saleB.scope)).toEqual(['branches.read']);
    }
  });

  it('D50 does not authorise company-wide operations through branch-restricted roles', () => {
    const scenario = tenantScenario();
    const branchAdmin = newRole(scenario.company, { code: 'ADMIN_LOJA' });
    const facts = companyFacts(scenario, {
      roles: [branchAdmin],
      rolePermissions: ['company.update', 'roles.assign', 'branches.read'].map((code) => grantTo(branchAdmin, code)),
      assignments: [assignAtBranch(branchAdmin, scenario.membership, scenario.branchA)],
    });
    for (const code of ['company.update', 'roles.assign']) {
      expectDenied(evaluate(factsFor(requestFor(scenario.user, code, companyTarget(scenario.company)), facts)), 'permission-not-granted');
    }
    expectGranted(evaluate(factsFor(requestFor(scenario.user, 'branches.read', branchTarget(scenario.company, scenario.branchA)), facts)));
    // Uma permissão de estabelecimento não é uma operação empresarial global, e vice-versa.
    expectDenied(evaluate(factsFor(requestFor(scenario.user, 'branches.read', companyTarget(scenario.company)), facts)), 'scope-mismatch');
    expectDenied(evaluate(factsFor(requestFor(scenario.user, 'company.update', branchTarget(scenario.company, scenario.branchA)), facts)), 'scope-mismatch');

    // Uma atribuição COMPANY_WIDE sob associação BRANCH_RESTRICTED (inválida) nunca amplia o âmbito.
    const restricted = tenantScenario({ restrictedTo: ['A'] });
    const role = newRole(restricted.company);
    const widened = companyFacts(restricted, { roles: [role], rolePermissions: [grantTo(role, 'company.update'), grantTo(role, 'branches.read')], assignments: [assignCompanyWide(role, restricted.membership)] });
    expectDenied(evaluate(factsFor(requestFor(restricted.user, 'company.update', companyTarget(restricted.company)), widened)), 'permission-not-granted');
    expectDenied(evaluate(factsFor(requestFor(restricted.user, 'branches.read', branchTarget(restricted.company, restricted.branchA)), widened)), 'permission-not-granted');
  });

  it('D51 gives technical installation authority no automatic company or commercial access', () => {
    const scenario = tenantScenario();
    const installationGrants: InstallationAuthorityGrant[] = TEST_CATALOG.permissions
      .filter((permission) => permission.authorityScope === 'INSTALLATION')
      .map((permission) => ({ userId: scenario.user.id, permissionCode: permission.code }));
    const forged: InstallationAuthorityGrant[] = [...installationGrants, { userId: scenario.user.id, permissionCode: parsePermissionCode('company.read') }];
    const installation = { user: scenario.user, grants: forged };
    expectGranted(evaluate(factsFor(requestFor(scenario.user, 'installation.settings.update', { kind: 'INSTALLATION' }), undefined, { installation })));
    for (const [code, target] of [['company.read', companyTarget(scenario.company)], ['sales.create', branchTarget(scenario.company, scenario.branchA)], ['branches.read', branchTarget(scenario.company, scenario.branchA)]] as const) {
      const request = requestFor(scenario.user, code, target);
      expectDenied(evaluate(factsFor(request, undefined, { installation })), 'no-membership');
      expectDenied(evaluate(factsFor(request, companyFacts(scenario), { installation })), 'permission-not-granted');
    }
    // A concessão forjada de um código empresarial à autoridade da instalação não vale em nenhum âmbito.
    expectDenied(evaluate(factsFor(requestFor(scenario.user, 'company.read', { kind: 'INSTALLATION' }), undefined, { installation })), 'scope-mismatch');
  });

  it('D52 gives company roles no installation authority', () => {
    const scenario = tenantScenario();
    const everything = newRole(scenario.company, { code: 'TOTAL' });
    const companyCodes = TEST_CATALOG.permissions.filter((permission) => permission.authorityScope !== 'INSTALLATION').map((permission) => permission.code);
    const forgedInstallationGrant = grantTo(everything, 'installation.settings.update');
    const facts = companyFacts(scenario, {
      roles: [everything],
      rolePermissions: [...companyCodes.map((code) => grantTo(everything, code)), forgedInstallationGrant],
      assignments: [assignCompanyWide(everything, scenario.membership)],
    });
    for (const permission of TEST_CATALOG.permissions.filter((candidate) => candidate.authorityScope === 'INSTALLATION')) {
      const request = requestFor(scenario.user, permission.code, { kind: 'INSTALLATION' });
      expectDenied(evaluate(factsFor(request, facts)), 'no-installation-authority');
      expectDenied(evaluate(factsFor(request, facts, { installation: { user: scenario.user, grants: [] } })), 'permission-not-granted');
    }
    expectDenied(evaluate(factsFor(requestFor(scenario.user, 'installation.settings.update', companyTarget(scenario.company)), facts)), 'scope-mismatch');
    const suspended = changeUserStatus(scenario.user, 'SUSPENDED', UPDATED_AT);
    const grant = { userId: scenario.user.id, permissionCode: parsePermissionCode('installation.settings.read') };
    const installationRequest = requestFor(scenario.user, 'installation.settings.read', { kind: 'INSTALLATION' });
    expectDenied(evaluate(factsFor(installationRequest, undefined, { installation: { user: suspended, grants: [grant] } })), 'user-not-active');
    const stranger = tenantScenario().user;
    expectDenied(evaluate(factsFor(installationRequest, undefined, { installation: { user: scenario.user, grants: [grant, { ...grant, userId: stranger.id }] } })), 'inconsistent-facts');
  });

  it('D53 refuses without disclosing internal details externally', () => {
    const { company, facts, role, user } = companyWideGrant(['company.read']);
    const other = tenantScenario();
    const decisions: AuthorizationDecision[] = [
      evaluate(factsFor(requestFor(user, 'reports.export', companyTarget(company)), facts)),
      evaluate(factsFor(requestFor(user, 'company.update', companyTarget(company)), facts)),
      evaluate(factsFor(requestFor(user, 'company.read', companyTarget(other.company)), undefined)),
      evaluate(factsFor(requestFor(user, 'company.read', companyTarget(other.company)), facts)),
      evaluate(factsFor(requestFor(user, 'installation.settings.read', { kind: 'INSTALLATION' }), facts)),
      evaluate(factsFor(requestFor(user, 'branches.read', branchTarget(company, other.branchA)), facts)),
    ];
    const reasons = new Set(decisions.map((decision) => (decision.outcome === 'DENIED' ? decision.reason : 'granted')));
    expect(reasons.size).toBe(decisions.length);
    for (const decision of decisions) {
      expect(decision.outcome).toBe('DENIED');
      expect(Object.keys(decision).sort()).toEqual(['outcome', 'reason']);
      expect(AUTHORIZATION_DENIAL_REASONS).toContain((decision as { reason: string }).reason);
      const external = toExternalDomainEvaluationResponse(decision);
      expect(external).toEqual({ allowed: false, error: 'access-denied' });
      const serialized = JSON.stringify(external);
      for (const secret of [user.id, user.username, company.id, company.tenantId, other.company.tenantId, role.id, role.code, 'reason']) {
        expect(serialized).not.toContain(secret);
      }
    }
    expect(JSON.stringify(decisions)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    // E1.07-D1-R1: só uma concessão genuína sobre o catálogo OFICIAL produz `allowed: true`; a mesma
    // concessão sobre o catálogo experimental dos testes produz a recusa genérica.
    expect(toExternalDomainEvaluationResponse(evaluate(officialFactsFor(requestFor(user, 'company.read', companyTarget(company)), facts)))).toEqual({ allowed: true });
    expect(toExternalDomainEvaluationResponse(evaluate(factsFor(requestFor(user, 'company.read', companyTarget(company)), facts)))).toEqual({ allowed: false, error: 'access-denied' });
  });

  it('D54 revalidates identity, membership and branch status in each evaluation', () => {
    const { company, facts, user } = companyWideGrant(['company.read', 'branches.read']);
    const read = requestFor(user, 'company.read', companyTarget(company));
    expectGranted(evaluate(factsFor(read, facts)));
    const suspendedUser = { ...facts, membership: { ...facts.membership, user: changeUserStatus(user, 'SUSPENDED', UPDATED_AT) } };
    expectDenied(evaluate(factsFor(read, suspendedUser)), 'user-not-active');
    const membership = facts.membership.membership;
    if (membership === undefined) throw new Error('cenário sem associação');
    const lostMembership = { ...facts, membership: { ...facts.membership, membership: deactivateCompanyMembership(membership, UPDATED_AT) } };
    expectDenied(evaluate(factsFor(read, lostMembership)), 'membership-inactive');
    const branchA = facts.membership.branches[0];
    if (branchA === undefined) throw new Error('cenário sem estabelecimentos');
    const closed = { ...facts, membership: { ...facts.membership, branches: [deactivateBranch(branchA, UPDATED_AT), ...facts.membership.branches.slice(1)] } };
    expectDenied(evaluate(factsFor(requestFor(user, 'branches.read', branchTarget(company, branchA)), closed)), 'branch-out-of-scope');
  });

  it('D55 refuses commercial operations in non-operational companies but keeps administration', () => {
    const scenario = tenantScenario({ companyStatus: 'DRAFT' });
    const role = newRole(scenario.company);
    const facts = companyFacts(scenario, { roles: [role], rolePermissions: [grantTo(role, 'sales.create'), grantTo(role, 'company.read')], assignments: [assignCompanyWide(role, scenario.membership)] });
    expectGranted(evaluate(factsFor(requestFor(scenario.user, 'company.read', companyTarget(scenario.company)), facts)));
    expectDenied(evaluate(factsFor(requestFor(scenario.user, 'sales.create', branchTarget(scenario.company, scenario.branchA)), facts)), 'company-not-operational');
  });

  it('D56 fails closed on malformed facts', () => {
    const { company, facts, user } = companyWideGrant(['company.read']);
    const request = requestFor(user, 'company.read', companyTarget(company));
    // E1.07-D1-R1: um catálogo fabricado já não é consultado (recusa `untrusted-catalog` antes de
    // `find`); a falha fechada perante uma excepção é exercitada com um pedido malformado.
    let consulted = false;
    const throwing = { ...TEST_CATALOG, find: () => { consulted = true; throw new Error('falha simulada'); } } as PermissionCatalog;
    expectDenied(evaluate(factsFor(request, facts, { catalog: throwing })), 'untrusted-catalog');
    expect(consulted).toBe(false);
    const malformed = { userId: request.userId, permissionCode: request.permissionCode, get scope(): never { throw new Error('falha simulada'); } } as AuthorizationRequest;
    expectDenied(evaluate(factsFor(malformed, facts)), 'inconsistent-facts');
    expectDenied(evaluate(factsFor(request, { ...facts, roles: undefined as never })), 'inconsistent-facts');
    expectDenied(evaluate(factsFor(request, { ...facts, membership: { ...facts.membership, user: tenantScenario().user } })), 'inconsistent-facts');
  });

  it('D57 returns frozen decisions that are not tenant contexts', () => {
    const { company, facts, user } = companyWideGrant(['company.read']);
    const decision = evaluate(factsFor(requestFor(user, 'company.read', companyTarget(company)), facts));
    expectGranted(decision);
    expect(Object.isFrozen(decision)).toBe(true);
    if (decision.outcome !== 'GRANTED') throw new Error('esperada concessão');
    expect(Object.isFrozen(decision.grants)).toBe(true);
    expect(decision.grants.every((grant) => Object.isFrozen(grant))).toBe(true);
    expect(Object.keys(decision).sort()).toEqual(['grants', 'outcome', 'permissionCode']);
    expect(() => assertTenantContext(decision)).toThrow();
    expect(JSON.stringify(decision)).not.toContain(company.tenantId);
  });
});

describe('E1.07-D1 boundaries', () => {
  it('D60 adds no migrations and keeps the checksums of migrations 1 to 5', () => {
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5]);
    expect(MIGRATIONS.map(migrationChecksum)).toEqual([
      'c70164d253bed3637177a1a434282a3fb9e4d16c294134dd2f6ec61dbf734b61',
      'b05636332e82baa7250873473b7c91fd0a571ec07e2b90b7ee2d236fd9bfc2d0',
      '340d886e73aae09527f46db3e3dbecfa9afc7b9fafa126e0267cea9d1d1a1f53',
      '95e09724388a7dce7e6c5588a55f3c35ee98f7a7202356885720dd7d1cdedf6e',
      'd404e58df245f3a42ed9970be395b0ae90cc7b8d0c08cdcb14d5da871823b7a4',
    ]);
    for (const migration of MIGRATIONS) expect(migration.sql).not.toMatch(/\b(roles?|permissions?|role_assignments)\b/i);
  });

  it('D61 leaves authentication, sessions and persistence without RBAC integration', () => {
    const integration = [
      ...sources(path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src')),
      ...sources(path.join(REPOSITORY_ROOT, 'packages', 'database', 'src')),
    ];
    expect(integration.length).toBeGreaterThan(10);
    for (const file of integration) expect(readFileSync(file, 'utf8'), file).not.toMatch(RBAC_SYMBOLS);
  });

  it('D62 keeps the contracts free of persistence, network, HTTP and Electron, and away from the desktop', () => {
    for (const file of AUTHORIZATION_SOURCES) {
      const text = readFileSync(file, 'utf8');
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
      expect(imports.length, file).toBeGreaterThan(0);
      for (const specifier of imports) expect(specifier, file).toMatch(/^\.\/[a-z-]+\.js$/);
      expect(text).not.toMatch(/better-sqlite3|\bSELECT\b|\bINSERT\b|CREATE TABLE|ipcMain|ipcRenderer|fastify|node:/);
    }
    for (const file of sources(path.join(REPOSITORY_ROOT, 'apps', 'desktop', 'src'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(RBAC_SYMBOLS);
    }
  });

  it('D63 grants no privilege from role names, role codes or usernames alone', () => {
    const scenario = tenantScenario({ membership: {} });
    const names = [
      ['ADMIN', 'Administrador'],
      ['SUPERUSER', 'Superutilizador'],
      ['ROOT', 'root'],
      ['KIL', 'Suporte KIL'],
      ['INSTALACAO', 'Administrador da instalação'],
    ] as const;
    const roles = names.map(([code, name]) => newRole(scenario.company, { code, name }));
    const facts = companyFacts(scenario, { roles, assignments: roles.map((role) => assignCompanyWide(role, scenario.membership)) });
    for (const permission of TEST_CATALOG.permissions) {
      const target =
        permission.authorityScope === 'INSTALLATION'
          ? ({ kind: 'INSTALLATION' } as const)
          : permission.authorityScope === 'COMPANY'
            ? companyTarget(scenario.company)
            : branchTarget(scenario.company, scenario.branchA);
      expect(isGrantedEvaluation(evaluate(factsFor(requestFor(scenario.user, permission.code, target), facts))), permission.code).toBe(false);
    }
    const request = requestFor(scenario.user, 'company.read', companyTarget(scenario.company));
    expect(listApplicablePermissionCodes({ catalog: TEST_CATALOG, userId: scenario.user.id, scope: request.scope, company: facts })).toEqual([]);
  });

  it('D64 emits no authenticated context from arbitrary data and is not wired into the service', () => {
    for (const file of AUTHORIZATION_SOURCES) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/createTenantContext|TenantContextInput|actorId|correlationId/);
    }
    const { company, facts, user } = companyWideGrant(['company.read']);
    const decision = evaluate(officialFactsFor(requestFor(user, 'company.read', companyTarget(company)), facts));
    expect(isOfficialDomainGrant(decision)).toBe(true);
    expect(() => assertTenantContext(decision)).toThrow();
    expect(() => assertTenantContext(toExternalDomainEvaluationResponse(decision))).toThrow();
    expect(() => assertTenantContext(inspectDomainDecision(decision))).toThrow();
    const service = sources(path.join(REPOSITORY_ROOT, 'services', 'local-api', 'src'));
    for (const file of service) expect(readFileSync(file, 'utf8')).not.toMatch(/evaluateAuthorizationFacts|AuthorizationRequest/);
  });
});
