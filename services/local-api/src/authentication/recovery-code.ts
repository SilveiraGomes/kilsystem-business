import { randomBytes as cryptoRandomBytes } from 'node:crypto';

/*
 * Código de recuperação da instalação (E1.07-D3-R1; D-233, DP-01): 160 bits de um CSPRNG, escritos em
 * Base32 de Crockford (32 símbolos, sem I, L, O nem U) em 8 grupos de 4, seguidos de um símbolo de
 * controlo (módulo 37). O controlo é público e só detecta erros de digitação: não reduz a entropia.
 * O código só existe em claro no processo que o emite ou o recebe; o que se deriva e se compara é a
 * forma normalizada dos 32 símbolos de dados (sem hífenes nem controlo).
 */

export const RECOVERY_CODE_BYTES = 20;
export const RECOVERY_CODE_BITS = RECOVERY_CODE_BYTES * 8;
export const RECOVERY_CODE_SYMBOLS = 32;
export const RECOVERY_CODE_GROUP = 4;

/** Alfabeto de dados de Crockford (valores 0–31). */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Símbolos de controlo de Crockford: os 32 de dados e, para 32–36, `*~$=U`. */
const CHECK_ALPHABET = `${CROCKFORD_ALPHABET}*~$=U`;

export class RecoveryCodeFormatError extends Error {
  override readonly name = 'RecoveryCodeFormatError';
  readonly reason = 'malformed-recovery-code';

  constructor() {
    // Nunca reproduz o valor recebido.
    super('Código de recuperação mal formado.');
  }
}

const checkSymbolOf = (symbols: string): string => {
  let remainder = 0;
  for (const symbol of symbols) remainder = (remainder * 32 + CROCKFORD_ALPHABET.indexOf(symbol)) % 37;
  return CHECK_ALPHABET.charAt(remainder);
};

const encode = (bytes: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD_ALPHABET.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return output;
};

export interface GeneratedRecoveryCode {
  /** Forma apresentada: `XXXX-…-XXXX-C`. */
  readonly formatted: string;
  /** Os 32 símbolos de dados; é o que se deriva. */
  readonly normalized: string;
}

export type RandomBytes = (size: number) => Buffer;

export const generateRecoveryCode = (randomBytes: RandomBytes = cryptoRandomBytes): GeneratedRecoveryCode => {
  const bytes = randomBytes(RECOVERY_CODE_BYTES);
  if (!Buffer.isBuffer(bytes) || bytes.length !== RECOVERY_CODE_BYTES) throw new RangeError('Fonte aleatória inválida.');
  const normalized = encode(bytes);
  bytes.fill(0);
  const groups = normalized.match(new RegExp(`.{${RECOVERY_CODE_GROUP}}`, 'g')) ?? [];
  return Object.freeze({ formatted: `${groups.join('-')}-${checkSymbolOf(normalized)}`, normalized });
};

/**
 * Normaliza a entrada (maiúsculas; sem espaços nem hífenes; `O→0`, `I/L→1`) e verifica comprimento,
 * alfabeto e controlo, sem tocar na base. Devolve os 32 símbolos de dados ou recusa com
 * `RecoveryCodeFormatError`. Limita o tamanho da entrada antes de a processar.
 */
export const parseRecoveryCode = (input: unknown): string => {
  if (typeof input !== 'string' || input.length > 256) throw new RecoveryCodeFormatError();
  const compact = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (compact.length !== RECOVERY_CODE_SYMBOLS + 1) throw new RecoveryCodeFormatError();
  const symbols = compact.slice(0, RECOVERY_CODE_SYMBOLS);
  const check = compact.slice(RECOVERY_CODE_SYMBOLS);
  for (const symbol of symbols) if (!CROCKFORD_ALPHABET.includes(symbol)) throw new RecoveryCodeFormatError();
  if (checkSymbolOf(symbols) !== check) throw new RecoveryCodeFormatError();
  return symbols;
};

/**
 * Contrato entre a operação interna que emite um código e a apresentação no terminal (D-233, DP-03 e
 * DP-08): o código só é entregue por `reveal()`, uma única vez, depois do *commit*; chamadas
 * seguintes recusam. Não é serializável: `toJSON`/`toString` nunca revelam o código, para que um
 * registo acidental do objecto não o exponha.
 */
export interface RecoveryCodePresentation {
  /** Sequência do código emitido (não secreta). */
  readonly sequence: number;
  /** Devolve o código formatado na primeira chamada; as seguintes lançam `RecoveryCodeAlreadyRevealedError`. */
  reveal(): string;
  /** Descrição sem o código (registos e depuração). */
  toString(): string;
  toJSON(): string;
}

export class RecoveryCodeAlreadyRevealedError extends Error {
  override readonly name = 'RecoveryCodeAlreadyRevealedError';

  constructor() {
    super('O código de recuperação já foi apresentado e não pode ser mostrado de novo.');
  }
}

export const createRecoveryCodePresentation = (formatted: string, sequence: number): RecoveryCodePresentation => {
  let pending: string | undefined = formatted;
  const description = `[código de recuperação n.º ${sequence}]`;
  return Object.freeze({
    reveal: (): string => {
      const value = pending;
      if (value === undefined) throw new RecoveryCodeAlreadyRevealedError();
      pending = undefined;
      return value;
    },
    sequence,
    toJSON: () => description,
    toString: () => description,
  });
};
