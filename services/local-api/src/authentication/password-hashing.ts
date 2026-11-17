import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Derivação de palavras-passe com Argon2id nativo do Node.js (D-090):
 * - `crypto.argon2` existe desde a v24.7.0 e está estável desde a v24.19.0 (OpenSSL);
 * - parâmetros: segunda opção recomendada pelo RFC 9106 (secção 4): m = 64 MiB, t = 3, p = 4,
 *   salt de 128 bits e tag de 256 bits; acima do mínimo OWASP (m = 19 MiB, t = 2, p = 1);
 * - salt aleatório individual por credencial; comparação em tempo constante.
 */

export const ARGON2_ALGORITHM = 'argon2id';
/** Versão do Argon2 implementada pelo OpenSSL (v1.3 = 0x13). */
export const ARGON2_VERSION = 19;
export const SALT_BYTES = 16;
export const HASH_BYTES = 32;

export interface Argon2idParameters {
  /** Memória em blocos de 1 KiB. */
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
}

/** Parâmetros de produção (RFC 9106, segunda opção recomendada). */
export const PASSWORD_HASHING_PARAMETERS: Argon2idParameters = Object.freeze({
  memoryKiB: 65536,
  parallelism: 4,
  passes: 3,
});

/** Mínimo aceite em configuração (OWASP: m = 19 MiB, t = 2, p = 1). Nunca reduzir por velocidade. */
export const MINIMUM_PASSWORD_HASHING_PARAMETERS: Argon2idParameters = Object.freeze({
  memoryKiB: 19456,
  parallelism: 1,
  passes: 2,
});

/**
 * Limites aceites em credenciais persistidas; protegem contra registos alterados (custo abusivo).
 * Cada limite é congelado, além do objecto (E1.07-D1-H). Os valores não mudam.
 */
export const STORED_PARAMETER_BOUNDS = Object.freeze({
  hashBytes: Object.freeze({ max: 64, min: 32 }),
  memoryKiB: Object.freeze({ max: 1048576, min: 19456 }),
  parallelism: Object.freeze({ max: 16, min: 1 }),
  passes: Object.freeze({ max: 16, min: 1 }),
  saltBytes: Object.freeze({ max: 64, min: 16 }),
});

export interface PasswordHash extends Argon2idParameters {
  readonly algorithm: typeof ARGON2_ALGORITHM;
  readonly algorithmVersion: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

export type PasswordHashingErrorReason = 'invalid-parameters' | 'malformed-hash' | 'busy';

export class PasswordHashingError extends Error {
  override readonly name = 'PasswordHashingError';

