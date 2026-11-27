import { argon2, argon2Sync, hkdfSync, timingSafeEqual } from 'node:crypto';

import { expect, type RunnerTask, type RunnerTestFile, type RunnerTestSuite } from 'vitest';

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
 * E1.07-PD87 (RV-02) — guarda da ligação dos *trackers* aos *hooks*. O `aroundEach` global de
 * `tests/setup.ts` chama `beginTest()` antes dos `beforeEach` de cada ficheiro e `endTest()` depois
 * de todos os `afterEach`, mesmo que um deles lance (PD87-C2, RV-C1M-04). Para cada *tracker* registado, `endTest()` devolve um problema se
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

export interface GuardCounts {
  /** Testes começados por `beginTest()` neste ficheiro. */
  readonly begun: number;
  /** Testes terminados por `endTest()` neste ficheiro. */
  readonly ended: number;
  /** Teste começado e ainda não terminado. */
  readonly active: string | undefined;
}

/** O que o Vitest executou num ficheiro, para o `afterAll` (ver `fileExecution`). */
export interface FileExecution {
  /** Testes que correram com os *hooks*: terminados (`pass`/`fail`) ou ignorados em execução. */
  readonly executed: number;
  /** Nomes completos dos testes ignorados em execução (`context.skip()`). */
  readonly skippedAtRuntime: readonly string[];
}

export interface DerivationGuard {
  readonly track: (hooks: TrackerHooks) => void;
  readonly tracked: () => number;
  /** Lança se o teste anterior não foi terminado por `endTest()` (a desmontagem da guarda não correu). */
  readonly beginTest: (testName: string) => void;
  readonly countDirect: () => void;
  readonly endTest: (testName: string, expectations: GuardExpectations) => readonly string[];
  readonly counts: () => GuardCounts;
  /**
   * Para o `afterAll`: cada teste executado no ficheiro foi começado e terminado pela guarda; cada
   * teste ignorado em execução consta de `allowedRuntimeSkips` e não teve problemas da guarda.
   */
  readonly finishFile: (execution: FileExecution, allowedRuntimeSkips: readonly string[]) => readonly string[];
}

/*
 * E1.07-PD87-C1 (RV-PD87M-01) — a guarda não pode ser desligada em silêncio. Um teste terminado sem
 * ter sido começado (o `beforeEach` da guarda não correu: retirado, ou sob uma condição sempre
 * falsa) é um problema desse teste, e cada *tracker* registado e não começado também; um teste
 * começado sem o anterior ter terminado faz falhar o `beforeEach`; e no fim do ficheiro o número de
 * testes executados tem de coincidir com os começados e terminados. Nenhum destes controlos depende
 * do texto de `tests/setup.ts`.
 *
 * E1.07-PD87-C2 (RV-C1M-01) — um teste ignorado em execução (`context.skip()`) correu os *hooks*, por
 * isso conta como executado; mas o Vitest substitui o seu resultado por `skip` e descarta os erros dos
 * `afterEach`, incluindo os da guarda. Por isso `endTest()` guarda os problemas de cada teste e
 * `finishFile()` comunica os de um teste que acabou ignorado, e recusa um ignorado em execução que não
 * conste de `allowedRuntimeSkips`: um teste crítico não pode ser ignorado em silêncio.
 */
