import { randomUUID } from 'node:crypto';

import {
  createCompany,
  createTaxIdPolicy,
  createTenantContext,
  parseJurisdiction,
  type BranchInput,
  type Company,
  type CompanyInput,
  type TenantContext,
  type TenantId,
} from '../../packages/shared-types/src/index';

// Dados fictícios para testes; nenhum valor corresponde a uma entidade real.
export const CREATED_AT = '2026-11-13T10:00:00.000Z';
export const UPDATED_AT = '2026-11-13T11:30:00.000Z';

/** `ZZ` é um código ISO 3166-1 reservado para uso privado: não corresponde a nenhuma jurisdição. */
export const TEST_JURISDICTION = 'ZZ';

/** Regra fiscal fictícia, exclusiva para testes; não representa nenhuma norma real. */
export const TEST_TAX_ID_POLICY = createTaxIdPolicy([
  {
    isValid: (nif) => /^NIF-TESTE-\d{4}$/.test(nif),
    jurisdiction: parseJurisdiction(TEST_JURISDICTION),
    source: 'Regra fictícia exclusiva para testes automatizados',
  },
]);

export const newId = (): string => randomUUID();

export const contextFor = (tenantId: TenantId): TenantContext =>
  createTenantContext({ tenantId, actorId: 'user:test-operator', correlationId: randomUUID() });

export const companyInput = (overrides: Partial<CompanyInput> = {}): CompanyInput => ({
  id: newId(),
  tenantId: newId(),
  jurisdiction: TEST_JURISDICTION,
  legalName: 'Empresa de Teste, Lda.',
  nif: 'NIF-TESTE-0001',
  status: 'ACTIVE',
  createdAt: CREATED_AT,
  ...overrides,
});

export const newCompany = (overrides: Partial<CompanyInput> = {}): Company =>
  createCompany(companyInput(overrides), TEST_TAX_ID_POLICY);

export const branchInput = (
  company: Company,
  overrides: Partial<BranchInput> = {},
): BranchInput => ({
  id: newId(),
  tenantId: company.tenantId,
  companyId: company.id,
  name: 'Unidade de Teste',
  code: 'UT-01',
  sectorType: 'SUPERMARKET',
  status: 'ACTIVE',
  createdAt: CREATED_AT,
  ...overrides,
});
