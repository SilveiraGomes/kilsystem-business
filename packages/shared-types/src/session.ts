import { DomainValidationError } from './errors.js';
import { parseUuid, type Brand } from './validation.js';

/*
 * Contratos de sessões locais (E1.07-C). Uma sessão comprova apenas uma identidade autenticada
 * pelo serviço local: não contém empresa, tenant, âmbito nem permissões, e não é uma autorização
 * empresarial (D-106). A autorização é derivada internamente em E1.07-D.
 */

/** Identificador público e não secreto de uma sessão (UUID). Nunca serve para autenticar. */
export type SessionId = Brand<string, 'SessionId'>;

export const parseSessionId = (value: unknown, field = 'sessionId'): SessionId => parseUuid(value, field) as SessionId;

/**
 * Motivos de revogação persistidos; a lista é igual à da restrição `CHECK` da migração 4.
 * Congelada em execução (E1.07-D1-H, PD-64).
 */
export const SESSION_REVOCATION_REASONS = Object.freeze([
  'logout',
  'administrative',
  'user-sessions-revoked',
  'identity-status-changed',
  'credential-replaced',
  'security-version-changed',
  'service-restarted',
  'idle-timeout',
  'absolute-timeout',
] as const);

export type SessionRevocationReason = (typeof SESSION_REVOCATION_REASONS)[number];

/** Política de sessões; todos os valores são finitos e limitados (nunca ilimitados). */
export interface SessionPolicy {
  /** Inactividade máxima, em segundos. */
  readonly idleTimeoutSeconds: number;
  /** Duração absoluta máxima desde a criação, em segundos; nunca é prolongada pela actividade. */
  readonly absoluteLifetimeSeconds: number;
  /** Sessões efectivamente válidas em simultâneo por identidade. */
  readonly maxActiveSessionsPerUser: number;
  /** Validade do comprovativo interno de autenticação, em segundos. */
  readonly proofValiditySeconds: number;
  /** Dias de conservação dos registos de sessões terminadas antes da limpeza técnica. */
  readonly sessionRetentionDays: number;
}

/** Valores iniciais aprovados para E1.07-C. */
export const DEFAULT_SESSION_POLICY: SessionPolicy = Object.freeze({
  absoluteLifetimeSeconds: 43200,
  idleTimeoutSeconds: 1800,
  maxActiveSessionsPerUser: 5,
  proofValiditySeconds: 60,
  sessionRetentionDays: 30,
});

/** Limites seguros (inclusivos) aceites em configuração. */
export const SESSION_POLICY_LIMITS: Readonly<Record<keyof SessionPolicy, { readonly min: number; readonly max: number }>> =
  Object.freeze({
    absoluteLifetimeSeconds: Object.freeze({ max: 86400, min: 300 }),
    idleTimeoutSeconds: Object.freeze({ max: 28800, min: 60 }),
    maxActiveSessionsPerUser: Object.freeze({ max: 20, min: 1 }),
    proofValiditySeconds: Object.freeze({ max: 60, min: 5 }),
    sessionRetentionDays: Object.freeze({ max: 365, min: 1 }),
  });

const POLICY_KEYS = Object.keys(DEFAULT_SESSION_POLICY) as readonly (keyof SessionPolicy)[];

/**
 * Valida uma configuração parcial sobre os valores iniciais. Recusa propriedades desconhecidas,
 * valores não inteiros, fora dos limites, e inactividade superior à duração absoluta.
 */
export const parseSessionPolicy = (input: unknown = {}): SessionPolicy => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DomainValidationError('sessionPolicy', 'deve ser um objecto');
  }
  const record = input as Readonly<Record<string, unknown>>;
  for (const key of Object.keys(record)) {
    if (!POLICY_KEYS.includes(key as keyof SessionPolicy)) {
      throw new DomainValidationError('sessionPolicy', 'contém uma propriedade desconhecida');
    }
  }
  const policy = Object.fromEntries(
    POLICY_KEYS.map((key) => {
      const value = record[key] ?? DEFAULT_SESSION_POLICY[key];
      const { max, min } = SESSION_POLICY_LIMITS[key];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
        throw new DomainValidationError(key, `deve ser um inteiro entre ${min} e ${max}`);
      }
      return [key, value];
    }),
  ) as unknown as SessionPolicy;
  if (policy.idleTimeoutSeconds > policy.absoluteLifetimeSeconds) {
    throw new DomainValidationError('idleTimeoutSeconds', 'não pode exceder a duração absoluta');
  }
  return Object.freeze(policy);
};
