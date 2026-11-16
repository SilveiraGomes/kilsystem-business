/*
 * Política de palavras-passe (D-091), baseada em NIST SP 800-63B (revisão 4, secção 3.1.1.2):
 * - comprimento contado em code points Unicode após normalização NFC;
 * - mínimo de 15 (palavra-passe como único factor) e máximo documentado de 256, sem truncamento;
 * - espaços e Unicode permitidos; sem regras de composição; sem remover espaços nem mudar a caixa;
 * - comparação com uma lista local de palavras-passe comuns ou comprometidas (palavra-passe
 *   inteira), sem envio para serviços externos.
 *
 * O valor normalizado é o que se deriva: criação e autenticação usam a mesma normalização.
 */

export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 256;
/** Limite bruto, em unidades UTF-16, verificado antes de normalizar ou derivar (custo limitado). */
export const PASSWORD_MAX_INPUT_UNITS = 1024;

export type PasswordPolicyViolation =
  | 'not-text'
  | 'too-short'
  | 'too-long'
  | 'malformed-unicode'
  | 'control-character'
  | 'single-repeated-character'
  | 'matches-username'
  | 'common-password';

/** A mensagem indica a regra violada (NIST exige indicar o motivo) e nunca o valor recebido. */
export class PasswordPolicyError extends Error {
  override readonly name = 'PasswordPolicyError';

  constructor(readonly violation: PasswordPolicyViolation) {
    super(`A palavra-passe não cumpre a política: ${violation}.`);
  }
}

/** Lista local de palavras-passe comuns ou comprometidas; comparação da palavra-passe inteira. */
export interface CommonPasswordList {
  readonly includes: (normalizedPassword: string) => boolean;
}

const comparable = (value: string): string => value.normalize('NFC').toLowerCase();

/** Constrói uma lista a partir de entradas locais; a comparação ignora maiúsculas. */
export const createCommonPasswordList = (entries: Iterable<string>): CommonPasswordList => {
  const listed = new Set<string>();
  for (const entry of entries) listed.add(comparable(entry));
  return Object.freeze({ includes: (normalizedPassword: string) => listed.has(comparable(normalizedPassword)) });
};

/**
 * Lista vazia por omissão: a fonte e a actualização de uma lista real de palavras-passe
 * comprometidas, mantida localmente, estão pendentes (PD-33). A regra continua activa e é
 * configurável pelo serviço local.
 */
export const EMPTY_COMMON_PASSWORD_LIST: CommonPasswordList = createCommonPasswordList([]);

// Sequências UTF-16 mal formadas (surrogates isolados) não têm codificação UTF-8 estável.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * Validação estrutural e normalização NFC, sem regras de criação. Usada na autenticação: uma
 * credencial já aceite nunca é recusada por alterações posteriores à política.
 */
export const normalizePasswordInput = (value: unknown): string => {
  if (typeof value !== 'string') throw new PasswordPolicyError('not-text');
  if (value.length > PASSWORD_MAX_INPUT_UNITS) throw new PasswordPolicyError('too-long');
  if (LONE_SURROGATE.test(value)) throw new PasswordPolicyError('malformed-unicode');
  if (CONTROL_CHARACTER.test(value)) throw new PasswordPolicyError('control-character');
  const normalized = value.normalize('NFC');
  if ([...normalized].length > PASSWORD_MAX_LENGTH) throw new PasswordPolicyError('too-long');
  if (normalized.length === 0) throw new PasswordPolicyError('too-short');
  return normalized;
};

export interface PasswordPolicyOptions {
  /** Username normalizado da identidade: a palavra-passe não pode ser igual a ele. */
  readonly username: string;
  readonly commonPasswords?: CommonPasswordList;
}

/** Regras de criação de uma nova palavra-passe; devolve o valor normalizado a derivar. */
export const preparePassword = (value: unknown, options: PasswordPolicyOptions): string => {
  const normalized = normalizePasswordInput(value);
  const codePoints = [...normalized];
  if (codePoints.length < PASSWORD_MIN_LENGTH) throw new PasswordPolicyError('too-short');
  if (new Set(codePoints).size === 1) throw new PasswordPolicyError('single-repeated-character');
  if (comparable(normalized) === comparable(options.username)) throw new PasswordPolicyError('matches-username');
  if ((options.commonPasswords ?? EMPTY_COMMON_PASSWORD_LIST).includes(normalized)) {
    throw new PasswordPolicyError('common-password');
  }
  return normalized;
};
