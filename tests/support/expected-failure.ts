import { expect, onTestFailed } from 'vitest';

/*
 * E1.07-PD87-C1 (RV-PD87M-02) — razão exacta dos testes negativos (`it.fails`). No Vitest 5.1.0 a
 * inversão de `fails` é feita depois dos `afterEach`, dos `onTestFinished` e dos `onTestFailed` do
 * teste, e apaga os erros sem ver o motivo: qualquer falha passava por sucesso. Aqui, o teste declara
 * no início as razões por que tem de falhar; um `onTestFailed` (o último a correr antes da inversão)
 * guarda todos os erros do teste, e o `afterAll` de `tests/setup.ts` (que corre depois da inversão)
 * falha o ficheiro se o teste não falhou exactamente, e só, por essas razões. A inversão do Vitest
 * continua a provar que a falha acontece no mecanismo real; nada no Vitest é alterado.
 */

interface FailureExpectation {
  readonly test: string;
  readonly reasons: readonly RegExp[];
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
    test: expect.getState().currentTestName ?? '',
  };
  expectations.push(expectation);
  onTestFailed(({ task }) => {
    expectation.invertedByVitest = task.fails === true;
    expectation.observed = (task.result?.errors ?? []).map(describeError);
  });
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

/** Para o `afterAll`: razões esperadas que não se verificaram neste ficheiro (vazio quando todas se verificaram). */
export const unmetFailureReasons = (): readonly string[] =>
  expectations
    .splice(0)
    .flatMap(({ invertedByVitest, observed, reasons, test }) => failureReasonProblems(test, observed, reasons, invertedByVitest));
