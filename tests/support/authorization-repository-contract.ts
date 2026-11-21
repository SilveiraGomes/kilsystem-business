import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RolePermissionDiagnostics, SqliteDatabase } from '../../packages/database/src/index';
import {
  AuthorizationContractError,
  createBranch,
  createRole,
  createRoleAssignment,
  deactivateBranch,
  deactivateBranchMembership,
  deactivateCompanyMembership,
  deactivateRole,
  deactivateRoleAssignment,
  DomainValidationError,
  inspectDomainDecision,
  isOfficialDomainGrant,
  OFFICIAL_PERMISSION_CATALOG,
  parsePermissionCode,
  RecordConflictError,
  RecordNotFoundError,
  TenantContextError,
  TenantMismatchError,
  toExternalDomainEvaluationResponse,
  type AuthorizationDecision,
  type AuthorizationRequestInput,
  type AuthorizationScopeInput,
  type Branch,
  type Company,
  type CompanyMembership,
  type Role,
  type RolePermission,
  type RoleAssignmentRepository,
  type RolePermissionRepository,
  type RoleRepository,
  type TenantContext,
  type User,
} from '../../packages/shared-types/src/index';
import type { InternalDomainAuthorizationEvaluator } from '../../services/local-api/src/authorization/domain-authorization-engine';
import {
  assignAtBranch,
  assignCompanyWide,
  branchTarget,
  companyTarget,
  grantTo,
  newRole,
  TEST_CATALOG,
} from './authorization-fixtures';
import { branchInput, contextFor, CREATED_AT, newCompany, newId, UPDATED_AT } from './fixtures';
import { newBranchMembership, newCompanyMembership, newUser } from './identity-fixtures';
import type { IdentityRepositories } from './membership-repository-contract';

/*
 * Suite de contrato da persistência RBAC e do motor interno (E1.07-D2, D-183). Corre sobre SQLite
 * real em ficheiro temporário e através do serviço local em `READY`; nunca sobre mocks. Os dados são
 * fictícios. Identificadores RB (repositórios) e RE (avaliação interna).
 */

export interface AuthorizationRepositories extends IdentityRepositories {
  readonly roles: RoleRepository;
  readonly rolePermissions: RolePermissionRepository;
  readonly roleAssignments: RoleAssignmentRepository;
  readonly diagnostics: RolePermissionDiagnostics;
  readonly evaluator: InternalDomainAuthorizationEvaluator;
  /** Escrita SQL directa na base de teste (dados fictícios), pela ligação que a detém. */
  readonly sql: <T>(work: (database: SqliteDatabase) => T) => T;
}

export interface AuthorizationRepositoryHarness extends AuthorizationRepositories {
  readonly dispose?: () => void | Promise<void>;
}

interface Scenario {
  readonly companyA: Company;
  readonly companyB: Company;
  readonly contextA: TenantContext;
  readonly contextB: TenantContext;
  readonly northA: Branch;
  readonly southA: Branch;
  readonly closedA: Branch;
  readonly storeB: Branch;
  /** `COMPANY_WIDE` em A. */
  readonly alice: User;
  readonly aliceAtA: CompanyMembership;
  /** `BRANCH_RESTRICTED` em A, com `northA` e `southA`. */
  readonly carol: User;
  readonly carolAtA: CompanyMembership;
  /** `COMPANY_WIDE` em B. */
  readonly dave: User;
  readonly daveAtB: CompanyMembership;
  /** Sem associações. */
  readonly bob: User;
}

const seed = async (repositories: AuthorizationRepositories): Promise<Scenario> => {
  const companyA = newCompany({ legalName: 'Tenant A, Lda.' });
  const companyB = newCompany({ legalName: 'Tenant B, Lda.' });
  const contextA = contextFor(companyA.tenantId);
  const contextB = contextFor(companyB.tenantId);
  const northA = createBranch(branchInput(companyA, { code: 'A-NORTE' }));
  const southA = createBranch(branchInput(companyA, { code: 'A-SUL', sectorType: 'PHARMACY' }));
  const closedA = createBranch(branchInput(companyA, { code: 'A-FECHADA', status: 'INACTIVE' }));
  const storeB = createBranch(branchInput(companyB, { code: 'B-LOJA' }));
  await repositories.companies.create(contextA, companyA);
  await repositories.companies.create(contextB, companyB);
  for (const branch of [northA, southA, closedA]) await repositories.branches.create(contextA, branch);
  await repositories.branches.create(contextB, storeB);

  const alice = newUser();
  const carol = newUser();
  const dave = newUser();
  const bob = newUser();
  for (const user of [alice, carol, dave, bob]) await repositories.users.create(user);
  const aliceAtA = newCompanyMembership(alice, companyA);
  const carolAtA = newCompanyMembership(carol, companyA, { scope: 'BRANCH_RESTRICTED' });
  const daveAtB = newCompanyMembership(dave, companyB);
  await repositories.companyMemberships.create(contextA, aliceAtA);
  await repositories.companyMemberships.create(contextA, carolAtA);
  await repositories.companyMemberships.create(contextB, daveAtB);
  for (const branch of [northA, southA]) {
    await repositories.branchMemberships.create(contextA, newBranchMembership(carolAtA, branch));
  }
  return {
    alice,
    aliceAtA,
    bob,
    carol,
    carolAtA,
    closedA,
    companyA,
    companyB,
    contextA,
    contextB,
    dave,
    daveAtB,
    northA,
    southA,
    storeB,
  };
};

