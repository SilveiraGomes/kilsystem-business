import { setTimeout as delay } from 'node:timers/promises';

import { describe, it } from 'vitest';

import { expectFailureReasons } from '../support/expected-failure';

// [C2-P01] tem de falhar no `afterAll`: um teste negativo interrompido por *timeout* (limite próprio
// deste ficheiro de ensaio, 200 ms) falhou por outra razão.
describe('[GF-INTERRUPTED]', () => {
  it.fails(
    'is interrupted by its timeout instead of failing for the declared reason',
    async () => {
      expectFailureReasons([/^Error: razão declarada$/]);
      await delay(2_000);
      throw new Error('razão declarada');
    },
    200,
  );
});
