import { afterEach, describe, expect, it } from 'vitest';

// [C2-P01] RV-C1M-04: o `afterEach` do `describe` lança no primeiro teste. O primeiro teste falha só
// com esse erro; o segundo passa (a guarda, num `aroundEach`, termina o primeiro mesmo assim) e o
// ficheiro não tem falhas no `afterAll`.
describe('[GF-AFTEREACH]', () => {
  let first = true;

  afterEach(() => {
    if (!first) return;
    first = false;
    throw new Error('falha do afterEach do describe');
  });

  it('first', () => {
    expect(first).toBe(true);
  });

  it('second', () => {
    expect(first).toBe(false);
  });
});
