import { argon2, argon2Sync, hkdfSync, timingSafeEqual } from 'node:crypto';

import { expect } from 'vitest';

import type { Argon2idDerive, PasswordHash } from '../../services/local-api/src/authentication/password-hashing';

/*
 * E1.07-PD65-T4-C1 (D-246) — derivação de palavras-passe nos testes. Por omissão os testes usam o
 * Argon2id real do Node.js (o mesmo de `password-hashing.ts`). Só os testes classificados como
 * «derivação determinística de teste permitida» em `argon2-test-classification.ts` podem trocar,
 * no início do próprio teste, para uma derivação determinística e rápida. O código de produção não
 * muda: a troca usa a injecção `passwordHashing.derive` que o serviço já aceita.
 */

/** Argon2id nativo, assíncrono, com a mesma chamada da produção (`nativeArgon2id`). */
export const nativeArgon2idForTests: Argon2idDerive = ({ message, nonce, parameters, tagLength }) =>
  new Promise<Buffer>((resolve, reject) => {
    argon2(
      'argon2id',
      { memory: parameters.memoryKiB, message, nonce, parallelism: parameters.parallelism, passes: parameters.passes, tagLength },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });

const DETERMINISTIC_INFO = 'kil-business-test-derivation-v1';

/**
 * Derivação determinística SÓ PARA TESTES (HKDF-SHA256): depende da palavra-passe, do salt, de cada
 * parâmetro e do tamanho pedido, como o Argon2id, mas sem custo de memória. Cede a vez numa
 * macrotarefa antes de responder, como a derivação nativa, para não alterar as intercalações.
 * Nunca produz o mesmo valor que o Argon2id para as mesmas entradas.
 */
export const deterministicTestDerive: Argon2idDerive = async ({ message, nonce, parameters, tagLength }) => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  const info = `${DETERMINISTIC_INFO}|m=${String(parameters.memoryKiB)}|t=${String(parameters.passes)}|p=${String(parameters.parallelism)}|l=${String(tagLength)}`;
  return Buffer.from(hkdfSync('sha256', message, nonce, info, tagLength));
};

/** A credencial guardada é um Argon2id real da palavra-passe (recalculado com os parâmetros e o salt guardados). */
export const isArgon2idHashOf = (stored: PasswordHash, password: string): boolean => {
  const expected = argon2Sync('argon2id', {
    memory: stored.memoryKiB,
    message: Buffer.from(password, 'utf8'),
    nonce: stored.salt,
    parallelism: stored.parallelism,
    passes: stored.passes,
    tagLength: stored.hash.length,
  });
  return expected.length === stored.hash.length && timingSafeEqual(expected, stored.hash);
};

export type DerivationMode = 'argon2id' | 'deterministic';

export interface DerivationCounts {
  readonly argon2id: number;
  readonly deterministic: number;
}

export interface DerivationClassification {
  /** Marcas (ex.: `[S47c]` ou o título exacto) dos testes que podem usar a derivação determinística. */
  readonly deterministicAllowed: readonly string[];
  /** Sentinelas: testes de percursos críticos que têm de derivar com Argon2id real. */
  readonly argon2idRequired: readonly string[];
}

export interface DerivationTracker {
  /** Derivação a injectar em `passwordHashing.derive`; segue o modo do teste em curso. */
  readonly derive: Argon2idDerive;
  /** Troca o teste em curso para a derivação determinística; recusa testes não autorizados. */
  readonly useDeterministic: () => void;
  readonly mode: () => DerivationMode;
  readonly counts: () => DerivationCounts;
  /** Para o `afterEach`: verifica a classificação do teste que terminou e repõe o Argon2id real. */
  readonly verifyAndReset: (testName: string) => void;
  /** Para o `beforeEach`: cada teste começa no Argon2id real, mesmo que um `afterEach` anterior tenha falhado. */
  readonly reset: () => void;
}

const marked = (testName: string, marks: readonly string[]): boolean => marks.some((mark) => testName.includes(mark));

export const createDerivationTracker = (classification: DerivationClassification): DerivationTracker => {
  let mode: DerivationMode = 'argon2id';
  let argon2id = 0;
  let deterministic = 0;
  const derive: Argon2idDerive = (input) => {
    if (mode === 'deterministic') {
      deterministic += 1;
      return deterministicTestDerive(input);
    }
    argon2id += 1;
    return nativeArgon2idForTests(input);
  };
  return Object.freeze({
    counts: () => ({ argon2id, deterministic }),
    derive,
    mode: () => mode,
    reset: () => {
      mode = 'argon2id';
      argon2id = 0;
      deterministic = 0;
    },
    useDeterministic: () => {
      const testName = expect.getState().currentTestName ?? '';
      if (!marked(testName, classification.deterministicAllowed) || marked(testName, classification.argon2idRequired)) {
        throw new Error(`Derivação determinística não autorizada para este teste (D-246): ${testName}`);
      }
      mode = 'deterministic';
    },
    verifyAndReset: (testName: string) => {
      const used = { argon2id, deterministic, mode };
      mode = 'argon2id';
      argon2id = 0;
      deterministic = 0;
      if (used.mode === 'deterministic') {
        expect(marked(testName, classification.deterministicAllowed), `não autorizado: ${testName}`).toBe(true);
        expect({ argon2id: used.argon2id }, `derivação real num teste determinístico: ${testName}`).toEqual({ argon2id: 0 });
        expect(used.deterministic, `teste determinístico sem derivações: ${testName}`).toBeGreaterThan(0);
      }
      if (marked(testName, classification.argon2idRequired)) {
        expect(used.mode, `sentinela sem Argon2id real: ${testName}`).toBe('argon2id');
        expect(used.argon2id, `sentinela sem nenhuma derivação Argon2id: ${testName}`).toBeGreaterThan(0);
        expect(used.deterministic, `sentinela com derivação determinística: ${testName}`).toBe(0);
      }
    },
  });
};
