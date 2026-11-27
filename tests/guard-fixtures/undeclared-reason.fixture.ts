import { describe, it } from 'vitest';

// [C2-P01] tem de falhar no `afterAll` (RV-C1M-02): um `it.fails` sem razão declarada não aceita qualquer erro.
describe('[GF-UNDECLARED]', () => {
  it.fails('fails without declaring the reason', () => {
    throw new Error('qualquer erro');
  });
});
