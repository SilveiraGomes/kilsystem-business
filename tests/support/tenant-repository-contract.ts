import { beforeEach, describe, expect, it } from 'vitest';

import {
  createBranch,
  createCompany,
  RecordConflictError,
  RecordNotFoundError,
  SECTOR_TYPES,
  TenantContextError,
  TenantMismatchError,
  type Branch,
  type BranchRepository,
  type Company,
  type CompanyRepository,
  type TenantContext,
} from '../../packages/shared-types/src/index';
import { branchInput, companyInput, contextFor, newId, UPDATED_AT } from './fixtures';

export interface TenantRepositories {
  readonly companies: CompanyRepository;
  readonly branches: BranchRepository;
}

interface Scenario {
  readonly contextA: TenantContext;
  readonly contextB: TenantContext;
  readonly companyA: Company;
  readonly companyB: Company;
  readonly pharmacyA: Branch;
  readonly restaurantA: Branch;
  readonly supermarketB: Branch;
}

const seed = async ({ branches, companies }: TenantRepositories): Promise<Scenario> => {
  const companyA = createCompany(companyInput({ legalName: 'Tenant A, Lda.' }));
  const companyB = createCompany(companyInput({ legalName: 'Tenant B, Lda.' }));
  const contextA = contextFor(companyA.tenantId);
  const contextB = contextFor(companyB.tenantId);
  const pharmacyA = createBranch(branchInput(companyA, { code: 'A-FAR', sectorType: 'PHARMACY' }));
  const restaurantA = createBranch(branchInput(companyA, { code: 'A-RES', sectorType: 'RESTAURANT' }));
  const supermarketB = createBranch(branchInput(companyB, { code: 'B-SUP', sectorType: 'SUPERMARKET' }));

  await companies.create(contextA, companyA);
  await companies.create(contextB, companyB);
  await branches.create(contextA, pharmacyA);
  await branches.create(contextA, restaurantA);
  await branches.create(contextB, supermarketB);

  return { companyA, companyB, contextA, contextB, pharmacyA, restaurantA, supermarketB };
};

/**
 * Suite de contrato reutilizável: qualquer implementação de repositório multiempresa
 * (memória, SQLite, PostgreSQL) deve passar exactamente estes testes.
 */
