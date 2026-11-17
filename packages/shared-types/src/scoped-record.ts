import { DomainValidationError } from './errors.js';
import { parseCompanyId, parseTenantId, type CompanyId, type TenantId } from './identifiers.js';
import { assertChronology, parseTimestamp, type Timestamp } from './validation.js';

// Auxiliares internos dos contratos de autorização (E1.07-D1); não exportados por `index.ts`.

export const parseCompanyScope = (
  input: { readonly companyId: string; readonly tenantId: string },
): { readonly companyId: CompanyId; readonly tenantId: TenantId } => {
  const companyId = parseCompanyId(input.companyId);
  const tenantId = parseTenantId(input.tenantId);
  if ((companyId as string) === tenantId) {
    throw new DomainValidationError('tenantId', 'deve ser distinto do identificador da empresa');
  }
  return { companyId, tenantId };
};

export const parseChronology = (
  input: { readonly createdAt: Date | string; readonly updatedAt?: Date | string | undefined },
): { readonly createdAt: Timestamp; readonly updatedAt: Timestamp } => {
  const createdAt = parseTimestamp(input.createdAt, 'createdAt');
  const updatedAt = input.updatedAt === undefined ? createdAt : parseTimestamp(input.updatedAt, 'updatedAt');
  assertChronology(createdAt, updatedAt);
  return { createdAt, updatedAt };
};
