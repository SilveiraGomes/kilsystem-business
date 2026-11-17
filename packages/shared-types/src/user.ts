import { DomainValidationError } from './errors.js';
import { parseUserId, type UserId } from './identifiers.js';
import {
  assertChronology,
  parseOneOf,
  parseRequiredText,
  parseTimestamp,
  type Timestamp,
} from './validation.js';

/**
 * Estados administrativos da identidade (D-080). `ACTIVE` significa disponibilidade administrativa;
 * não significa autenticação concluída nem existência de credenciais. Congelada em execução
 * (E1.07-D1-H, PD-64): os validadores consultam esta lista.
 */
export const USER_STATUSES = Object.freeze(['ACTIVE', 'SUSPENDED', 'INACTIVE'] as const);

export type UserStatus = (typeof USER_STATUSES)[number];

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 64;
/** Limite estrutural de endereços de correio (RFC 5321, caminho completo). */
export const MAX_EMAIL_LENGTH = 254;
export const MAX_PHONE_LENGTH = 32;

/**
 * Identidade local de um utilizador, pertencente à autoridade da instalação. Não contém
 * credenciais (palavra-passe, hash, PIN, tokens ou segredos) e não concede acesso a nenhuma
 * empresa: o acesso resulta exclusivamente de associações explícitas (D-081).
 */
export interface User {
  readonly id: UserId;
  /** Identificador local de acesso, normalizado por `normalizeUsername` e único na instalação. */
  readonly username: string;
  readonly displayName: string;
  /** Contacto opcional; não é chave nem tem unicidade exigida. */
  readonly email?: string;
  /** Contacto opcional; não é chave nem tem unicidade exigida. */
  readonly phone?: string;
  readonly status: UserStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface UserInput {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
  readonly status: string;
  readonly createdAt: Date | string;
  /** Por omissão, igual a `createdAt`. */
  readonly updatedAt?: Date | string | undefined;
}

// Validação feita ANTES da conversão para minúsculas: caracteres Unicode que se convertem em
// ASCII (ex.: o sinal Kelvin U+212A → `k`) são recusados em vez de normalizados.
const USERNAME_PATTERN = new RegExp(`^[A-Za-z0-9._-]{${USERNAME_MIN_LENGTH},${USERNAME_MAX_LENGTH}}$`);
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const PHONE_PATTERN = /^\+?[0-9 ()-]+$/;
const MIN_PHONE_DIGITS = 3;

/**
 * Normalização do username (D-085): remove espaços nas extremidades, exige 3 a 64 caracteres
 * ASCII entre letras, algarismos, ponto, hífen e sublinhado, e converte para minúsculas.
 * A unicidade é aplicada sobre o valor normalizado (insensível a maiúsculas).
 */
export const normalizeUsername = (value: unknown, field = 'username'): string => {
  if (typeof value !== 'string') throw new DomainValidationError(field, 'deve ser texto');
  const candidate = value.trim();
  if (!USERNAME_PATTERN.test(candidate)) {
    throw new DomainValidationError(
      field,
      `deve ter ${USERNAME_MIN_LENGTH} a ${USERNAME_MAX_LENGTH} caracteres ASCII entre letras, algarismos, '.', '-' e '_'`,
    );
  }
  return candidate.toLowerCase();
};

/** Verificação estrutural; não valida a existência da caixa de correio. */
const parseOptionalEmail = (value: unknown, field = 'email'): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const email = parseRequiredText(value, field);
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new DomainValidationError(field, 'não é um endereço de correio estruturalmente válido');
  }
  return email;
};

/** Verificação estrutural; não aplica planos de numeração nacionais. */
const parseOptionalPhone = (value: unknown, field = 'phone'): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const phone = parseRequiredText(value, field);
  const digits = phone.replace(/\D/g, '').length;
  if (phone.length > MAX_PHONE_LENGTH || !PHONE_PATTERN.test(phone) || digits < MIN_PHONE_DIGITS) {
    throw new DomainValidationError(field, 'não é um número de telefone estruturalmente válido');
  }
  return phone;
};

/**
 * Cria ou reconstrói uma identidade. Só os campos do contrato são copiados: qualquer outra
 * propriedade recebida (incluindo credenciais) é descartada.
 */
export const createUser = (input: UserInput): User => {
  const createdAt = parseTimestamp(input.createdAt, 'createdAt');
  const updatedAt =
    input.updatedAt === undefined ? createdAt : parseTimestamp(input.updatedAt, 'updatedAt');
  assertChronology(createdAt, updatedAt);
  const email = parseOptionalEmail(input.email);
  const phone = parseOptionalPhone(input.phone);

  return Object.freeze({
    id: parseUserId(input.id, 'id'),
    username: normalizeUsername(input.username),
    displayName: parseRequiredText(input.displayName, 'displayName'),
    ...(email === undefined ? {} : { email }),
    ...(phone === undefined ? {} : { phone }),
    status: parseOneOf(input.status, USER_STATUSES, 'status'),
    createdAt,
    updatedAt,
  });
};

/** Alteração controlada do estado; o resto da identidade mantém-se. */
export const changeUserStatus = (user: User, status: UserStatus, at: Date | string): User =>
  createUser({ ...user, status, updatedAt: at });

/**
 * Elegibilidade para autenticação futura (E1.07-B): só identidades `ACTIVE`. Não é autenticação
 * nem autorização; uma identidade elegível continua sem acesso a empresas sem associação.
 */
export const isUserEligible = (user: User): boolean => user.status === 'ACTIVE';