export const describeTenantRepositoryContract = (
  implementation: string,
  createRepositories: () => TenantRepositories,
): void => {
  describe(`Multi-tenant repository contract (${implementation})`, () => {
    let repositories: TenantRepositories;
    let scenario: Scenario;

    beforeEach(async () => {
      repositories = createRepositories();
      scenario = await seed(repositories);
    });

    describe('positive isolation', () => {
      it('lets each tenant read its own company and branches', async () => {
        const { companyA, companyB, contextA, contextB, pharmacyA, supermarketB } = scenario;

        await expect(repositories.companies.findById(contextA, companyA.id)).resolves.toEqual(companyA);
        await expect(repositories.companies.findById(contextB, companyB.id)).resolves.toEqual(companyB);
        await expect(repositories.branches.findById(contextA, pharmacyA.id)).resolves.toEqual(pharmacyA);
        await expect(repositories.branches.findById(contextB, supermarketB.id)).resolves.toEqual(supermarketB);
      });

      it('allows updates within the same tenant', async () => {
        const { companyA, contextA, pharmacyA } = scenario;
        const renamedCompany = createCompany({ ...companyA, tradeName: 'Marca A', updatedAt: UPDATED_AT });
        const renamedBranch = createBranch({ ...pharmacyA, name: 'Farmácia Central', updatedAt: UPDATED_AT });

        await repositories.companies.update(contextA, renamedCompany);
        await repositories.branches.update(contextA, renamedBranch);

        await expect(repositories.companies.findById(contextA, companyA.id)).resolves.toEqual(renamedCompany);
        await expect(repositories.branches.findById(contextA, pharmacyA.id)).resolves.toEqual(renamedBranch);
      });

      it('keeps exactly one company per tenant (D-016)', async () => {
        const { companyA, contextA } = scenario;
        const second = createCompany(companyInput({ tenantId: companyA.tenantId }));

        await expect(repositories.companies.create(contextA, second)).rejects.toMatchObject({
          reason: 'tenant-already-has-company',
        });
      });
    });

    describe('branch association', () => {
      it('lists only the branches of the requested company', async () => {
        const { companyA, contextA, pharmacyA, restaurantA } = scenario;

        const listed = await repositories.branches.listByCompany(contextA, companyA.id);

        expect(listed).toHaveLength(2);
        expect(listed).toEqual(expect.arrayContaining([pharmacyA, restaurantA]));
        expect(listed.every((branch) => branch.companyId === companyA.id)).toBe(true);
      });

      it('rejects a branch that points to a company of another tenant', async () => {
        const { companyA, companyB, contextA } = scenario;
        const forged = createBranch(branchInput(companyA, { companyId: companyB.id }));

        await expect(repositories.branches.create(contextA, forged)).rejects.toBeInstanceOf(RecordNotFoundError);
      });

      it('rejects a branch that points to a non-existent company', async () => {
        const { companyA, contextA } = scenario;
        const orphan = createBranch(branchInput(companyA, { companyId: newId() }));

        await expect(repositories.branches.create(contextA, orphan)).rejects.toBeInstanceOf(RecordNotFoundError);
      });

      it('rejects a branch whose tenant differs from the context', async () => {
        const { companyB, contextA } = scenario;
        const foreign = createBranch(branchInput(companyB));

        await expect(repositories.branches.create(contextA, foreign)).rejects.toBeInstanceOf(TenantMismatchError);
      });

      it('refuses to delete a company that still has branches', async () => {
        const { companyA, contextA, pharmacyA, restaurantA } = scenario;

        await expect(repositories.companies.delete(contextA, companyA.id)).rejects.toBeInstanceOf(RecordConflictError);

        await repositories.branches.delete(contextA, pharmacyA.id);
        await repositories.branches.delete(contextA, restaurantA.id);
        await repositories.companies.delete(contextA, companyA.id);

        await expect(repositories.companies.findById(contextA, companyA.id)).resolves.toBeUndefined();
      });
    });

    describe('cross-tenant read', () => {
      it('hides records of tenant A from tenant B', async () => {
        const { companyA, contextB, pharmacyA } = scenario;

        await expect(repositories.companies.findById(contextB, companyA.id)).resolves.toBeUndefined();
        await expect(repositories.branches.findById(contextB, pharmacyA.id)).resolves.toBeUndefined();
        await expect(repositories.branches.listByCompany(contextB, companyA.id)).resolves.toEqual([]);
      });
    });

    describe('cross-tenant update', () => {
      it('rejects records that declare another tenant', async () => {
        const { companyA, contextB, pharmacyA } = scenario;
        const changedCompany = createCompany({ ...companyA, legalName: 'Alterado por B', updatedAt: UPDATED_AT });
        const changedBranch = createBranch({ ...pharmacyA, name: 'Alterado por B', updatedAt: UPDATED_AT });

        await expect(repositories.companies.update(contextB, changedCompany)).rejects.toBeInstanceOf(TenantMismatchError);
        await expect(repositories.branches.update(contextB, changedBranch)).rejects.toBeInstanceOf(TenantMismatchError);
      });

      it('rejects records re-labelled with the caller tenant', async () => {
        const { companyA, companyB, contextA, contextB, pharmacyA } = scenario;
        const forgedCompany = createCompany({ ...companyA, tenantId: contextB.tenantId, legalName: 'Forjado' });
        const forgedBranch = createBranch({
          ...pharmacyA,
          companyId: companyB.id,
          name: 'Forjado',
          tenantId: contextB.tenantId,
        });

        await expect(repositories.companies.update(contextB, forgedCompany)).rejects.toBeInstanceOf(RecordNotFoundError);
        await expect(repositories.branches.update(contextB, forgedBranch)).rejects.toBeInstanceOf(RecordNotFoundError);

        await expect(repositories.companies.findById(contextA, companyA.id)).resolves.toEqual(companyA);
        await expect(repositories.branches.findById(contextA, pharmacyA.id)).resolves.toEqual(pharmacyA);
      });
    });

    describe('cross-tenant delete', () => {
      it('rejects deletion of records owned by another tenant', async () => {
        const { companyA, contextA, contextB, pharmacyA } = scenario;

        await expect(repositories.branches.delete(contextB, pharmacyA.id)).rejects.toBeInstanceOf(RecordNotFoundError);
        await expect(repositories.companies.delete(contextB, companyA.id)).rejects.toBeInstanceOf(RecordNotFoundError);

        await expect(repositories.companies.findById(contextA, companyA.id)).resolves.toEqual(companyA);
        await expect(repositories.branches.findById(contextA, pharmacyA.id)).resolves.toEqual(pharmacyA);
      });
    });

    describe('operations without tenant context', () => {
      const operations: readonly (readonly [string, (context: TenantContext) => Promise<unknown>])[] = [
        ['companies.findById', (context) => repositories.companies.findById(context, scenario.companyA.id)],
        ['companies.create', (context) => repositories.companies.create(context, createCompany(companyInput()))],
        ['companies.update', (context) => repositories.companies.update(context, scenario.companyA)],
        ['companies.delete', (context) => repositories.companies.delete(context, scenario.companyA.id)],
        ['branches.findById', (context) => repositories.branches.findById(context, scenario.pharmacyA.id)],
        ['branches.listByCompany', (context) => repositories.branches.listByCompany(context, scenario.companyA.id)],
        ['branches.create', (context) => repositories.branches.create(context, createBranch(branchInput(scenario.companyA)))],
        ['branches.update', (context) => repositories.branches.update(context, scenario.pharmacyA)],
        ['branches.delete', (context) => repositories.branches.delete(context, scenario.pharmacyA.id)],
      ];

      it.each(operations)('%s rejects a missing context', async (_name, operation) => {
        await expect(operation(undefined as unknown as TenantContext)).rejects.toMatchObject({
          name: TenantContextError.name,
          reason: 'missing',
        });
        await expect(operation(null as unknown as TenantContext)).rejects.toBeInstanceOf(TenantContextError);
      });

      it.each(operations)('%s rejects a malformed context', async (_name, operation) => {
        const malformed = [
          {},
          { actorId: 'user:x', correlationId: 'c-1', tenantId: 'not-a-uuid' },
          { actorId: '', correlationId: 'c-1', tenantId: scenario.companyA.tenantId },
          { actorId: 'user:x', correlationId: '  ', tenantId: scenario.companyA.tenantId },
          { actorId: 'user:x', correlationId: 'c-1', tenantId: scenario.companyA.tenantId.toUpperCase() },
        ];

        for (const context of malformed) {
          await expect(operation(context as unknown as TenantContext)).rejects.toMatchObject({
            name: TenantContextError.name,
            reason: 'invalid',
          });
        }
      });

      it('leaves stored data untouched after rejected operations', async () => {
        const { companyA, contextA } = scenario;
        await expect(
          repositories.companies.delete(undefined as unknown as TenantContext, companyA.id),
        ).rejects.toBeInstanceOf(TenantContextError);

        await expect(repositories.companies.findById(contextA, companyA.id)).resolves.toEqual(companyA);
      });
    });

    describe('sectors (D-018)', () => {
      it('stores and isolates branches of every sector consistently', async () => {
        const { companyA, contextA, contextB } = scenario;

        for (const sectorType of SECTOR_TYPES) {
          const branch = createBranch(branchInput(companyA, { code: `A-${sectorType}`, sectorType }));
          await repositories.branches.create(contextA, branch);

          await expect(repositories.branches.findById(contextA, branch.id)).resolves.toEqual(branch);
          await expect(repositories.branches.findById(contextB, branch.id)).resolves.toBeUndefined();
        }

        const listed = await repositories.branches.listByCompany(contextA, companyA.id);
        const sectors = new Set(listed.map((branch) => branch.sectorType));
        expect([...sectors].sort()).toEqual([...SECTOR_TYPES].sort());
      });
    });
  });
};
