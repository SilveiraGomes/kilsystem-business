import { describe, expect, it } from 'vitest';

// [C2-P01] tem de falhar no `afterAll` (`finishFile`, RV-C1M-01): um teste fora de
// `RUNTIME_SKIP_ALLOWED` não pode ser ignorado em execução.
describe('[GF-SKIP]', () => {
  it('passes', () => {
    expect(true).toBe(true);
  });

  it('[GF-SKIP] is skipped at runtime without authorisation', (context) => {
    context.skip('ignorado sem autorização');
  });
});
