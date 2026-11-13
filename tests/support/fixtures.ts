import { randomUUID } from 'node:crypto';

import {
  createTenantContext,
  type BranchInput,
  type Company,
  type CompanyInput,
  type TenantContext,
  type TenantId,
} from '../../packages/shared-types/src/index';

// Dados fictícios para testes; nenhum valor corresponde a uma entidade real.
export const CREATED_AT = '2026-11-13T10:00:00.000Z';
export const UPDATED_AT = '2026-11-13T11:30:00.000Z';

export const newId = (): string => randomUUID();

export const contextFor = (tenantId: TenantId): TenantContext =>
  createTenantContext({ tenantId, actorId: 'user:test-operator', correlationId: randomUUID() });

export const companyInput = (overrides: Partial<CompanyInput> = {}): CompanyInput => ({
  id: newId(),
  tenantId: newId(),
  legalName: 'Empresa de Teste, Lda.',
  nif: 'NIF-TESTE-0001',
  status: 'ACTIVE',
  createdAt: CREATED_AT,
  ...overrides,
});

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
