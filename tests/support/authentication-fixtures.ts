import type { Argon2idParameters } from '../../services/local-api/src/authentication/password-hashing';

// Palavras-passe fictícias, exclusivas para testes; nunca correspondem a credenciais reais.
export const TEST_PASSWORD = 'cavalo correcto bateria agrafo';
export const OTHER_TEST_PASSWORD = 'outra frase de teste bastante longa';
export const UNICODE_TEST_PASSWORD = 'Frase fictícia — açúcar ☕ 東京 2026';

/**
 * Parâmetros de teste: exactamente o mínimo aceite (OWASP m = 19 MiB, t = 2, p = 1), para
 * manter a suite rápida sem usar valores inseguros. A produção usa `PASSWORD_HASHING_PARAMETERS`.
 */
export const TEST_HASHING_PARAMETERS: Argon2idParameters = Object.freeze({
  memoryKiB: 19456,
  parallelism: 1,
  passes: 2,
});

/**
 * Relógio controlável: começa num instante fixo e só avança quando o teste o manda.
 * `advanceSeconds` avança o relógio de parede e o monotónico; `set` muda só o relógio de parede
 * (simula um acerto ou um salto do relógio do sistema).
 */
export interface TestClock {
  readonly now: () => Date;
  /** Milissegundos monotónicos (E1.07-C); nunca recuam. */
  readonly monotonic: () => number;
  readonly advanceSeconds: (seconds: number) => void;
  readonly set: (iso: string) => void;
}

export const createTestClock = (start = '2026-11-16T08:00:00.000Z'): TestClock => {
  let current = Date.parse(start);
  let monotonic = 0;
  return {
    advanceSeconds: (seconds) => {
      current += seconds * 1000;
      monotonic += seconds * 1000;
    },
    monotonic: () => monotonic,
    now: () => new Date(current),
    set: (iso) => {
      current = Date.parse(iso);
    },
  };
};

/** Promessa controlada pelo teste. */
export const deferred = <T = void>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};
