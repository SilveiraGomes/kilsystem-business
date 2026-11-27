import { onTestFinished } from 'vitest';

/*
 * E1.07-PD87 (RV-05) — limpeza depois de um corpo de teste sem esconder nenhuma falha. A falha do
 * corpo (por exemplo, uma asserção) é sempre a falha principal e é relançada tal como foi lançada;
 * uma falha de limpeza que ocorra depois dela é comunicada à parte, como falha secundária do mesmo
 * teste, e nunca a substitui. Sem falha do corpo, uma falha de limpeza é a falha do teste. Todas as
 * limpezas correm, pela ordem dada, mesmo que uma anterior falhe.
 */

export class SecondaryCleanupError extends Error {
  constructor(readonly original: unknown) {
    super(
      `Falha secundária de limpeza, depois da falha principal do teste (comunicada antes desta): ${
        original instanceof Error ? `${original.name}: ${original.message}` : String(original)
      }`,
      { cause: original },
    );
    this.name = 'SecondaryCleanupError';
  }
}

/** Por omissão, a falha secundária é acrescentada ao teste em curso quando este termina. */
export const reportSecondaryFailure = (error: unknown): void => {
  onTestFinished(() => {
    throw new SecondaryCleanupError(error);
  });
};

export type Cleanup = () => unknown;

export const runThenCleanUp = async <T>(
  body: () => Promise<T>,
  cleanups: readonly Cleanup[],
  reportSecondary: (error: unknown) => void = reportSecondaryFailure,
): Promise<T> => {
  let outcome: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
  try {
    outcome = { ok: true, value: await body() };
  } catch (error) {
    outcome = { error, ok: false };
  }
  const failures: unknown[] = [];
  for (const cleanup of cleanups) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  }
  if (!outcome.ok) {
    for (const failure of failures) reportSecondary(failure);
    throw outcome.error;
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Várias falhas de limpeza (PD-87).');
  return outcome.value;
};
