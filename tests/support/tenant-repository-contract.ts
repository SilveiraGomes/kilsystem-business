import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  COMPANY_STATUSES,
  createBranch,
  deactivateBranch,
  deactivateCompany,
  DomainValidationError,
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
import { branchInput, contextFor, CREATED_AT, newCompany, newId, UPDATED_AT } from './fixtures';

export interface TenantRepositories {
  readonly companies: CompanyRepository;
  readonly branches: BranchRepository;
}

export interface TenantRepositoryHarness extends TenantRepositories {
  /** Liberta recursos (ex.: fecha a ligação e apaga a base temporária). */
  readonly dispose?: () => void;
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
  const companyA = newCompany({ legalName: 'Tenant A, Lda.' });
  const companyB = newCompany({ legalName: 'Tenant B, Lda.' });
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
 * (memória, SQLite, PostgreSQL) deve passar exactamente estes testes (D-021).
 */
export const describeTenantRepositoryContract = (
  implementation: string,
  createRepositories: () => TenantRepositoryHarness,
): void => {
  describe(`Multi-tenant repository contract (${implementation})`, () => {
    let repositories: TenantRepositoryHarness;
    let scenario: Scenario;

    beforeEach(async () => {
      repositories = createRepositories();
      scenario = await seed(repositories);
    });

    afterEach(() => {
      repositories.dispose?.();
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
        const renamedCompany = newCompany({ ...companyA, tradeName: 'Marca A', updatedAt: UPDATED_AT });
        const renamedBranch = createBranch({ ...pharmacyA, name: 'Farmácia Central', updatedAt: UPDATED_AT });

        await repositories.companies.update(contextA, renamedCompany);
        await repositories.branches.update(contextA, renamedBranch);

        await expect(repositories.companies.findById(contextA, companyA.id)).resolves.toEqual(renamedCompany);
        await expect(repositories.branches.findById(contextA, pharmacyA.id)).resolves.toEqual(renamedBranch);
      });

      it('keeps exactly one company per tenant (D-016, D-023)', async () => {
        const { companyA, contextA } = scenario;
        const second = newCompany({ tenantId: companyA.tenantId });

        await expect(repositories.companies.create(contextA, second)).rejects.toMatchObject({
          reason: 'tenant-already-has-company',
        });
      });

      it('rejects identifiers that already exist', async () => {
        const { companyA, contextA, pharmacyA } = scenario;
        const sameCompanyId = newCompany({ id: companyA.id });
        const sameBranchId = createBranch(branchInput(companyA, { code: 'A-NEW', id: pharmacyA.id }));

        await expect(
          repositories.companies.create(contextFor(sameCompanyId.tenantId), sameCompanyId),
        ).rejects.toMatchObject({ reason: 'duplicate-id' });
        await expect(repositories.branches.create(contextA, sameBranchId)).rejects.toMatchObject({
          reason: 'duplicate-id',
        });
      });

      it('rejects changes to the creation timestamp', async () => {
        const { companyA, contextA, pharmacyA } = scenario;
        const earlier = '2026-01-01T00:00:00.000Z';

        await expect(
          repositories.companies.update(contextA, newCompany({ ...companyA, createdAt: earlier })),
        ).rejects.toMatchObject({ reason: 'immutable-field' });
        await expect(
          repositories.branches.update(contextA, createBranch({ ...pharmacyA, createdAt: earlier })),
        ).rejects.toMatchObject({ reason: 'immutable-field' });
      });

      it('re-validates records instead of trusting forged objects', async () => {
        const { companyA, contextA, pharmacyA } = scenario;
        const forgedCompany = { ...companyA, status: 'DELETED' } as unknown as Company;
        const forgedBranch = { ...pharmacyA, sectorType: 'CASINO' } as unknown as Branch;

        await expect(repositories.companies.update(contextA, forgedCompany)).rejects.toBeInstanceOf(
          DomainValidationError,
        );
        await expect(repositories.branches.update(contextA, forgedBranch)).rejects.toBeInstanceOf(
          DomainValidationError,
        );
        await expect(repositories.companies.findById(contextA, companyA.id)).resolves.toEqual(companyA);
      });
    });

    describe('branch association', () => {
      it('lists only the branches of the requested company, ordered by code', async () => {
        const { companyA, contextA, pharmacyA, restaurantA } = scenario;

        const listed = await repositories.branches.listByCompany(contextA, companyA.id);

        expect(listed).toEqual([pharmacyA, restaurantA]);
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

      it('refuses to physically delete a company that still has branches (D-027)', async () => {
        const { companyA, contextA, pharmacyA, restaurantA } = scenario;

        await expect(repositories.companies.delete(contextA, companyA.id)).rejects.toMatchObject({
          reason: 'company-has-branches',
        });

        await repositories.branches.delete(contextA, pharmacyA.id);
        await repositories.branches.delete(contextA, restaurantA.id);
        await repositories.companies.delete(contextA, companyA.id);

        await expect(repositories.companies.findById(contextA, companyA.id)).resolves.toBeUndefined();
      });

      it('supports logical deactivation without deleting data (D-027)', async () => {
        const { companyA, contextA, pharmacyA } = scenario;

        await repositories.branches.update(contextA, deactivateBranch(pharmacyA, UPDATED_AT));
        await repositories.companies.update(contextA, deactivateCompany(companyA, UPDATED_AT));

        await expect(repositories.companies.findById(contextA, companyA.id)).resolves.toMatchObject({
          status: 'INACTIVE',
        });
        await expect(repositories.branches.findById(contextA, pharmacyA.id)).resolves.toMatchObject({
          status: 'INACTIVE',
        });
      });
    });

    describe('branch code uniqueness (D-026)', () => {
      it('rejects a normalised duplicate code within the same company', async () => {
        const { companyA, contextA } = scenario;
        const duplicate = createBranch(branchInput(companyA, { code: '  a-far ' }));

        expect(duplicate.code).toBe('A-FAR');
        await expect(repositories.branches.create(contextA, duplicate)).rejects.toMatchObject({
          reason: 'duplicate-branch-code',
        });
      });

      it('rejects renaming a branch to a code already used in the company', async () => {
        const { contextA, pharmacyA } = scenario;
        const clash = createBranch({ ...pharmacyA, code: 'a-res', updatedAt: UPDATED_AT });

        await expect(repositories.branches.update(contextA, clash)).rejects.toMatchObject({
          reason: 'duplicate-branch-code',
        });
      });

      it('allows the same code in another company', async () => {
        const { companyB, contextB } = scenario;
        const sameCode = createBranch(branchInput(companyB, { code: 'A-FAR' }));

        await repositories.branches.create(contextB, sameCode);

        await expect(repositories.branches.findById(contextB, sameCode.id)).resolves.toEqual(sameCode);
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
        const changedCompany = newCompany({ ...companyA, legalName: 'Alterado por B', updatedAt: UPDATED_AT });
        const changedBranch = createBranch({ ...pharmacyA, name: 'Alterado por B', updatedAt: UPDATED_AT });

        await expect(repositories.companies.update(contextB, changedCompany)).rejects.toBeInstanceOf(TenantMismatchError);
        await expect(repositories.branches.update(contextB, changedBranch)).rejects.toBeInstanceOf(TenantMismatchError);
      });

      it('rejects records re-labelled with the caller tenant', async () => {
        const { companyA, companyB, contextA, contextB, pharmacyA } = scenario;
        const forgedCompany = newCompany({ ...companyA, legalName: 'Forjado', tenantId: contextB.tenantId });
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
        ['companies.create', (context) => repositories.companies.create(context, newCompany())],
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

    describe('company statuses (D-025)', () => {
      it.each(COMPANY_STATUSES)('stores and reads a %s company', async (status) => {
        const company = newCompany({ nif: status === 'DRAFT' ? undefined : 'NIF-TESTE-0003', status });
        const context = contextFor(company.tenantId);

        await repositories.companies.create(context, company);

        await expect(repositories.companies.findById(context, company.id)).resolves.toEqual(company);
      });

      it('promotes a draft company once it is valid', async () => {
        const draft = newCompany({ nif: undefined, status: 'DRAFT' });
        const context = contextFor(draft.tenantId);
        await repositories.companies.create(context, draft);

        const active = newCompany({ ...draft, nif: 'NIF-TESTE-0004', status: 'ACTIVE', updatedAt: UPDATED_AT });
        await repositories.companies.update(context, active);

        await expect(repositories.companies.findById(context, draft.id)).resolves.toEqual(active);
        expect(active.createdAt).toBe(CREATED_AT);
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

