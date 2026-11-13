import { parseCompanyId, parseTenantId, type CompanyId, type TenantId } from './identifiers.js';
import {
  assertChronology,
  parseOneOf,
  parseOptionalText,
  parseRequiredText,
  parseTimestamp,
  type Timestamp,
} from './validation.js';

export const COMPANY_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/** Empresa juridicamente independente; corresponde a um único tenant (D-016). */
export interface Company {
  readonly id: CompanyId;
  readonly tenantId: TenantId;
  readonly legalName: string;
  readonly tradeName?: string;
  /** Atributo fiscal; não é chave. Formato por validar contra fonte normativa. */
  readonly nif: string;
  readonly status: CompanyStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface CompanyInput {
  readonly id: string;
  readonly tenantId: string;
  readonly legalName: string;
  readonly tradeName?: string | undefined;
  readonly nif: string;
  readonly status: string;
  readonly createdAt: Date | string;
  /** Por omissão, igual a `createdAt`. */
  readonly updatedAt?: Date | string | undefined;
}

export const createCompany = (input: CompanyInput): Company => {
  const createdAt = parseTimestamp(input.createdAt, 'createdAt');
  const updatedAt =
    input.updatedAt === undefined ? createdAt : parseTimestamp(input.updatedAt, 'updatedAt');
  assertChronology(createdAt, updatedAt);
  const tradeName = parseOptionalText(input.tradeName, 'tradeName');

  return Object.freeze({
    id: parseCompanyId(input.id, 'id'),
    tenantId: parseTenantId(input.tenantId),
    legalName: parseRequiredText(input.legalName, 'legalName'),
    ...(tradeName === undefined ? {} : { tradeName }),
    nif: parseRequiredText(input.nif, 'nif'),
    status: parseOneOf(input.status, COMPANY_STATUSES, 'status'),
    createdAt,
    updatedAt,
  });
};
