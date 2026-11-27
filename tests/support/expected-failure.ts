import { expect, onTestFinished, type RunnerTestFile, type RunnerTestSuite } from 'vitest';

import { failingTestsRun } from './test-derivation';

/*
 * E1.07-PD87-C1 (RV-PD87M-02) — razão exacta dos testes negativos (`it.fails`). No Vitest 5.1.0 a
 * inversão de `fails` é feita depois dos `afterEach`, dos `onTestFinished` e dos `onTestFailed` do
 * teste, e apaga os erros sem ver o motivo: qualquer falha passava por sucesso. Aqui, o teste declara
 * no início as razões por que tem de falhar; um `onTestFailed` (o último a correr antes da inversão)
 * guarda todos os erros do teste, e o `afterAll` de `tests/setup.ts` (que corre depois da inversão)
 * falha o ficheiro se o teste não falhou exactamente, e só, por essas razões. A inversão do Vitest
 * continua a provar que a falha acontece no mecanismo real; nada no Vitest é alterado.
 *
 * E1.07-PD87-C2 (RV-C1M-02) — a declaração deixa de ser opcional: o `afterAll` percorre os testes
 * `it.fails` que correram no ficheiro e falha-o por cada um sem razão declarada. Retirar a chamada a
 * `expectFailureReasons` já não faz um teste negativo aceitar qualquer erro. Com a guarda num
 * `aroundEach` (RV-C1M-04), o erro da guarda surge depois dos `onTestFailed`; por isso os erros são
 * observados na desmontagem do `aroundEach` de `tests/setup.ts` (`observeFailures`), o último passo
 * antes da inversão, com o erro da guarda incluído.
 */

interface FailureExpectation {
  readonly test: string;
  readonly reasons: readonly RegExp[];
  /** Identificador do teste no Vitest, conhecido quando o teste termina (`onTestFinished`). */
  taskId: string | undefined;
  observed: readonly string[] | undefined;
  invertedByVitest: boolean | undefined;
}

const expectations: FailureExpectation[] = [];

/** Cada erro como `Nome: mensagem`, tal como o Vitest o regista no resultado do teste. */
const describeError = (error: { readonly name?: unknown; readonly message?: unknown }): string =>
  `${typeof error.name === 'string' ? error.name : 'Error'}: ${typeof error.message === 'string' ? error.message : String(error.message)}`;

/**
 * Para chamar no início de um `it.fails`: o teste tem de falhar com exactamente estes erros, pela
 * ordem em que o Vitest os regista (um padrão por erro).
 */
export const expectFailureReasons = (reasons: readonly RegExp[]): void => {
  const expectation: FailureExpectation = {
    invertedByVitest: undefined,
    observed: undefined,
    reasons,
    taskId: undefined,
    test: expect.getState().currentTestName ?? '',
  };
  expectations.push(expectation);
  // Corre sempre, mesmo que o teste não falhe: liga a declaração ao teste.
  onTestFinished(({ task }) => {
    expectation.taskId = task.id;
  });
};

/** O que `observeFailures` lê de um teste do Vitest. */
export interface ObservedTest {
  readonly id: string;
  readonly fails?: boolean | undefined;
  readonly result?: { readonly errors?: readonly { readonly name?: unknown; readonly message?: unknown }[] | undefined } | undefined;
}

/**
 * Para a desmontagem do `aroundEach` de `tests/setup.ts`, antes da inversão de `it.fails`: regista
 * todos os erros do teste (os do Vitest e os que a desmontagem ainda vai lançar, em `late`) nas
 * declarações desse teste. Sem nenhum erro, a falha fica por observar.
 */
export const observeFailures = (task: ObservedTest, late: readonly Error[]): void => {
  const errors = [...(task.result?.errors ?? []), ...late];
  for (const expectation of expectations) {
    if (expectation.taskId !== task.id) continue;
    expectation.invertedByVitest = task.fails === true;
    expectation.observed = errors.length > 0 ? errors.map(describeError) : undefined;
  }
};

/**
 * Comparação de uma falha observada com as razões esperadas: um erro por padrão, pela ordem, sem
 * erros a mais nem a menos; o teste tem de ser um `it.fails` invertido pelo Vitest.
 */
export const failureReasonProblems = (
  test: string,
  observed: readonly string[] | undefined,
  reasons: readonly RegExp[],
  invertedByVitest: boolean | undefined,
): readonly string[] => {
  if (observed === undefined) return [`teste negativo sem falha observada: ${test}`];
  const problems: string[] = [];
  if (invertedByVitest !== true) problems.push(`razão esperada declarada num teste sem it.fails: ${test}`);
  const matches = observed.length === reasons.length && reasons.every((reason, index) => reason.test(observed[index] ?? ''));
  if (!matches) {
    problems.push(`teste negativo falhou por outra razão: ${test}\n  esperado: ${reasons.map(String).join(' | ')}\n  observado: ${observed.join(' | ')}`);
  }
  return problems;
};

/** Testes `it.fails` que correram sem nenhuma razão declarada (PD87-C2, RV-C1M-02). */
export const undeclaredFailureReasons = (
  failing: readonly { readonly id: string; readonly fullTestName: string }[],
  declaredTaskIds: ReadonlySet<string | undefined>,
): readonly string[] =>
  failing
    .filter((test) => !declaredTaskIds.has(test.id))
    .map((test) => `teste negativo (it.fails) sem razão esperada declarada (expectFailureReasons): ${test.fullTestName}`);

/**
 * Para o `afterAll`: razões esperadas que não se verificaram neste ficheiro e testes `it.fails` sem
 * razão declarada (vazio quando tudo se verificou).
 */
export const unmetFailureReasons = (file: Readonly<RunnerTestSuite | RunnerTestFile>): readonly string[] => {
  const declared = expectations.splice(0);
  return [
    ...declared.flatMap(({ invertedByVitest, observed, reasons, test }) => failureReasonProblems(test, observed, reasons, invertedByVitest)),
    ...undeclaredFailureReasons(failingTestsRun(file), new Set(declared.map(({ taskId }) => taskId))),
  ];
};
