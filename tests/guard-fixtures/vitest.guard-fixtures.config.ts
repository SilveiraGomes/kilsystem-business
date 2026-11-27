import { defineConfig } from 'vitest/config';

import base from '../../vitest.config';

/*
 * E1.07-PD87-C2 (RV-C1M-05) — configuração dos ficheiros de ensaio da guarda, executados só em
 * processo filho por `tests/test-guards-process.test.ts` ([C2-P01]). Herda a configuração principal
 * (raiz, resolução e `tests/setup.ts`) e muda apenas o `include`: os `*.fixture.ts` nunca entram na
 * suite principal (`tests/**\/*.test.{ts,tsx}`), e vários falham de propósito.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/guard-fixtures/**/*.fixture.ts'],
  },
});
