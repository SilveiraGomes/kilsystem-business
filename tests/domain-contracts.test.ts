import { describe, expect, it } from 'vitest';

import {
  COMPANY_STATUSES,
  createBranch,
  createCompany,
  createTaxIdPolicy,
  createTenantContext,
  deactivateBranch,
  deactivateCompany,
  DomainValidationError,
  EMPTY_TAX_ID_POLICY,
  isSectorType,
  normalizeBranchCode,
  parseBranchId,
  parseCompanyId,
  parseJurisdiction,
  parseTenantId,
  restoreCompany,
  SECTOR_LABELS,
  SECTOR_TYPES,
  type BranchId,
  type CompanyId,
  type TenantId,
} from '../packages/shared-types/src/index';
import {
  branchInput,
  companyInput,
  CREATED_AT,
  newCompany,
  newId,
  UPDATED_AT,
} from './support/fixtures';

const invalidIdentifiers: readonly unknown[] = [
  '',
  'not-a-uuid',
  '00000000-0000-0000-0000-000000000000',
  '{3f2504e0-4f89-41d3-9a0c-0305e82c3301}',
  ' 3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  '3f2504e0-4f89-41d3-9a0c-0305e82c330',
  '3f2504e0-4f89-01d3-9a0c-0305e82c3301',
  123,
  null,
  undefined,
];

const captureError = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
};

const expectValidationError = (action: () => unknown, field: string): void => {
  const error = captureError(action);
  expect(error).toBeInstanceOf(DomainValidationError);
  expect(error).toMatchObject({ field });
};

