import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createBranch,
  createCompanyMembership,
  createUser,
  deactivateBranch,
  deactivateBranchMembership,
  deactivateCompanyMembership,
  DomainValidationError,
  parseBranchMembershipId,
  RecordConflictError,
  RecordNotFoundError,
  TenantContextError,
  TenantMismatchError,
  type Branch,
  type BranchMembershipRepository,
  type BranchRepository,
  type Company,
  type CompanyMembership,
  type CompanyMembershipRepository,
  type CompanyRepository,
  type MembershipScopeReader,
  type TenantContext,
  type User,
  type UserDirectory,
  type UserId,
} from '../../packages/shared-types/src/index';
import { branchInput, contextFor, newCompany, newId, UPDATED_AT } from './fixtures';
import { newBranchMembership, newCompanyMembership, newUser, userInput } from './identity-fixtures';

export interface IdentityRepositories {
  /** Provisionamento interno, sem contexto empresarial (D-087). */
  readonly users: UserDirectory;
  readonly companies: CompanyRepository;
  readonly branches: BranchRepository;
  readonly companyMemberships: CompanyMembershipRepository;
  readonly branchMemberships: BranchMembershipRepository;
  readonly scopes: MembershipScopeReader;
}

export interface IdentityRepositoryHarness extends IdentityRepositories {
  readonly dispose?: () => void | Promise<void>;
}

interface Scenario {
  readonly companyA: Company;
  readonly companyB: Company;
  readonly contextA: TenantContext;
  readonly contextB: TenantContext;
  readonly northA: Branch;
  readonly southA: Branch;
  readonly storeB: Branch;
  /** Associada a A (`COMPANY_WIDE`) e a B (`BRANCH_RESTRICTED`, sem estabelecimentos). */
  readonly alice: User;
  /** Sem associações. */
  readonly bob: User;
  /** Associada apenas a A, com âmbito `BRANCH_RESTRICTED` sobre `northA`. */
  readonly carol: User;
  readonly aliceAtA: CompanyMembership;
  readonly aliceAtB: CompanyMembership;
  readonly carolAtA: CompanyMembership;
}

const seed = async (repositories: IdentityRepositories): Promise<Scenario> => {
  const companyA = newCompany({ legalName: 'Tenant A, Lda.' });
  const companyB = newCompany({ legalName: 'Tenant B, Lda.' });
  const contextA = contextFor(companyA.tenantId);
  const contextB = contextFor(companyB.tenantId);
  const northA = createBranch(branchInput(companyA, { code: 'A-NORTE', sectorType: 'PHARMACY' }));
  const southA = createBranch(branchInput(companyA, { code: 'A-SUL', sectorType: 'RESTAURANT' }));
  const storeB = createBranch(branchInput(companyB, { code: 'B-LOJA' }));
  await repositories.companies.create(contextA, companyA);
  await repositories.companies.create(contextB, companyB);
  for (const branch of [northA, southA]) await repositories.branches.create(contextA, branch);
  await repositories.branches.create(contextB, storeB);

  const alice = newUser({ username: `alice.${newId().slice(0, 8)}` });
  const bob = newUser({ username: `bob.${newId().slice(0, 8)}` });
  const carol = newUser({ username: `carol.${newId().slice(0, 8)}` });
  for (const user of [alice, bob, carol]) await repositories.users.create(user);

  const aliceAtA = newCompanyMembership(alice, companyA);
  const aliceAtB = newCompanyMembership(alice, companyB, { scope: 'BRANCH_RESTRICTED' });
  const carolAtA = newCompanyMembership(carol, companyA, { scope: 'BRANCH_RESTRICTED' });
  await repositories.companyMemberships.create(contextA, aliceAtA);
  await repositories.companyMemberships.create(contextB, aliceAtB);
  await repositories.companyMemberships.create(contextA, carolAtA);
  await repositories.branchMemberships.create(contextA, newBranchMembership(carolAtA, northA));

  return {
    alice,
    aliceAtA,
    aliceAtB,
    bob,
    carol,
    carolAtA,
    companyA,
    companyB,
    contextA,
    contextB,
    northA,
    southA,
    storeB,
  };
};

