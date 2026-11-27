import { describe, it } from 'vitest';

import { runThenCleanUp } from '../support/cleanup-after';
import { expectFailureReasons } from '../support/expected-failure';

// [C2-P01] tem de falhar no `afterAll`: além da razão declarada, o teste negativo teve uma falha
// secundária de limpeza (erro a mais).
describe('[GF-SECONDARY]', () => {
  it.fails('fails for the declared reason and also with a secondary cleanup failure', async () => {
    expectFailureReasons([/^Error: razão declarada$/]);
    await runThenCleanUp(
      () => Promise.reject(new Error('razão declarada')),
      [
        () => {
          throw new Error('falha secundária de limpeza');
        },
      ],
    );
  });
});