describe('Multi-tenant domain contracts', () => {
  describe('valid contracts', () => {
    it('creates an immutable company with normalised fields', () => {
      const tenantId = newId().toUpperCase();
      const company = newCompany({
        jurisdiction: ' zz ',
        legalName: '  Empresa de Teste, Lda.  ',
        tenantId,
        tradeName: undefined,
      });

      expect(company.tenantId).toBe(tenantId.toLowerCase());
      expect(company.jurisdiction).toBe('ZZ');
      expect(company.legalName).toBe('Empresa de Teste, Lda.');
      expect(company).not.toHaveProperty('tradeName');
      expect(company.createdAt).toBe(CREATED_AT);
      expect(company.updatedAt).toBe(CREATED_AT);
      expect(Object.isFrozen(company)).toBe(true);
    });

    it('keeps the NIF as an attribute independent from the identifiers (D-016)', () => {
      const company = newCompany({ nif: 'NIF-TESTE-0002', tradeName: 'Marca' });

      expect(company.nif).toBe('NIF-TESTE-0002');
      expect(company.id).not.toBe(company.nif);
      expect(company.tenantId).not.toBe(company.nif);
      expect(company.tradeName).toBe('Marca');
    });

    it('creates a branch bound to its company and tenant', () => {
      const company = newCompany();
      const branch = createBranch(branchInput(company, { updatedAt: new Date(UPDATED_AT) }));

      expect(branch.companyId).toBe(company.id);
      expect(branch.tenantId).toBe(company.tenantId);
      expect(branch.updatedAt).toBe(UPDATED_AT);
      expect(Object.isFrozen(branch)).toBe(true);
    });

    it('creates a frozen tenant context', () => {
      const tenantId = newId();
      const context = createTenantContext({ actorId: 'service:sync', correlationId: 'req-42', tenantId });

      expect(context).toEqual({ actorId: 'service:sync', correlationId: 'req-42', tenantId });
      expect(Object.isFrozen(context)).toBe(true);
    });
  });

  describe('invalid identifiers', () => {
    it.each(invalidIdentifiers)('rejects %j as a typed identifier', (value) => {
      expect(() => parseTenantId(value)).toThrow(DomainValidationError);
      expect(() => parseCompanyId(value)).toThrow(DomainValidationError);
      expect(() => parseBranchId(value)).toThrow(DomainValidationError);
    });

    it.each(invalidIdentifiers)('rejects %j in contract identifier fields', (value) => {
      const company = newCompany();
      const text = value as string;

      expectValidationError(() => newCompany({ id: text }), 'id');
      expectValidationError(() => newCompany({ tenantId: text }), 'tenantId');
      expectValidationError(() => createBranch(branchInput(company, { id: text })), 'id');
      expectValidationError(() => createBranch(branchInput(company, { tenantId: text })), 'tenantId');
      expectValidationError(() => createBranch(branchInput(company, { companyId: text })), 'companyId');
      expectValidationError(
        () => createTenantContext({ actorId: 'user:x', correlationId: 'c-1', tenantId: text }),
        'tenantId',
      );
    });

    it('requires the company and tenant identifiers to be distinct (D-023)', () => {
      const shared = newId();

      expectValidationError(() => newCompany({ id: shared, tenantId: shared }), 'tenantId');
      expectValidationError(() => newCompany({ id: shared, tenantId: shared.toUpperCase() }), 'tenantId');
    });

    it('rejects empty or oversized actor and correlation identifiers', () => {
      const tenantId = newId();

      expectValidationError(() => createTenantContext({ actorId: ' ', correlationId: 'c-1', tenantId }), 'actorId');
      expectValidationError(
        () => createTenantContext({ actorId: 'user:x', correlationId: 'x'.repeat(129), tenantId }),
        'correlationId',
      );
    });

    it('keeps identifier types distinct at compile time', () => {
      const companyId = parseCompanyId(newId());
      const branchId: BranchId = parseBranchId(newId());

      // @ts-expect-error: um BranchId não pode ser usado onde se espera um CompanyId.
      const misusedBranch: CompanyId = branchId;
      // @ts-expect-error: um CompanyId não pode ser usado onde se espera um TenantId.
      const misusedCompany: TenantId = companyId;
      // @ts-expect-error: texto não validado não é um TenantId.
      const unvalidated: TenantId = newId();

      expect([misusedBranch, misusedCompany, unvalidated]).toHaveLength(3);
    });
  });

  describe('field validation', () => {
    it('rejects missing required text', () => {
      const company = newCompany();

      expectValidationError(() => newCompany({ legalName: '   ' }), 'legalName');
      expectValidationError(() => newCompany({ nif: '' }), 'nif');
      expectValidationError(() => newCompany({ tradeName: ' ' }), 'tradeName');
      expectValidationError(() => createBranch(branchInput(company, { name: '' })), 'name');
      expectValidationError(() => createBranch(branchInput(company, { code: ' ' })), 'code');
    });

    it('rejects unknown statuses', () => {
      const company = newCompany();

      expectValidationError(() => newCompany({ status: 'active' }), 'status');
      expectValidationError(() => newCompany({ status: 'DELETED' }), 'status');
      expectValidationError(() => createBranch(branchInput(company, { status: 'DELETED' })), 'status');
    });

    it.each(['', 'ZZZ', 'Z1', 'Angola', null])('rejects jurisdiction %j', (jurisdiction) => {
      expectValidationError(() => newCompany({ jurisdiction: jurisdiction as string }), 'jurisdiction');
    });

    it('rejects invalid or inconsistent timestamps', () => {
      expectValidationError(() => newCompany({ createdAt: '13/11/2026' }), 'createdAt');
      expectValidationError(() => newCompany({ createdAt: new Date('invalid') }), 'createdAt');
      expectValidationError(() => newCompany({ createdAt: UPDATED_AT, updatedAt: CREATED_AT }), 'updatedAt');
    });

    it('does not echo rejected values in error messages', () => {
      const secret = 'NIF-SENSIVEL-9999';
      const error = captureError(() => newCompany({ nif: secret.padEnd(300, '9') }));

      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).message).not.toContain(secret);
    });
  });

  describe('company statuses and NIF (D-024, D-025)', () => {
    it('supports exactly the four business statuses', () => {
      expect(COMPANY_STATUSES).toEqual(['DRAFT', 'ACTIVE', 'SUSPENDED', 'INACTIVE']);
    });

    it('allows a draft company without NIF and without a configured tax rule', () => {
      const draft = createCompany(companyInput({ nif: undefined, status: 'DRAFT' }), EMPTY_TAX_ID_POLICY);

      expect(draft.status).toBe('DRAFT');
      expect(draft).not.toHaveProperty('nif');
    });

    it('requires a NIF for an active company', () => {
      expectValidationError(() => newCompany({ nif: undefined, status: 'ACTIVE' }), 'nif');
      expectValidationError(() => restoreCompany(companyInput({ nif: undefined, status: 'ACTIVE' })), 'nif');
    });

    it('validates the NIF of an active company with the jurisdiction rule', () => {
      expectValidationError(() => newCompany({ nif: 'NIF-INVALIDO', status: 'ACTIVE' }), 'nif');
      expect(newCompany({ nif: 'NIF-TESTE-0042', status: 'ACTIVE' }).nif).toBe('NIF-TESTE-0042');
    });

    it('fails closed when no rule is configured for the jurisdiction', () => {
      expectValidationError(() => createCompany(companyInput(), EMPTY_TAX_ID_POLICY), 'nif');
      expectValidationError(() => newCompany({ jurisdiction: 'AO' }), 'nif');
    });

    it.each(['SUSPENDED', 'INACTIVE'] as const)('accepts a %s company without re-applying the rule', (status) => {
      const company = createCompany(companyInput({ nif: 'NIF-LEGADO', status }), EMPTY_TAX_ID_POLICY);

      expect(company.status).toBe(status);
    });

    it('rejects ambiguous tax rule configuration', () => {
      const rule = { isValid: () => true, jurisdiction: parseJurisdiction('ZZ'), source: 'Teste' };

      expectValidationError(() => createTaxIdPolicy([rule, rule]), 'jurisdiction');
      expectValidationError(() => createTaxIdPolicy([{ ...rule, source: ' ' }]), 'source');
    });

    it('deactivates companies and branches logically (D-027)', () => {
      const company = newCompany();
      const branch = createBranch(branchInput(company));

      const inactiveCompany = deactivateCompany(company, UPDATED_AT);
      const inactiveBranch = deactivateBranch(branch, UPDATED_AT);

      expect(inactiveCompany).toEqual({ ...company, status: 'INACTIVE', updatedAt: UPDATED_AT });
      expect(inactiveBranch).toEqual({ ...branch, status: 'INACTIVE', updatedAt: UPDATED_AT });
    });
  });

  describe('branch code normalisation (D-026)', () => {
    it.each([
      ['  a-far ', 'A-FAR'],
      ['loja   central', 'LOJA CENTRAL'],
      ['ｌｊ０１', 'LJ01'],
      ['Café-1', 'CAFÉ-1'],
    ])('normalises %j to %j', (raw, normalised) => {
      expect(normalizeBranchCode(raw)).toBe(normalised);
      expect(createBranch(branchInput(newCompany(), { code: raw })).code).toBe(normalised);
    });
  });

  describe('sectors (D-018)', () => {
    it('supports exactly the four initial sectors, each with a label', () => {
      expect(SECTOR_TYPES).toEqual(['PHARMACY', 'SUPERMARKET', 'FUEL_STATION', 'RESTAURANT']);
      for (const sector of SECTOR_TYPES) {
        expect(isSectorType(sector)).toBe(true);
        expect(SECTOR_LABELS[sector].length).toBeGreaterThan(0);
      }
    });

    it('lets one company own branches in different sectors', () => {
      const company = newCompany();
      const branches = SECTOR_TYPES.map((sectorType) =>
        createBranch(branchInput(company, { code: sectorType, sectorType })),
      );

      expect(branches.map((branch) => branch.sectorType)).toEqual([...SECTOR_TYPES]);
      expect(new Set(branches.map((branch) => branch.companyId))).toEqual(new Set([company.id]));
    });

    it.each(['pharmacy', 'FARMACIA', 'HOTEL', '', null])('rejects unknown sector %j', (sectorType) => {
      const company = newCompany();

      expect(isSectorType(sectorType)).toBe(false);
      expectValidationError(
        () => createBranch(branchInput(company, { sectorType: sectorType as string })),
        'sectorType',
      );
    });
  });
});
