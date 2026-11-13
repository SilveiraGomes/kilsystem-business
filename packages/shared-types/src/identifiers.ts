import { DomainValidationError } from './errors.js';
import { isRequiredText, parseRequiredText, parseUuid, type Brand } from './validation.js';

// Marcas distintas impedem, em compilação, trocar identificadores entre entidades.
export type TenantId = Brand<string, 'TenantId'>;
export type CompanyId = Brand<string, 'CompanyId'>;
export type BranchId = Brand<string, 'BranchId'>;
export type ActorId = Brand<string, 'ActorId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;

/** Limite de comprimento para identificadores de actor e de correlação. */
export const MAX_TRACE_ID_LENGTH = 128;

export const parseTenantId = (value: unknown, field = 'tenantId'): TenantId =>
  parseUuid(value, field) as TenantId;

export const parseCompanyId = (value: unknown, field = 'companyId'): CompanyId =>
  parseUuid(value, field) as CompanyId;

export const parseBranchId = (value: unknown, field = 'branchId'): BranchId =>
  parseUuid(value, field) as BranchId;

export const isTraceId = (value: unknown): value is string =>
  isRequiredText(value) && value === value.trim() && value.length <= MAX_TRACE_ID_LENGTH;

const parseTraceId = (value: unknown, field: string): string => {
  const text = parseRequiredText(value, field);
  if (text.length > MAX_TRACE_ID_LENGTH) {
    throw new DomainValidationError(field, `excede ${MAX_TRACE_ID_LENGTH} caracteres`);
  }
  return text;
};

/** Identidade do operador ou serviço que executa a operação. */
export const parseActorId = (value: unknown, field = 'actorId'): ActorId =>
  parseTraceId(value, field) as ActorId;

export const parseCorrelationId = (value: unknown, field = 'correlationId'): CorrelationId =>
  parseTraceId(value, field) as CorrelationId;