/**
 * Suite de contrato de identidades e associações (E1.07-A). Qualquer implementação (SQLite
 * directo, serviço local, PostgreSQL futuro) deve passar exactamente estes testes (D-089).
 */
export const describeIdentityRepositoryContract = (
  implementation: string,
  createRepositories: () => IdentityRepositoryHarness | Promise<IdentityRepositoryHarness>,
): void => {
  describe(`Identity and membership contract (${implementation})`, () => {
    let repositories: IdentityRepositoryHarness;
    let s: Scenario;

    beforeEach(async () => {
      repositories = await createRepositories();
      s = await seed(repositories);
    });

    afterEach(async () => {
      await repositories.dispose?.();
    });

    const evaluate = (context: TenantContext, userId: UserId) => repositories.scopes.evaluate(context, userId);

    describe('identity provisioning', () => {
      it('provisions and reads users by identifier only', async () => {
        await expect(repositories.users.findById(s.alice.id)).resolves.toEqual(s.alice);
        await expect(repositories.users.findById(newUser().id)).resolves.toBeUndefined();
        expect(Object.keys(repositories.users).sort()).toEqual(['changeStatus', 'create', 'findById']);
      });

      it('rejects a duplicate identifier and a username repeated after normalisation', async () => {
        await expect(repositories.users.create(newUser({ id: s.bob.id }))).rejects.toMatchObject({
          name: RecordConflictError.name,
          reason: 'duplicate-id',
        });
        await expect(
          repositories.users.create(newUser({ username: `  ${s.alice.username.toUpperCase()} ` })),
        ).rejects.toMatchObject({ name: RecordConflictError.name, reason: 'duplicate-username' });
      });

      it('allows repeated email and phone values (D-085)', async () => {
        const twin = newUser({ email: s.alice.email, phone: s.alice.phone });

        await repositories.users.create(twin);

        await expect(repositories.users.findById(twin.id)).resolves.toEqual(twin);
      });

      it('revalidates forged identities', async () => {
        const forged = { ...newUser(), username: 'Não Normalizado' } as User;

        await expect(repositories.users.create(forged)).rejects.toBeInstanceOf(DomainValidationError);
      });

      it('changes only the status of an identity', async () => {
        const suspended = await repositories.users.changeStatus(s.bob.id, 'SUSPENDED', UPDATED_AT);

        expect(suspended).toEqual({ ...s.bob, status: 'SUSPENDED', updatedAt: UPDATED_AT });
        await expect(repositories.users.findById(s.bob.id)).resolves.toEqual(suspended);
        await expect(repositories.users.changeStatus(newUser().id, 'INACTIVE', UPDATED_AT)).rejects.toMatchObject({
          kind: 'User',
          name: RecordNotFoundError.name,
        });
        await expect(
          repositories.users.changeStatus(s.bob.id, 'DELETED' as never, UPDATED_AT),
        ).rejects.toBeInstanceOf(DomainValidationError);
      });
    });

    describe('company memberships', () => {
      it('gives no company scope to a user without membership', async () => {
        await expect(repositories.companyMemberships.findByUser(s.contextA, s.bob.id)).resolves.toBeUndefined();
        await expect(repositories.companyMemberships.findByUser(s.contextB, s.bob.id)).resolves.toBeUndefined();
        await expect(evaluate(s.contextA, s.bob.id)).resolves.toEqual({ eligible: false, reason: 'no-membership' });
        await expect(evaluate(s.contextB, s.bob.id)).resolves.toEqual({ eligible: false, reason: 'no-membership' });
      });

      it('associates a user to one company', async () => {
        await expect(repositories.companyMemberships.findById(s.contextA, s.carolAtA.id)).resolves.toEqual(s.carolAtA);
        await expect(repositories.companyMemberships.findByUser(s.contextA, s.carol.id)).resolves.toEqual(s.carolAtA);
        await expect(repositories.companyMemberships.findByUser(s.contextB, s.carol.id)).resolves.toBeUndefined();
      });

      it('associates the same user to several companies independently', async () => {
        await expect(repositories.companyMemberships.findByUser(s.contextA, s.alice.id)).resolves.toEqual(s.aliceAtA);
        await expect(repositories.companyMemberships.findByUser(s.contextB, s.alice.id)).resolves.toEqual(s.aliceAtB);
        await expect(repositories.companyMemberships.listByCompany(s.contextA, s.companyA.id)).resolves.toHaveLength(2);
        await expect(repositories.companyMemberships.listByCompany(s.contextB, s.companyB.id)).resolves.toEqual([
          s.aliceAtB,
        ]);
      });

      it('rejects a duplicate membership of the same user to the same tenant', async () => {
        await expect(
          repositories.companyMemberships.create(s.contextA, newCompanyMembership(s.alice, s.companyA)),
        ).rejects.toMatchObject({ name: RecordConflictError.name, reason: 'duplicate-company-membership' });
        await expect(
          repositories.companyMemberships.create(s.contextA, newCompanyMembership(s.bob, s.companyA, { id: s.aliceAtA.id })),
        ).rejects.toMatchObject({ name: RecordConflictError.name, reason: 'duplicate-id' });
      });

      it('rejects inconsistent company and tenant identifiers or unknown identities', async () => {
        const crossed = createCompanyMembership({
          ...newCompanyMembership(s.bob, s.companyA),
          companyId: s.companyB.id,
        });

        await expect(repositories.companyMemberships.create(s.contextA, crossed)).rejects.toMatchObject({
          kind: 'Company',
          name: RecordNotFoundError.name,
        });
        await expect(
          repositories.companyMemberships.create(s.contextA, newCompanyMembership(newUser(), s.companyA)),
        ).rejects.toMatchObject({ kind: 'User', name: RecordNotFoundError.name });
        await expect(repositories.companyMemberships.findByUser(s.contextA, s.bob.id)).resolves.toBeUndefined();
      });

      it('deactivates one membership without affecting the others', async () => {
        await repositories.companyMemberships.update(s.contextA, deactivateCompanyMembership(s.aliceAtA, UPDATED_AT));

        await expect(evaluate(s.contextA, s.alice.id)).resolves.toEqual({
          eligible: false,
          reason: 'membership-inactive',
        });
        await expect(evaluate(s.contextB, s.alice.id)).resolves.toMatchObject({ eligible: true });
        await expect(repositories.companyMemberships.findById(s.contextA, s.carolAtA.id)).resolves.toEqual(s.carolAtA);
        await expect(repositories.companyMemberships.findById(s.contextA, s.aliceAtA.id)).resolves.toMatchObject({
          status: 'INACTIVE',
        });
      });

      it('allows scope changes but keeps user, company and creation date immutable', async () => {
        const restricted = createCompanyMembership({ ...s.aliceAtA, scope: 'BRANCH_RESTRICTED', updatedAt: UPDATED_AT });
        await repositories.companyMemberships.update(s.contextA, restricted);
        await expect(repositories.companyMemberships.findById(s.contextA, s.aliceAtA.id)).resolves.toEqual(restricted);

        for (const change of [
          { userId: s.bob.id },
          { createdAt: '2026-11-13T09:00:00.000Z' },
        ]) {
          await expect(
            repositories.companyMemberships.update(s.contextA, createCompanyMembership({ ...restricted, ...change })),
          ).rejects.toMatchObject({ name: RecordConflictError.name, reason: 'immutable-field' });
        }
      });

      it('isolates reads between tenants', async () => {
        await expect(repositories.companyMemberships.findById(s.contextB, s.carolAtA.id)).resolves.toBeUndefined();
        await expect(repositories.companyMemberships.findByUser(s.contextB, s.carol.id)).resolves.toBeUndefined();
        await expect(repositories.companyMemberships.listByCompany(s.contextB, s.companyA.id)).resolves.toEqual([]);
        await expect(repositories.branchMemberships.listByCompanyMembership(s.contextB, s.carolAtA.id)).resolves.toEqual(
          [],
        );
        await expect(evaluate(s.contextB, s.carol.id)).resolves.toEqual({ eligible: false, reason: 'no-membership' });
      });

      it('isolates updates between tenants', async () => {
        const changed = createCompanyMembership({ ...s.carolAtA, scope: 'COMPANY_WIDE', updatedAt: UPDATED_AT });
        const forged = createCompanyMembership({ ...changed, companyId: s.companyB.id, tenantId: s.companyB.tenantId });

        await expect(repositories.companyMemberships.update(s.contextB, changed)).rejects.toBeInstanceOf(
          TenantMismatchError,
        );
        await expect(repositories.companyMemberships.update(s.contextB, forged)).rejects.toMatchObject({
          kind: 'CompanyMembership',
          name: RecordNotFoundError.name,
        });
        await expect(repositories.companyMemberships.findById(s.contextA, s.carolAtA.id)).resolves.toEqual(s.carolAtA);
      });

      it('isolates deactivation between tenants', async () => {
        const deactivated = deactivateCompanyMembership(s.aliceAtA, UPDATED_AT);
        const forged = createCompanyMembership({
          ...deactivated,
          companyId: s.companyB.id,
          tenantId: s.companyB.tenantId,
        });

        await expect(repositories.companyMemberships.update(s.contextB, deactivated)).rejects.toBeInstanceOf(
          TenantMismatchError,
        );
        await expect(repositories.companyMemberships.update(s.contextB, forged)).rejects.toBeInstanceOf(
          RecordNotFoundError,
        );
        await expect(evaluate(s.contextA, s.alice.id)).resolves.toMatchObject({ eligible: true });
        await expect(repositories.companyMemberships.findById(s.contextB, s.aliceAtB.id)).resolves.toEqual(s.aliceAtB);
      });

      it('allows internal provisioning for a DRAFT company, flagged as not operational', async () => {
        const draft = newCompany({ nif: undefined, status: 'DRAFT' });
        const context = contextFor(draft.tenantId);
        await repositories.companies.create(context, draft);
        await repositories.companyMemberships.create(context, newCompanyMembership(s.bob, draft));

        await expect(evaluate(context, s.bob.id)).resolves.toMatchObject({
          companyOperational: false,
          eligible: true,
          scope: 'COMPANY_WIDE',
        });
      });

      it('makes suspended or inactive identities ineligible', async () => {
        await repositories.users.changeStatus(s.alice.id, 'SUSPENDED', UPDATED_AT);
        await expect(evaluate(s.contextA, s.alice.id)).resolves.toEqual({ eligible: false, reason: 'user-not-active' });

        await repositories.users.changeStatus(s.alice.id, 'INACTIVE', UPDATED_AT);
        await expect(evaluate(s.contextB, s.alice.id)).resolves.toEqual({ eligible: false, reason: 'user-not-active' });
      });
    });

    describe('branch memberships', () => {
      it('covers every active branch with COMPANY_WIDE', async () => {
        await expect(evaluate(s.contextA, s.alice.id)).resolves.toEqual({
          branchIds: [s.northA.id, s.southA.id].sort(),
          companyId: s.companyA.id,
          companyOperational: true,
          eligible: true,
          scope: 'COMPANY_WIDE',
          tenantId: s.companyA.tenantId,
          userId: s.alice.id,
        });
      });

      it('covers only associated branches with BRANCH_RESTRICTED', async () => {
        await expect(evaluate(s.contextA, s.carol.id)).resolves.toMatchObject({
          branchIds: [s.northA.id],
          scope: 'BRANCH_RESTRICTED',
        });
      });

      it('grants no branch to BRANCH_RESTRICTED without branch memberships', async () => {
        await expect(evaluate(s.contextB, s.alice.id)).resolves.toMatchObject({
          branchIds: [],
          eligible: true,
          scope: 'BRANCH_RESTRICTED',
        });
      });

      it('associates several branches of the same company', async () => {
        await repositories.branchMemberships.create(s.contextA, newBranchMembership(s.carolAtA, s.southA));

        await expect(repositories.branchMemberships.listByCompanyMembership(s.contextA, s.carolAtA.id)).resolves.toHaveLength(2);
        await expect(evaluate(s.contextA, s.carol.id)).resolves.toMatchObject({
          branchIds: [s.northA.id, s.southA.id].sort(),
        });
      });

      it('rejects a branch of another company or a membership of another tenant', async () => {
        // Estabelecimento da empresa B através de uma associação da empresa A.
        const foreignBranch = newBranchMembership(s.carolAtA, s.storeB);
        // Associação da empresa A com `companyId` forjado para a empresa B.
        const crossedCompany = newBranchMembership(s.carolAtA, s.southA, { companyId: s.companyB.id });
        // Registo inteiro do tenant B apresentado no contexto A.
        const foreignRecord = newBranchMembership(s.aliceAtB, s.storeB);
        // Associação empresarial do tenant B referida num registo declarado como do tenant A.
        const foreignParent = newBranchMembership(s.aliceAtB, s.southA, {
          companyId: s.companyA.id,
          tenantId: s.companyA.tenantId,
        });

        await expect(repositories.branchMemberships.create(s.contextA, foreignBranch)).rejects.toMatchObject({
          kind: 'Branch',
          name: RecordNotFoundError.name,
        });
        await expect(repositories.branchMemberships.create(s.contextA, crossedCompany)).rejects.toMatchObject({
          kind: 'CompanyMembership',
          name: RecordNotFoundError.name,
        });
        await expect(repositories.branchMemberships.create(s.contextA, foreignRecord)).rejects.toBeInstanceOf(
          TenantMismatchError,
        );
        await expect(repositories.branchMemberships.create(s.contextA, foreignParent)).rejects.toMatchObject({
          kind: 'CompanyMembership',
          name: RecordNotFoundError.name,
        });
        await expect(
          repositories.branchMemberships.listByCompanyMembership(s.contextA, s.carolAtA.id),
        ).resolves.toHaveLength(1);
        await expect(
          repositories.branchMemberships.listByCompanyMembership(s.contextB, s.aliceAtB.id),
        ).resolves.toEqual([]);
      });

      it('rejects duplicate branch memberships', async () => {
        const [existing] = await repositories.branchMemberships.listByCompanyMembership(s.contextA, s.carolAtA.id);

        await expect(
          repositories.branchMemberships.create(s.contextA, newBranchMembership(s.carolAtA, s.northA)),
        ).rejects.toMatchObject({ name: RecordConflictError.name, reason: 'duplicate-branch-membership' });
        await expect(
          repositories.branchMemberships.create(s.contextA, newBranchMembership(s.carolAtA, s.southA, { id: existing?.id })),
        ).rejects.toMatchObject({ name: RecordConflictError.name, reason: 'duplicate-id' });
      });

      it('refuses branch memberships under a COMPANY_WIDE membership', async () => {
        await expect(
          repositories.branchMemberships.create(s.contextA, newBranchMembership(s.aliceAtA, s.northA)),
        ).rejects.toMatchObject({ name: RecordConflictError.name, reason: 'membership-not-branch-restricted' });
      });

      it('deactivates a branch membership logically', async () => {
        const second = newBranchMembership(s.carolAtA, s.southA);
        await repositories.branchMemberships.create(s.contextA, second);
        const [first] = await repositories.branchMemberships.listByCompanyMembership(s.contextA, s.carolAtA.id);
        if (first === undefined) throw new Error('Associação local esperada.');

        await repositories.branchMemberships.update(s.contextA, deactivateBranchMembership(second, UPDATED_AT));

        await expect(evaluate(s.contextA, s.carol.id)).resolves.toMatchObject({ branchIds: [s.northA.id] });
        await expect(repositories.branchMemberships.findById(s.contextA, second.id)).resolves.toMatchObject({
          status: 'INACTIVE',
        });
        await expect(
          repositories.branchMemberships.update(s.contextA, { ...second, branchId: s.northA.id }),
        ).rejects.toMatchObject({ name: RecordConflictError.name, reason: 'immutable-field' });
        await expect(repositories.branchMemberships.update(s.contextB, deactivateBranchMembership(first, UPDATED_AT))).rejects.toBeInstanceOf(
          TenantMismatchError,
        );
      });

      it('does not consider an inactive branch a valid scope', async () => {
        await repositories.branches.update(s.contextA, deactivateBranch(s.northA, UPDATED_AT));

        await expect(evaluate(s.contextA, s.carol.id)).resolves.toMatchObject({ branchIds: [], eligible: true });
        await expect(evaluate(s.contextA, s.alice.id)).resolves.toMatchObject({ branchIds: [s.southA.id] });
      });

      it('isolates branch membership reads between tenants', async () => {
        const [local] = await repositories.branchMemberships.listByCompanyMembership(s.contextA, s.carolAtA.id);
        if (local === undefined) throw new Error('Associação local esperada.');

        await expect(repositories.branchMemberships.findById(s.contextB, local.id)).resolves.toBeUndefined();
        await expect(repositories.branchMemberships.findById(s.contextA, local.id)).resolves.toEqual(local);
      });
    });

    describe('operations without tenant context', () => {
      const operations = (): readonly (readonly [string, (context: TenantContext) => Promise<unknown>])[] => [
        ['companyMemberships.findById', (context) => repositories.companyMemberships.findById(context, s.aliceAtA.id)],
        ['companyMemberships.findByUser', (context) => repositories.companyMemberships.findByUser(context, s.alice.id)],
        ['companyMemberships.listByCompany', (context) => repositories.companyMemberships.listByCompany(context, s.companyA.id)],
        ['companyMemberships.create', (context) => repositories.companyMemberships.create(context, newCompanyMembership(s.bob, s.companyA))],
        ['companyMemberships.update', (context) => repositories.companyMemberships.update(context, s.aliceAtA)],
        [
          'branchMemberships.findById',
          (context) => repositories.branchMemberships.findById(context, parseBranchMembershipId(newId())),
        ],
        ['branchMemberships.listByCompanyMembership', (context) => repositories.branchMemberships.listByCompanyMembership(context, s.carolAtA.id)],
        ['branchMemberships.create', (context) => repositories.branchMemberships.create(context, newBranchMembership(s.carolAtA, s.southA))],
        ['branchMemberships.update', (context) => repositories.branchMemberships.update(context, newBranchMembership(s.carolAtA, s.northA))],
        ['scopes.evaluate', (context) => repositories.scopes.evaluate(context, s.alice.id)],
      ];

      it('rejects missing and invalid contexts in every tenant-scoped operation', async () => {
        const invalid = [
          { actorId: 'user:x', correlationId: 'c-1', tenantId: 'not-a-uuid' },
          { actorId: '', correlationId: 'c-1', tenantId: s.companyA.tenantId },
          { tenantId: s.companyA.tenantId },
        ];
        for (const [, operation] of operations()) {
          await expect(operation(undefined as unknown as TenantContext)).rejects.toMatchObject({
            name: TenantContextError.name,
            reason: 'missing',
          });
          for (const context of invalid) {
            await expect(operation(context as unknown as TenantContext)).rejects.toMatchObject({
              name: TenantContextError.name,
              reason: 'invalid',
            });
          }
        }

        await expect(repositories.companyMemberships.findByUser(s.contextA, s.bob.id)).resolves.toBeUndefined();
        await expect(repositories.branchMemberships.listByCompanyMembership(s.contextA, s.carolAtA.id)).resolves.toHaveLength(1);
      });
    });

    it('never returns personal data through tenant-scoped operations', async () => {
      const membership = await repositories.companyMemberships.findByUser(s.contextA, s.alice.id);
      const evaluation = await evaluate(s.contextA, s.alice.id);
      const serialised = JSON.stringify([membership, evaluation]);

      expect(serialised).not.toContain(s.alice.username);
      expect(serialised).not.toContain(s.alice.displayName);
      expect(serialised).not.toContain(String(s.alice.email));
    });

    it('keeps identities free of credentials after persistence', async () => {
      const hostile = { ...userInput(), password: 'segredo-de-teste', pin: '0000' };
      const user = createUser(hostile);
      await repositories.users.create(user);
      const stored = await repositories.users.findById(user.id);

      expect(JSON.stringify(stored)).not.toContain('segredo');
      expect(Object.keys(stored ?? {}).sort()).toEqual([
        'createdAt',
        'displayName',
        'email',
        'id',
        'phone',
        'status',
        'updatedAt',
        'username',
      ]);
    });
  });
};