export const createDerivationGuard = (): DerivationGuard => {
  const trackers: TrackerHooks[] = [];
  const reported = new Map<string, readonly string[]>();
  let direct = 0;
  let active: string | undefined;
  let begun = 0;
  let ended = 0;
  return Object.freeze({
    beginTest: (testName: string) => {
      const unfinished = active;
      begun += 1;
      active = testName;
      direct = 0;
      for (const tracker of trackers) tracker.begin();
      if (unfinished !== undefined) {
        throw new Error(`guarda de derivação (PD-87): endTest() não executado para o teste anterior (afterEach da guarda): ${unfinished}`);
      }
    },
    counts: () => ({ active, begun, ended }),
    countDirect: () => {
      direct += 1;
    },
    endTest: (testName: string, { directAllowed, expectedTrackers }: GuardExpectations) => {
      const problems: string[] = [];
      if (active !== testName) problems.push(`beginTest() não executado para este teste (guarda inactiva no beforeEach): ${testName}`);
      ended += 1;
      active = undefined;
      problems.push(...trackers.flatMap((tracker) => tracker.problems(testName)));
      if (trackers.length !== expectedTrackers) {
        problems.push(`trackers de derivação registados: ${String(trackers.length)}, esperados: ${String(expectedTrackers)}: ${testName}`);
      }
      if (direct > 0 && !marked(testName, directAllowed)) {
        problems.push(`derivação determinística fora de um tracker autorizado (${String(direct)}×): ${testName}`);
      }
      direct = 0;
      if (problems.length > 0) reported.set(testName, problems);
      return problems;
    },
    finishFile: ({ executed, skippedAtRuntime }: FileExecution, allowedRuntimeSkips: readonly string[]) => {
      const problems: string[] = [];
      if (active !== undefined) problems.push(`endTest() não executado para o último teste (desmontagem da guarda): ${active}`);
      if (begun !== executed || ended !== executed) {
        problems.push(`testes executados: ${String(executed)}, começados pela guarda: ${String(begun)}, terminados: ${String(ended)}`);
      }
      for (const testName of skippedAtRuntime) {
        if (!marked(testName, allowedRuntimeSkips)) problems.push(`teste ignorado em execução sem autorização (RUNTIME_SKIP_ALLOWED): ${testName}`);
        const discarded = reported.get(testName);
        if (discarded !== undefined) {
          problems.push(`problemas da guarda num teste ignorado em execução (descartados pelo Vitest): ${testName}\n${discarded.join('\n')}`);
        }
      }
      reported.clear();
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

type RunnerTest = Extract<RunnerTask, { readonly type: 'test' }>;

const testsOf = (suite: Readonly<RunnerTestSuite | RunnerTestFile>): readonly RunnerTest[] =>
  suite.tasks.flatMap((task: RunnerTask): readonly RunnerTest[] => {
    if (task.type === 'suite') return testsOf(task);
    return task.type === 'test' ? [task] : [];
  });

/** `pending` existe no resultado em execução do Vitest 5.1.0, mas não no tipo público. */
const isPending = (result: unknown): boolean =>
  typeof result === 'object' && result !== null && 'pending' in result && result.pending === true;

/** Ignorado em execução: o Vitest correu os *hooks* e depois marcou o teste `skip` com `pending`. */
export const skippedAtRuntime = (test: RunnerTest): boolean => test.mode === 'skip' && isPending(test.result);

/** Terminado com os *hooks*: `pass` ou `fail` (num `it.fails`, depois da inversão). */
const ranToTheEnd = (test: RunnerTest): boolean =>
  test.mode === 'run' && (test.result?.state === 'pass' || test.result?.state === 'fail');

/**
 * Testes de um ficheiro (ou *suite*) que o Vitest executou — com os *hooks*, portanto —, para o
 * `afterAll`: os terminados e os ignorados em execução (PD87-C2, RV-C1M-01). Os ignorados antes de
 * correr (`skip`, `skipIf`, `todo`, filtrados por `-t`) não contam.
 */
export const fileExecution = (suite: Readonly<RunnerTestSuite | RunnerTestFile>): FileExecution => {
  const tests = testsOf(suite);
  const skipped = tests.filter(skippedAtRuntime);
  return {
    executed: tests.filter(ranToTheEnd).length + skipped.length,
    skippedAtRuntime: skipped.map((test) => test.fullTestName),
  };
};

/** Testes `it.fails` que correram (com qualquer resultado), para a verificação das razões (PD87-C2, RV-C1M-02). */
export const failingTestsRun = (suite: Readonly<RunnerTestSuite | RunnerTestFile>): readonly RunnerTest[] =>
  testsOf(suite).filter((test) => test.fails === true && ranToTheEnd(test));

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
      // PD87-C1 (RV-PD87M-01): um tracker registado que a guarda não começou já não fica sem verificação.
      if (!begun) return [`tracker não iniciado pela guarda (beginTest() no beforeEach): ${testName}`];
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
