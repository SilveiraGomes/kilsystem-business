import { DomainValidationError } from './errors.js';

export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

/** Instante em ISO 8601 UTC (`toISOString`), imutável e serializável. */
export type Timestamp = Brand<string, 'Timestamp'>;

/** Limite técnico de segurança para texto livre; não representa uma regra legal. */
export const MAX_TEXT_LENGTH = 255;

// Forma canónica: minúsculas, versões 1 a 8 e variante RFC 9562. Exclui o UUID nulo.
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

export const isCanonicalUuid = (value: unknown): value is string =>
  typeof value === 'string' && CANONICAL_UUID.test(value);

export const parseUuid = (value: unknown, field: string): string => {
  const candidate = typeof value === 'string' ? value.toLowerCase() : value;
  if (!isCanonicalUuid(candidate)) throw new DomainValidationError(field, 'deve ser um UUID válido');
  return candidate;
};

export const isRequiredText = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= MAX_TEXT_LENGTH;

export const parseRequiredText = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new DomainValidationError(field, 'deve ser texto');
  const text = value.trim();
  if (text.length === 0) throw new DomainValidationError(field, 'é obrigatório');
  if (text.length > MAX_TEXT_LENGTH) {
    throw new DomainValidationError(field, `excede ${MAX_TEXT_LENGTH} caracteres`);
  }
  return text;
};

export const parseOptionalText = (value: unknown, field: string): string | undefined =>
  value === undefined || value === null ? undefined : parseRequiredText(value, field);

export const parseOneOf = <const Allowed extends readonly string[]>(
  value: unknown,
  allowed: Allowed,
  field: string,
): Allowed[number] => {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new DomainValidationError(field, 'não é um valor permitido');
  return match;
};

export const parseTimestamp = (value: unknown, field: string): Timestamp => {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' && ISO_TIMESTAMP.test(value)
        ? new Date(value)
        : undefined;
  if (date === undefined || Number.isNaN(date.getTime())) {
    throw new DomainValidationError(field, 'deve ser uma data ISO 8601 válida');
  }
  return date.toISOString() as Timestamp;
};

export const assertChronology = (createdAt: Timestamp, updatedAt: Timestamp): void => {
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new DomainValidationError('updatedAt', 'não pode ser anterior a createdAt');
  }
};