  constructor(readonly reason: PasswordHashingErrorReason) {
    super(`Falha na derivação da palavra-passe: ${reason}.`);
  }
}

/** Função de derivação; substituível em testes (ex.: para controlar o momento da conclusão). */
export type Argon2idDerive = (input: {
  readonly message: Buffer;
  readonly nonce: Buffer;
  readonly parameters: Argon2idParameters;
  readonly tagLength: number;
}) => Promise<Buffer>;

const nativeArgon2id: Argon2idDerive = ({ message, nonce, parameters, tagLength }) =>
  new Promise<Buffer>((resolve, reject) => {
    argon2(
      'argon2id',
      {
        memory: parameters.memoryKiB,
        message,
        nonce,
        parallelism: parameters.parallelism,
        passes: parameters.passes,
        tagLength,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });

const within = (value: number, bounds: { readonly min: number; readonly max: number }): boolean =>
  Number.isSafeInteger(value) && value >= bounds.min && value <= bounds.max;

/** Configuração: dentro dos limites e nunca abaixo do mínimo OWASP. */
export const assertHashingParameters = (parameters: Argon2idParameters): Argon2idParameters => {
  const valid =
    within(parameters.memoryKiB, STORED_PARAMETER_BOUNDS.memoryKiB) &&
    within(parameters.passes, STORED_PARAMETER_BOUNDS.passes) &&
    within(parameters.parallelism, STORED_PARAMETER_BOUNDS.parallelism) &&
    parameters.memoryKiB >= 8 * parameters.parallelism &&
    parameters.memoryKiB >= MINIMUM_PASSWORD_HASHING_PARAMETERS.memoryKiB &&
    parameters.passes >= MINIMUM_PASSWORD_HASHING_PARAMETERS.passes;
  if (!valid) throw new PasswordHashingError('invalid-parameters');
  return Object.freeze({ ...parameters });
};

/** Credencial persistida: algoritmo, versão, parâmetros, salt e hash dentro dos limites. */
export const assertStoredHash = (stored: PasswordHash): void => {
  const valid =
    stored.algorithm === ARGON2_ALGORITHM &&
    stored.algorithmVersion === ARGON2_VERSION &&
    within(stored.memoryKiB, STORED_PARAMETER_BOUNDS.memoryKiB) &&
    within(stored.passes, STORED_PARAMETER_BOUNDS.passes) &&
    within(stored.parallelism, STORED_PARAMETER_BOUNDS.parallelism) &&
    stored.memoryKiB >= 8 * stored.parallelism &&
    Buffer.isBuffer(stored.salt) &&
    within(stored.salt.length, STORED_PARAMETER_BOUNDS.saltBytes) &&
    Buffer.isBuffer(stored.hash) &&
    within(stored.hash.length, STORED_PARAMETER_BOUNDS.hashBytes);
  if (!valid) throw new PasswordHashingError('malformed-hash');
};

export interface PasswordHasher {
  readonly parameters: Argon2idParameters;
  /** `password` já normalizado pela política (NFC). Salt aleatório novo em cada chamada. */
  hash(password: string): Promise<PasswordHash>;
  /** Recalcula com os parâmetros e o salt guardados; credencial malformada: `malformed-hash`. */
  verify(password: string, stored: PasswordHash): Promise<boolean>;
  /** Derivação com os parâmetros actuais e resultado descartado (custo equivalente sem credencial). */
  burn(password: string): Promise<void>;
  /** A credencial usa parâmetros ou tamanhos diferentes dos actuais. */
  needsRehash(stored: PasswordHash): boolean;
}

export interface PasswordHasherOptions {
  readonly parameters?: Argon2idParameters;
  /** Derivações simultâneas; as restantes aguardam em fila (limita memória e CPU). */
  readonly maxConcurrent?: number;
  /** Pedidos em espera além dos quais a derivação é recusada com `busy`. */
  readonly maxQueued?: number;
  readonly derive?: Argon2idDerive;
}

/**
 * Semáforo: no máximo `limit` tarefas activas e `maxQueued` em espera. Ao terminar, o lugar passa
 * directamente para a próxima tarefa em espera, para que nenhuma chamada nova o ocupe entretanto.
 */
const createLimiter = (limit: number, maxQueued: number) => {
  let active = 0;
  const waiting: (() => void)[] = [];
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < limit) {
      active += 1;
    } else {
      if (waiting.length >= maxQueued) throw new PasswordHashingError('busy');
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      release();
    }
  };
};

export const createPasswordHasher = ({
  derive = nativeArgon2id,
  maxConcurrent = 2,
  maxQueued = 64,
  parameters = PASSWORD_HASHING_PARAMETERS,
}: PasswordHasherOptions = {}): PasswordHasher => {
  const current = assertHashingParameters(parameters);
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || !Number.isSafeInteger(maxQueued) || maxQueued < 0) {
    throw new PasswordHashingError('invalid-parameters');
  }
  const limited = createLimiter(maxConcurrent, maxQueued);
  const run = (password: string, salt: Buffer, using: Argon2idParameters, tagLength: number): Promise<Buffer> =>
    limited(() => derive({ message: Buffer.from(password, 'utf8'), nonce: salt, parameters: using, tagLength }));

  return Object.freeze({
    parameters: current,
    hash: async (password: string): Promise<PasswordHash> => {
      const salt = randomBytes(SALT_BYTES);
      const hash = await run(password, salt, current, HASH_BYTES);
      return Object.freeze({
        algorithm: ARGON2_ALGORITHM,
        algorithmVersion: ARGON2_VERSION,
        hash,
        memoryKiB: current.memoryKiB,
        parallelism: current.parallelism,
        passes: current.passes,
        salt,
      });
    },
    verify: async (password: string, stored: PasswordHash): Promise<boolean> => {
      assertStoredHash(stored);
      const derived = await run(password, stored.salt, stored, stored.hash.length);
      return derived.length === stored.hash.length && timingSafeEqual(derived, stored.hash);
    },
    burn: async (password: string): Promise<void> => {
      await run(password, randomBytes(SALT_BYTES), current, HASH_BYTES);
    },
    needsRehash: (stored: PasswordHash): boolean =>
      stored.memoryKiB !== current.memoryKiB ||
      stored.passes !== current.passes ||
      stored.parallelism !== current.parallelism ||
      stored.salt.length !== SALT_BYTES ||
      stored.hash.length !== HASH_BYTES,
  });
};