const expectConflict = async (operation: Promise<unknown>, reason: string): Promise<void> => {
  await expect(operation).rejects.toBeInstanceOf(RecordConflictError);
  await expect(operation).rejects.toMatchObject({ reason });
};

const expectNotFound = async (operation: Promise<unknown>, kind: string): Promise<void> => {
  await expect(operation).rejects.toBeInstanceOf(RecordNotFoundError);
  await expect(operation).rejects.toMatchObject({ kind });
};

const expectContractError = async (operation: Promise<unknown>, reason: string): Promise<void> => {
  await expect(operation).rejects.toBeInstanceOf(AuthorizationContractError);
  await expect(operation).rejects.toMatchObject({ reason });
};

const deniedWith = (decision: AuthorizationDecision): string | undefined =>
  decision.outcome === 'DENIED' ? decision.reason : undefined;

export const describeAuthorizationRepositoryContract = (
  label: string,
  createHarness: () => AuthorizationRepositoryHarness | Promise<AuthorizationRepositoryHarness>,
): void => {
  describe(`RBAC persistence contract (E1.07-D2): ${label}`, () => {
    let harness: AuthorizationRepositoryHarness;
    let s: Scenario;

    beforeEach(async () => {
      harness = await createHarness();
      s = await seed(harness);
    });

    afterEach(async () => {
      await harness.dispose?.();
    });

    const evaluate = (user: User, permissionCode: string, scope: AuthorizationScopeInput) =>
      harness.evaluator.evaluate({ permissionCode, scope, userId: user.id });

    /** Perfil activo em A com as permissões indicadas. */
    const roleWith = async (codes: readonly string[], overrides: Parameters<typeof newRole>[1] = {}): Promise<Role> => {
      const role = newRole(s.companyA, { code: `P-${newId().slice(0, 8)}`, ...overrides });
      await harness.roles.create(s.contextA, role);
      for (const code of codes) await harness.rolePermissions.add(s.contextA, grantTo(role, code));
      return role;
    };

    describe('roles', () => {
      it('[RB01] creates, reads by id and by normalised code, and lists by company within the tenant', async () => {
        const role = newRole(s.companyA, { code: '  gerente-loja ', description: 'Perfil fictício' });
        await harness.roles.create(s.contextA, role);
        await expect(harness.roles.findById(s.contextA, role.id)).resolves.toEqual(role);
        await expect(harness.roles.findByCode(s.contextA, 'Gerente-Loja')).resolves.toEqual(role);
        await expect(harness.roles.listByCompany(s.contextA, s.companyA.id)).resolves.toEqual([role]);
        expect(role.code).toBe('GERENTE-LOJA');
      });

      it('[RB02] isolates roles between tenants (D-020) and allows the same code in another company', async () => {
        const roleA = newRole(s.companyA, { code: 'CAIXA' });
        const roleB = newRole(s.companyB, { code: 'CAIXA' });
        await harness.roles.create(s.contextA, roleA);
        await harness.roles.create(s.contextB, roleB);
        await expect(harness.roles.findById(s.contextB, roleA.id)).resolves.toBeUndefined();
        await expect(harness.roles.findByCode(s.contextB, 'CAIXA')).resolves.toEqual(roleB);
        await expect(harness.roles.listByCompany(s.contextB, s.companyA.id)).resolves.toEqual([]);
        await expectNotFound(harness.roles.update(s.contextB, { ...roleA, tenantId: s.companyB.tenantId }), 'Role');
        await expect(harness.roles.update(s.contextB, roleA)).rejects.toBeInstanceOf(TenantMismatchError);
        await expect(harness.roles.create(s.contextB, newRole(s.companyA))).rejects.toBeInstanceOf(TenantMismatchError);
      });

      it('[RB03] refuses duplicates, unknown companies, missing contexts and forged records', async () => {
        const role = newRole(s.companyA, { code: 'SUPERVISOR' });
        await harness.roles.create(s.contextA, role);
        await expectConflict(harness.roles.create(s.contextA, newRole(s.companyA, { code: 'supervisor' })), 'duplicate-role-code');
        await expectConflict(harness.roles.create(s.contextA, newRole(s.companyA, { code: 'OUTRO', id: role.id })), 'duplicate-id');
        const orphan = newCompany();
        await expectNotFound(harness.roles.create(contextFor(orphan.tenantId), newRole(orphan)), 'Company');
        await expect(harness.roles.create(undefined as unknown as TenantContext, role)).rejects.toBeInstanceOf(TenantContextError);
        const forged = { ...role, id: newId(), code: 'Inválido!' } as Role;
        await expect(harness.roles.create(s.contextA, forged)).rejects.toBeInstanceOf(DomainValidationError);
      });

      it('[RB04] changes only presentation and status; code, company and creation are immutable', async () => {
        const role = newRole(s.companyA, { code: 'AUDITOR' });
        await harness.roles.create(s.contextA, role);
        const renamed = createRole({ ...role, name: 'Auditor interno', status: 'INACTIVE', updatedAt: UPDATED_AT });
        await harness.roles.update(s.contextA, renamed);
        await expect(harness.roles.findById(s.contextA, role.id)).resolves.toEqual(renamed);
        await expectConflict(harness.roles.update(s.contextA, { ...renamed, code: 'OUTRO' }), 'immutable-field');
        await expectConflict(harness.roles.update(s.contextA, createRole({ ...renamed, createdAt: UPDATED_AT })), 'immutable-field');
        await expectNotFound(harness.roles.update(s.contextA, newRole(s.companyA)), 'Role');
      });
    });

    describe('role permissions', () => {
      it('[RB05] grants only official company permissions, once, and lists them by role within the tenant', async () => {
        const role = newRole(s.companyA, { code: 'LEITOR' });
        await harness.roles.create(s.contextA, role);
        await harness.rolePermissions.add(s.contextA, grantTo(role, 'company.read'));
        await harness.rolePermissions.add(s.contextA, grantTo(role, 'branches.read'));
        await expect(harness.rolePermissions.listByRole(s.contextA, role.id)).resolves.toEqual([
          grantTo(role, 'branches.read'),
          grantTo(role, 'company.read'),
        ]);
        await expectConflict(harness.rolePermissions.add(s.contextA, grantTo(role, 'company.read')), 'duplicate-role-permission');
        await expect(harness.rolePermissions.listByRole(s.contextB, role.id)).resolves.toEqual([]);
      });

      it('[RB06] refuses unknown, experimental and installation permissions (official catalogue only)', async () => {
        const role = newRole(s.companyA, { code: 'TENTATIVA' });
        await harness.roles.create(s.contextA, role);
        // `sales.create` existe só no catálogo experimental dos testes.
        expect(TEST_CATALOG.isRegistered(parsePermissionCode('sales.create'))).toBe(true);
        await expectContractError(harness.rolePermissions.add(s.contextA, grantTo(role, 'sales.create')), 'unknown-permission');
        await expectContractError(harness.rolePermissions.add(s.contextA, grantTo(role, 'company.delete')), 'unknown-permission');
        await expectContractError(
          harness.rolePermissions.add(s.contextA, grantTo(role, 'installation.settings.read')),
          'permission-authority-incompatible',
        );
        // Um objecto forjado com wildcard é recusado pela revalidação do repositório.
        const forged = { ...grantTo(role, 'company.read'), permissionCode: 'company.*' } as RolePermission;
        await expect(harness.rolePermissions.add(s.contextA, forged)).rejects.toBeInstanceOf(DomainValidationError);
        await expect(harness.rolePermissions.listByRole(s.contextA, role.id)).resolves.toEqual([]);
      });

      it('[RB07] refuses grants on roles of other tenants and removes grants explicitly', async () => {
        const roleB = newRole(s.companyB, { code: 'GERENTE' });
        await harness.roles.create(s.contextB, roleB);
        await expectNotFound(
          harness.rolePermissions.add(s.contextA, { ...grantTo(roleB, 'company.read'), tenantId: s.companyA.tenantId }),
          'Role',
        );
        await expect(harness.rolePermissions.add(s.contextA, grantTo(roleB, 'company.read'))).rejects.toBeInstanceOf(
          TenantMismatchError,
        );
        await harness.rolePermissions.add(s.contextB, grantTo(roleB, 'company.read'));
        await expectNotFound(harness.rolePermissions.remove(s.contextA, roleB.id, parsePermissionCode('company.read')), 'Role');
        await harness.rolePermissions.remove(s.contextB, roleB.id, parsePermissionCode('company.read'));
        await expect(harness.rolePermissions.listByRole(s.contextB, roleB.id)).resolves.toEqual([]);
        await expectNotFound(harness.rolePermissions.remove(s.contextB, roleB.id, parsePermissionCode('company.read')), 'Role');
      });
    });

    describe('role assignments', () => {
      it('[RB08] assigns company-wide and per branch, reads within the tenant and lists by membership and role', async () => {
        const role = await roleWith(['company.read', 'branches.read']);
        const wide = assignCompanyWide(role, s.aliceAtA);
        const atNorth = assignAtBranch(role, s.carolAtA, s.northA);
        const atSouth = assignAtBranch(role, s.carolAtA, s.southA);
        await harness.roleAssignments.create(s.contextA, wide);
        await harness.roleAssignments.create(s.contextA, atNorth);
        await harness.roleAssignments.create(s.contextA, atSouth);
        await expect(harness.roleAssignments.findById(s.contextA, wide.id)).resolves.toEqual(wide);
        await expect(harness.roleAssignments.findById(s.contextB, wide.id)).resolves.toBeUndefined();
        await expect(harness.roleAssignments.listByCompanyMembership(s.contextA, s.carolAtA.id)).resolves.toHaveLength(2);
        await expect(harness.roleAssignments.listByRole(s.contextA, role.id)).resolves.toHaveLength(3);
        await expect(harness.roleAssignments.listByRole(s.contextB, role.id)).resolves.toEqual([]);
      });

      it('[RB09] keeps assignments unique per (membership, role, scope, branch) in any state, including COMPANY_WIDE', async () => {
        const role = await roleWith(['company.read']);
        const wide = assignCompanyWide(role, s.aliceAtA);
        await harness.roleAssignments.create(s.contextA, wide);
        await expectConflict(harness.roleAssignments.create(s.contextA, assignCompanyWide(role, s.aliceAtA)), 'duplicate-role-assignment');
        await harness.roleAssignments.update(s.contextA, deactivateRoleAssignment(wide, UPDATED_AT));
        await expectConflict(harness.roleAssignments.create(s.contextA, assignCompanyWide(role, s.aliceAtA)), 'duplicate-role-assignment');
        const atNorth = assignAtBranch(role, s.carolAtA, s.northA);
        await harness.roleAssignments.create(s.contextA, atNorth);
        await expectConflict(
          harness.roleAssignments.create(s.contextA, assignAtBranch(role, s.carolAtA, s.northA)),
          'duplicate-role-assignment',
        );
        await expectConflict(harness.roleAssignments.create(s.contextA, { ...atNorth, scope: 'BRANCH' }), 'duplicate-id');
        await expect(harness.roleAssignments.listByRole(s.contextA, role.id)).resolves.toHaveLength(2);
      });

      it('[RB10] refuses references from other tenants or that do not exist', async () => {
        const roleA = await roleWith(['company.read']);
        const roleB = newRole(s.companyB, { code: 'B-PERFIL' });
        await harness.roles.create(s.contextB, roleB);
        // Perfil de B, associação de A.
        await expectNotFound(
          harness.roleAssignments.create(s.contextA, assignCompanyWide(roleB, s.aliceAtA, { tenantId: s.companyA.tenantId, companyId: s.companyA.id })),
          'Role',
        );
        // Associação de B, perfil de A.
        await expectNotFound(
          harness.roleAssignments.create(
            s.contextA,
            assignCompanyWide(roleA, s.daveAtB, { tenantId: s.companyA.tenantId, companyId: s.companyA.id }),
          ),
          'CompanyMembership',
        );
        // Estabelecimento de B numa atribuição de A.
        await expectNotFound(harness.roleAssignments.create(s.contextA, assignAtBranch(roleA, s.aliceAtA, s.storeB)), 'Branch');
        await expectNotFound(
          harness.roleAssignments.create(s.contextA, assignCompanyWide({ ...roleA, id: newId() } as Role, s.aliceAtA)),
          'Role',
        );
        await expect(harness.roleAssignments.create(s.contextB, assignCompanyWide(roleA, s.aliceAtA))).rejects.toBeInstanceOf(
          TenantMismatchError,
        );
        await expect(harness.roleAssignments.listByCompanyMembership(s.contextA, s.aliceAtA.id)).resolves.toEqual([]);
      });

      it('[RB11] refuses inactive roles, memberships and branches and scopes beyond the membership', async () => {
        const inactive = await roleWith(['company.read'], { status: 'INACTIVE' });
        const role = await roleWith(['company.read', 'branches.read']);
        await expectContractError(harness.roleAssignments.create(s.contextA, assignCompanyWide(inactive, s.aliceAtA)), 'role-inactive');
        await expectContractError(
          harness.roleAssignments.create(s.contextA, assignCompanyWide(role, s.carolAtA)),
          'assignment-scope-exceeds-membership',
        );
        await expectContractError(harness.roleAssignments.create(s.contextA, assignAtBranch(role, s.aliceAtA, s.closedA)), 'branch-inactive');
        const outsider = createBranch(branchInput(s.companyA, { code: 'A-OESTE' }));
        await harness.branches.create(s.contextA, outsider);
        await expectContractError(
          harness.roleAssignments.create(s.contextA, assignAtBranch(role, s.carolAtA, outsider)),
          'assignment-scope-exceeds-membership',
        );
        await harness.companyMemberships.update(s.contextA, deactivateCompanyMembership(s.aliceAtA, UPDATED_AT));
        await expectContractError(harness.roleAssignments.create(s.contextA, assignCompanyWide(role, s.aliceAtA)), 'membership-inactive');
      });

      it('[RB12] changes only status; reactivation revalidates the current facts', async () => {
        const role = await roleWith(['company.read']);
        const wide = assignCompanyWide(role, s.aliceAtA);
        await harness.roleAssignments.create(s.contextA, wide);
        await expectConflict(
          harness.roleAssignments.update(s.contextA, createRoleAssignment({ ...wide, roleId: (await roleWith([])).id })),
          'immutable-field',
        );
        await expectConflict(
          harness.roleAssignments.update(s.contextA, createRoleAssignment({ ...wide, createdAt: '2026-11-13T09:00:00.000Z' })),
          'immutable-field',
        );
        const inactive = deactivateRoleAssignment(wide, UPDATED_AT);
        await harness.roleAssignments.update(s.contextA, inactive);
        await harness.roles.update(s.contextA, deactivateRole(role, UPDATED_AT));
        await expectContractError(
          harness.roleAssignments.update(s.contextA, { ...inactive, status: 'ACTIVE' }),
          'role-inactive',
        );
        await harness.roles.update(s.contextA, createRole({ ...role, status: 'ACTIVE', updatedAt: UPDATED_AT }));
        await harness.roleAssignments.update(s.contextA, { ...inactive, status: 'ACTIVE' });
        await expect(harness.roleAssignments.findById(s.contextA, wide.id)).resolves.toMatchObject({ status: 'ACTIVE' });
        await expectNotFound(harness.roleAssignments.update(s.contextB, { ...wide, tenantId: s.companyB.tenantId, companyId: s.companyB.id }), 'RoleAssignment');
      });

      it('[RB13] serialises concurrent duplicate writes: exactly one assignment is stored', async () => {
        const role = await roleWith(['company.read']);
        const attempts = Array.from({ length: 5 }, () => harness.roleAssignments.create(s.contextA, assignCompanyWide(role, s.aliceAtA)));
        const results = await Promise.allSettled(attempts);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        for (const result of results.filter((entry): entry is PromiseRejectedResult => entry.status === 'rejected')) {
          expect(result.reason).toMatchObject({ reason: 'duplicate-role-assignment' });
        }
        await expect(harness.roleAssignments.listByRole(s.contextA, role.id)).resolves.toHaveLength(1);
      });
    });

    describe('internal domain evaluation over persisted facts', () => {
      it('[RE01] grants only what the persisted official grants allow, with genuine official provenance', async () => {
        const role = await roleWith(['company.read']);
        const assignment = assignCompanyWide(role, s.aliceAtA);
        await harness.roleAssignments.create(s.contextA, assignment);
        const decision = await evaluate(s.alice, 'company.read', companyTarget(s.companyA));
        expect(isOfficialDomainGrant(decision)).toBe(true);
        expect(inspectDomainDecision(decision)).toEqual({ catalog: 'OFFICIAL', outcome: 'GRANTED', recognized: true });
        expect(decision).toMatchObject({
          grants: [{ assignmentScope: 'COMPANY_WIDE', permissionCode: 'company.read', roleAssignmentId: assignment.id, roleId: role.id, source: 'ROLE_ASSIGNMENT' }],
        });
        expect(toExternalDomainEvaluationResponse(decision)).toEqual({ allowed: true });
        // Recusa por omissão: nenhuma concessão para `company.update`.
        expect(deniedWith(await evaluate(s.alice, 'company.update', companyTarget(s.companyA)))).toBe('permission-not-granted');
        expect(deniedWith(await evaluate(s.bob, 'company.read', companyTarget(s.companyA)))).toBe('no-membership');
      });

      it('[RE02] isolates tenants: grants of one tenant never apply to another', async () => {
        const role = await roleWith(['company.read']);
        await harness.roleAssignments.create(s.contextA, assignCompanyWide(role, s.aliceAtA));
        expect(deniedWith(await evaluate(s.alice, 'company.read', companyTarget(s.companyB)))).toBe('no-membership');
        expect(deniedWith(await evaluate(s.dave, 'company.read', companyTarget(s.companyA)))).toBe('no-membership');
        // Tenant de A com a empresa de B: a empresa não existe nesse tenant.
        const mixed = { companyId: s.companyB.id, kind: 'COMPANY', tenantId: s.companyA.tenantId } as const;
        expect(deniedWith(await evaluate(s.alice, 'company.read', mixed))).toBe('no-membership');
        const roleB = newRole(s.companyB, { code: 'B-LEITOR' });
        await harness.roles.create(s.contextB, roleB);
        await harness.rolePermissions.add(s.contextB, grantTo(roleB, 'company.read'));
        await harness.roleAssignments.create(s.contextB, assignCompanyWide(roleB, s.daveAtB));
        expect(isOfficialDomainGrant(await evaluate(s.dave, 'company.read', companyTarget(s.companyB)))).toBe(true);
        expect(isOfficialDomainGrant(await evaluate(s.alice, 'company.read', companyTarget(s.companyA)))).toBe(true);
      });

      it('[RE03] isolates branches: a branch assignment applies only at that branch, never at the company level', async () => {
        const reader = await roleWith(['branches.read']);
        await harness.roleAssignments.create(s.contextA, assignAtBranch(reader, s.carolAtA, s.northA));
        expect(isOfficialDomainGrant(await evaluate(s.carol, 'branches.read', branchTarget(s.companyA, s.northA)))).toBe(true);
        expect(deniedWith(await evaluate(s.carol, 'branches.read', branchTarget(s.companyA, s.southA)))).toBe('permission-not-granted');
        expect(deniedWith(await evaluate(s.carol, 'branches.read', branchTarget(s.companyA, s.closedA)))).toBe('branch-out-of-scope');
        expect(deniedWith(await evaluate(s.carol, 'branches.read', branchTarget(s.companyA, s.storeB)))).toBe('branch-out-of-scope');
        expect(deniedWith(await evaluate(s.carol, 'branches.read', companyTarget(s.companyA)))).toBe('scope-mismatch');
      });

      it('[RE04] stops granting immediately after deactivating the assignment, role, membership, branch or local membership', async () => {
        const role = await roleWith(['company.read', 'branches.read']);
        const wide = assignCompanyWide(role, s.aliceAtA);
        await harness.roleAssignments.create(s.contextA, wide);
        const atNorth = assignAtBranch(role, s.carolAtA, s.northA);
        await harness.roleAssignments.create(s.contextA, atNorth);
        const granted = async (user: User, code: string, scope: AuthorizationScopeInput) =>
          isOfficialDomainGrant(await evaluate(user, code, scope));
        expect(await granted(s.alice, 'company.read', companyTarget(s.companyA))).toBe(true);
        expect(await granted(s.carol, 'branches.read', branchTarget(s.companyA, s.northA))).toBe(true);

        await harness.roleAssignments.update(s.contextA, deactivateRoleAssignment(wide, UPDATED_AT));
        expect(deniedWith(await evaluate(s.alice, 'company.read', companyTarget(s.companyA)))).toBe('permission-not-granted');
        await harness.roleAssignments.update(s.contextA, { ...deactivateRoleAssignment(wide, UPDATED_AT), status: 'ACTIVE' });
        expect(await granted(s.alice, 'company.read', companyTarget(s.companyA))).toBe(true);

        await harness.roles.update(s.contextA, deactivateRole(role, UPDATED_AT));
        expect(await granted(s.alice, 'company.read', companyTarget(s.companyA))).toBe(false);
        expect(await granted(s.carol, 'branches.read', branchTarget(s.companyA, s.northA))).toBe(false);
        await harness.roles.update(s.contextA, createRole({ ...role, updatedAt: UPDATED_AT }));
        expect(await granted(s.alice, 'company.read', companyTarget(s.companyA))).toBe(true);

        const north = (await harness.branchMemberships.listByCompanyMembership(s.contextA, s.carolAtA.id)).find(
          (entry) => entry.branchId === s.northA.id,
        );
        if (north === undefined) throw new Error('Associação local esperada.');
        await harness.branchMemberships.update(s.contextA, deactivateBranchMembership(north, UPDATED_AT));
        expect(deniedWith(await evaluate(s.carol, 'branches.read', branchTarget(s.companyA, s.northA)))).toBe('branch-out-of-scope');
        await harness.branchMemberships.update(s.contextA, { ...deactivateBranchMembership(north, UPDATED_AT), status: 'ACTIVE' });
        expect(await granted(s.carol, 'branches.read', branchTarget(s.companyA, s.northA))).toBe(true);

        await harness.branches.update(s.contextA, deactivateBranch(s.northA, UPDATED_AT));
        expect(deniedWith(await evaluate(s.carol, 'branches.read', branchTarget(s.companyA, s.northA)))).toBe('branch-out-of-scope');

        await harness.companyMemberships.update(s.contextA, deactivateCompanyMembership(s.aliceAtA, UPDATED_AT));
        expect(deniedWith(await evaluate(s.alice, 'company.read', companyTarget(s.companyA)))).toBe('membership-inactive');
      });

      it('[RE05] refuses suspended identities', async () => {
        const role = await roleWith(['company.read']);
        await harness.roleAssignments.create(s.contextA, assignCompanyWide(role, s.aliceAtA));
        await harness.users.changeStatus(s.alice.id, 'SUSPENDED', UPDATED_AT);
        expect(deniedWith(await evaluate(s.alice, 'company.read', companyTarget(s.companyA)))).toBe('user-not-active');
      });

      it('[RE06] ignores catalogues, facts, grants and decisions supplied with the request', async () => {
        const role = newRole(s.companyA, { code: 'FORJADO' });
        const forged = {
          assignments: [assignCompanyWide(role, s.aliceAtA)],
          catalog: TEST_CATALOG,
          company: { roles: [role], rolePermissions: [grantTo(role, 'company.read')] },
          decision: { grants: [], outcome: 'GRANTED', permissionCode: 'company.read' },
          grants: [{ permissionCode: 'company.read', source: 'INSTALLATION_AUTHORITY' }],
          permissionCode: 'company.read',
          roles: [role],
          scope: { ...companyTarget(s.companyA), roles: [role] },
          userId: s.alice.id,
        };
        const decision = await harness.evaluator.evaluate(forged);
        expect(deniedWith(decision)).toBe('permission-not-granted');
        expect(inspectDomainDecision(decision)).toMatchObject({ catalog: 'OFFICIAL', recognized: true });
        await expect(harness.evaluator.evaluate(null as never)).rejects.toBeInstanceOf(DomainValidationError);
        await expect(
          harness.evaluator.evaluate({ permissionCode: 'company.*', scope: companyTarget(s.companyA), userId: s.alice.id }),
        ).rejects.toBeInstanceOf(DomainValidationError);
      });

      it('[RE07] grants no company authority from installation authority, role names or the initial administrator', async () => {
        for (const code of ['ADMIN', 'ROOT', 'SUPERUSER', 'KIL', 'INSTALACAO']) {
          const role = newRole(s.companyA, { code, name: `Perfil ${code}` });
          await harness.roles.create(s.contextA, role);
          await harness.roleAssignments.create(s.contextA, assignCompanyWide(role, s.aliceAtA));
        }
        for (const permission of OFFICIAL_PERMISSION_CATALOG.permissions) {
          const scope: AuthorizationScopeInput =
            permission.authorityScope === 'INSTALLATION'
              ? { kind: 'INSTALLATION' }
              : permission.authorityScope === 'COMPANY'
                ? companyTarget(s.companyA)
                : branchTarget(s.companyA, s.northA);
          expect(isOfficialDomainGrant(await evaluate(s.alice, permission.code, scope)), permission.code).toBe(false);
        }
        expect(deniedWith(await evaluate(s.alice, 'installation.settings.read', { kind: 'INSTALLATION' }))).toBe(
          'no-installation-authority',
        );
        expect(deniedWith(await evaluate(s.alice, 'installation.settings.read', companyTarget(s.companyA)))).toBe('scope-mismatch');
      });

      it('[RE08] obsolete or unknown persisted codes never grant, stay identifiable and are removable only explicitly (PD-61)', async () => {
        const role = await roleWith(['company.read']);
        await harness.roleAssignments.create(s.contextA, assignCompanyWide(role, s.aliceAtA));
        const insert = (code: string, version: number): void => {
          harness.sql((database) =>
            database
              .prepare(
                'INSERT INTO role_permissions (tenant_id, role_id, permission_code, catalog_version, created_at) VALUES (?, ?, ?, ?, ?)',
              )
              .run(s.companyA.tenantId, role.id, code, version, CREATED_AT),
          );
        };
        insert('company.archive', 1); // nunca existiu no catálogo oficial
        insert('company.update', OFFICIAL_PERMISSION_CATALOG.version + 1); // de um catálogo futuro
        expect(deniedWith(await evaluate(s.alice, 'company.archive', companyTarget(s.companyA)))).toBe('unknown-permission');
        expect(deniedWith(await evaluate(s.alice, 'company.update', companyTarget(s.companyA)))).toBe('permission-not-granted');
        expect(isOfficialDomainGrant(await evaluate(s.alice, 'company.read', companyTarget(s.companyA)))).toBe(true);

        await expect(harness.rolePermissions.listByRole(s.contextA, role.id)).resolves.toEqual([
          grantTo(role, 'company.archive'),
          grantTo(role, 'company.read'),
          grantTo(role, 'company.update'),
        ]);
        await expect(harness.diagnostics.listUnrecognized(s.contextA)).resolves.toEqual([
          { catalogVersion: 1, permissionCode: 'company.archive', roleId: role.id, status: 'UNREGISTERED' },
          {
            catalogVersion: OFFICIAL_PERMISSION_CATALOG.version + 1,
            permissionCode: 'company.update',
            roleId: role.id,
            status: 'NEWER_CATALOG',
          },
        ]);
        await expect(harness.diagnostics.listUnrecognized(s.contextB)).resolves.toEqual([]);
        expect(harness.diagnostics.catalogVersion).toBe(OFFICIAL_PERMISSION_CATALOG.version);

        await harness.rolePermissions.remove(s.contextA, role.id, parsePermissionCode('company.archive'));
        await expect(harness.diagnostics.listUnrecognized(s.contextA)).resolves.toHaveLength(1);
      });

      it('[RE09] reads company facts in one consistent tenant-scoped snapshot: other memberships never contribute', async () => {
        const role = await roleWith(['company.read']);
        // Atribuição a outra associação do mesmo tenant: não conta para a Alice.
        const other = newUser();
        await harness.users.create(other);
        const otherAtA = newCompanyMembership(other, s.companyA);
        await harness.companyMemberships.create(s.contextA, otherAtA);
        await harness.roleAssignments.create(s.contextA, assignCompanyWide(role, otherAtA));
        expect(deniedWith(await evaluate(s.alice, 'company.read', companyTarget(s.companyA)))).toBe('permission-not-granted');
        expect(isOfficialDomainGrant(await evaluate(other, 'company.read', companyTarget(s.companyA)))).toBe(true);
      });

      it('[RE10] keeps roles, grants and assignments empty unless explicitly created (no implicit privilege)', async () => {
        await expect(harness.roles.listByCompany(s.contextA, s.companyA.id)).resolves.toEqual([]);
        for (const user of [s.alice, s.carol, s.bob]) {
          for (const permission of OFFICIAL_PERMISSION_CATALOG.permissions) {
            const scope: AuthorizationScopeInput =
              permission.authorityScope === 'INSTALLATION'
                ? { kind: 'INSTALLATION' }
                : permission.authorityScope === 'COMPANY'
                  ? companyTarget(s.companyA)
                  : branchTarget(s.companyA, s.northA);
            expect(isOfficialDomainGrant(await evaluate(user, permission.code, scope))).toBe(false);
          }
        }
        expect(harness.sql((database) => database.prepare('SELECT count(*) FROM roles').pluck().get())).toBe(0);
      });

      it('[RE11] keeps the same role code in two tenants independent', async () => {
        const roleA = newRole(s.companyA, { code: 'GESTOR' });
        const roleB = newRole(s.companyB, { code: 'GESTOR' });
        await harness.roles.create(s.contextA, roleA);
        await harness.roles.create(s.contextB, roleB);
        await harness.rolePermissions.add(s.contextB, grantTo(roleB, 'company.update'));
        await harness.roleAssignments.create(s.contextA, assignCompanyWide(roleA, s.aliceAtA));
        expect(deniedWith(await evaluate(s.alice, 'company.update', companyTarget(s.companyA)))).toBe('permission-not-granted');
      });

      it('[RE12] denies contradictory persisted SQLite facts instead of granting across companies', async () => {
        const role = await roleWith(['company.read']);
        harness.sql((database) => {
          database.pragma('foreign_keys = OFF');
          database.exec('DROP TRIGGER role_assignments_insert_requires_new_eligible_assignment');
          database
            .prepare(
              `INSERT INTO role_assignments
                 (id, tenant_id, company_id, role_id, company_membership_id, scope, branch_id, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'COMPANY_WIDE', NULL, 'ACTIVE', ?, ?)`,
            )
            .run(randomUUID(), s.companyA.tenantId, s.companyB.id, role.id, s.aliceAtA.id, CREATED_AT, CREATED_AT);
        });

        expect(deniedWith(await evaluate(s.alice, 'company.read', companyTarget(s.companyA)))).toBe('inconsistent-facts');
      });

      it('[RE13] snapshots mutable request properties exactly once before reading persisted facts', async () => {
        const role = await roleWith(['company.read']);
        await harness.roleAssignments.create(s.contextA, assignCompanyWide(role, s.aliceAtA));
        const reads = { permissionCode: 0, scope: 0, userId: 0 };
        const request = Object.defineProperties({}, {
          permissionCode: {
            enumerable: true,
            get: () => (++reads.permissionCode === 1 ? 'company.read' : 'company.update'),
          },
          scope: {
            enumerable: true,
            get: () => (++reads.scope === 1 ? companyTarget(s.companyA) : companyTarget(s.companyB)),
          },
          userId: {
            enumerable: true,
            get: () => (++reads.userId === 1 ? s.alice.id : s.bob.id),
          },
        }) as AuthorizationRequestInput;

        expect(isOfficialDomainGrant(await harness.evaluator.evaluate(request))).toBe(true);
        expect(reads).toEqual({ permissionCode: 1, scope: 1, userId: 1 });
      });
    });
  });
};
