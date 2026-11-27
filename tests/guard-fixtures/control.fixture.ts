import { describe, expect, it } from 'vitest';

import { expectFailureReasons } from '../support/expected-failure';

// [C2-P01] controlo: tem de passar. Um teste normal, um negativo com a razão declarada, e testes
// ignorados antes de correr (`skip`, `todo`), que a guarda não conta como executados.
describe('[GF-CONTROL]', () => {
  it('passes', () => {
    expect(1 + 1).toBe(2);
  });

  it.fails('fails for the declared reason', () => {
    expectFailureReasons([/^Error: razão declarada$/]);
    throw new Error('razão declarada');
  });

  it.skip('is skipped before running', () => {
    throw new Error('não pode correr');
  });

  it.todo('is a todo');
});
