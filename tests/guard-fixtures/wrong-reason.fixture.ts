import { describe, it } from 'vitest';

import { expectFailureReasons } from '../support/expected-failure';

// [C2-P01] tem de falhar no `afterAll` (`unmetFailureReasons`): o teste negativo falha por outra razão.
describe('[GF-WRONG-REASON]', () => {
  it.fails('fails for a reason other than the declared one', () => {
    expectFailureReasons([/^Error: razão declarada$/]);
    throw new Error('outra razão');
  });
});
