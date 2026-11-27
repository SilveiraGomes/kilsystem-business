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
const deterministicCore: Argon2idDerive = async ({ message, nonce, parameters, tagLength }) => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  const info = `${DETERMINISTIC_INFO}|m=${String(parameters.memoryKiB)}|t=${String(parameters.passes)}|p=${String(parameters.parallelism)}|l=${String(tagLength)}`;
  return Buffer.from(hkdfSync('sha256', message, nonce, info, tagLength));
};

const marked = (testName: string, marks: readonly string[]): boolean => marks.some((mark) => testName.includes(mark));

/** Ligação de um *tracker* aos *hooks* de um ficheiro, observada pela guarda (PD-87, RV-02). */
interface TrackerHooks {
  readonly begin: () => void;
  readonly problems: (testName: string) => readonly string[];
}

/**
 * E1.07-PD87 (RV-02) — guarda da ligação dos *trackers* aos *hooks*. Os *hooks* globais de
 * `tests/setup.ts` chamam `beginTest()` antes dos `beforeEach` de cada ficheiro e `endTest()` depois
 * dos `afterEach` (ordem `stack`). Para cada *tracker* registado, `endTest()` devolve um problema se
 * o teste não começou com `reset()` antes de qualquer derivação, ou se `verifyAndReset()` não correu
 * para esse teste; se o número de *trackers* registados não for o esperado para o ficheiro; e se houve
 * derivações determinísticas fora de um *tracker* num teste não listado em `directAllowed`. Assim, retirar a verificação ou a reposição de um ficheiro, ou substituir a
 * derivação sem autorização, faz falhar cada teste afectado, e não só as sentinelas.
 */
export interface GuardExpectations {
  /** Marcas dos testes que podem derivar com a derivação determinística fora de um *tracker*. */
  readonly directAllowed: readonly string[];
  /** Número de *trackers* de ficheiro que têm de estar registados (1 nos ficheiros classificados, 0 nos outros). */
  readonly expectedTrackers: number;
}

export interface DerivationGuard {
  readonly track: (hooks: TrackerHooks) => void;
  readonly tracked: () => number;
  readonly beginTest: () => void;
  readonly countDirect: () => void;
  readonly endTest: (testName: string, expectations: GuardExpectations) => readonly string[];
}

export const createDerivationGuard = (): DerivationGuard => {
  const trackers: TrackerHooks[] = [];
  let direct = 0;
  return Object.freeze({
    beginTest: () => {
      direct = 0;
      for (const tracker of trackers) tracker.begin();
    },
    countDirect: () => {
      direct += 1;
    },
    endTest: (testName: string, { directAllowed, expectedTrackers }: GuardExpectations) => {
      const problems = trackers.flatMap((tracker) => tracker.problems(testName));
      if (trackers.length !== expectedTrackers) {
        problems.push(`trackers de derivação registados: ${String(trackers.length)}, esperados: ${String(expectedTrackers)}: ${testName}`);
      }
      if (direct > 0 && !marked(testName, directAllowed)) {
        problems.push(`derivação determinística fora de um tracker autorizado (${String(direct)}×): ${testName}`);
      }
      direct = 0;
      return problems;
    },
    track: (hooks: TrackerHooks) => {
      trackers.push(hooks);
    },
    tracked: () => trackers.length,
  });
};

/** Guarda do ficheiro de testes em curso, ligada aos *hooks* globais de `tests/setup.ts`. */
export const fileDerivationGuard = createDerivationGuard();

/**
 * Derivação determinística SÓ PARA TESTES, chamada directamente (fora de um *tracker*). Cada chamada
 * é contada pela guarda: só os testes de `DIRECT_DETERMINISTIC_ALLOWED` a podem usar (PD-87).
 */
export const deterministicTestDerive: Argon2idDerive = (input) => {
  fileDerivationGuard.countDirect();
  return deterministicCore(input);
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

export interface DerivationTrackerOptions {
  /** Só para os testes da própria guarda (T4C-07). */
  readonly guard?: DerivationGuard;
}

/**
 * Um *tracker* criado fora de um teste (ao nível do `describe` de um ficheiro) é registado na guarda do
 * ficheiro e tem de ser reposto e verificado em cada teste desse ficheiro. Um *tracker* criado dentro
 * de um teste (os casos sintéticos de T4C-03/T4C-04) é efémero e não é registado.
 */
export const createDerivationTracker = (
  classification: DerivationClassification,
  options: DerivationTrackerOptions = {},
): DerivationTracker => {
  let mode: DerivationMode = 'argon2id';
  let argon2id = 0;
  let deterministic = 0;
  let begun = false;
  let resetSeen = false;
  let lateReset = false;
  let activity = false;
  let verifiedFor: string | undefined;
  const derive: Argon2idDerive = (input) => {
    activity = true;
    if (mode === 'deterministic') {
      deterministic += 1;
      return deterministicCore(input);
    }
    argon2id += 1;
    return nativeArgon2idForTests(input);
  };
  const guard = options.guard ?? (expect.getState().currentTestName === undefined ? fileDerivationGuard : undefined);
  guard?.track({
    begin: () => {
      begun = true;
      resetSeen = false;
      lateReset = false;
      activity = false;
      verifiedFor = undefined;
    },
    problems: (testName: string) => {
      if (!begun) return [];
      begun = false;
      const problems: string[] = [];
      if (!resetSeen) problems.push(`tracker não reposto antes do teste (reset() no beforeEach): ${testName}`);
      if (lateReset) problems.push(`reset() depois de o teste ter começado a derivar: ${testName}`);
      if (verifiedFor !== testName) problems.push(`verificação do tracker não executada (verifyAndReset() no afterEach): ${testName}`);
      return problems;
    },
  });
  return Object.freeze({
    counts: () => ({ argon2id, deterministic }),
    derive,
    mode: () => mode,
    reset: () => {
      if (begun && activity) lateReset = true;
      resetSeen = true;
      mode = 'argon2id';
      argon2id = 0;
      deterministic = 0;
    },
    useDeterministic: () => {
      activity = true;
      const testName = expect.getState().currentTestName ?? '';
      if (!marked(testName, classification.deterministicAllowed) || marked(testName, classification.argon2idRequired)) {
        throw new Error(`Derivação determinística não autorizada para este teste (D-246): ${testName}`);
      }
      mode = 'deterministic';
    },
    verifyAndReset: (testName: string) => {
      verifiedFor = testName;
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
