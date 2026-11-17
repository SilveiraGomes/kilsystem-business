import { DomainValidationError } from './errors.js';
import { parseCompanyId, parseTenantId, type CompanyId, type TenantId } from './identifiers.js';
import {
  assertValidTaxId,
  parseJurisdiction,
  type Jurisdiction,
  type TaxIdPolicy,
} from './tax-identification.js';
import {
  assertChronology,
  parseOneOf,
  parseOptionalText,
  parseRequiredText,
  parseTimestamp,
  type Timestamp,
} from './validation.js';

/** Estados empresariais (D-025); não representam estados de licenciamento. Congelada (PD-64). */
export const COMPANY_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'SUSPENDED', 'INACTIVE'] as const);

export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/** Empresa juridicamente independente; corresponde a um único tenant (D-016, D-023). */
export interface Company {
  readonly id: CompanyId;
  /** UUID distinto de `id`, em relação 1:1 com a empresa (D-023). */
  readonly tenantId: TenantId;
  readonly jurisdiction: Jurisdiction;
  readonly legalName: string;
  readonly tradeName?: string;
  /** Atributo fiscal, não chave. Obrigatório e validado pela jurisdição quando `ACTIVE` (D-024). */
  readonly nif?: string;
  readonly status: CompanyStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface CompanyInput {
  readonly id: string;
  readonly tenantId: string;
  readonly jurisdiction: string;
  readonly legalName: string;
  readonly tradeName?: string | undefined;
  readonly nif?: string | undefined;
  readonly status: string;
  readonly createdAt: Date | string;
  /** Por omissão, igual a `createdAt`. */
  readonly updatedAt?: Date | string | undefined;
}

/**
 * Reconstrói uma empresa já aceite (ex.: lida da persistência), validando apenas invariantes
 * estruturais. Não aplica regras fiscais; para criar ou alterar empresas, usar `createCompany`.
 */
export const restoreCompany = (input: CompanyInput): Company => {
  const createdAt = parseTimestamp(input.createdAt, 'createdAt');
  const updatedAt =
    input.updatedAt === undefined ? createdAt : parseTimestamp(input.updatedAt, 'updatedAt');
  assertChronology(createdAt, updatedAt);
  const id = parseCompanyId(input.id, 'id');
  const tenantId = parseTenantId(input.tenantId);
  if ((id as string) === tenantId) {
    throw new DomainValidationError('tenantId', 'deve ser distinto do identificador da empresa');
  }
  const tradeName = parseOptionalText(input.tradeName, 'tradeName');
  const nif = parseOptionalText(input.nif, 'nif');
  const status = parseOneOf(input.status, COMPANY_STATUSES, 'status');
  if (status === 'ACTIVE' && nif === undefined) {
    throw new DomainValidationError('nif', 'é obrigatório para empresas activas');
  }

  return Object.freeze({
    id,
    tenantId,
    jurisdiction: parseJurisdiction(input.jurisdiction),
    legalName: parseRequiredText(input.legalName, 'legalName'),
    ...(tradeName === undefined ? {} : { tradeName }),
    ...(nif === undefined ? {} : { nif }),
    status,
    createdAt,
    updatedAt,
  });
};

/** Cria ou altera uma empresa, aplicando a regra fiscal da jurisdição quando `ACTIVE` (D-024). */
export const createCompany = (input: CompanyInput, taxIdPolicy: TaxIdPolicy): Company => {
  const company = restoreCompany(input);
  if (company.status === 'ACTIVE') assertValidTaxId(company.jurisdiction, company.nif, taxIdPolicy);
  return company;
};

/** Desactivação lógica (D-027); não elimina dados. */
export const deactivateCompany = (company: Company, at: Date | string): Company =>
  restoreCompany({ ...company, status: 'INACTIVE', updatedAt: at });
