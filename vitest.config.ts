import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Raiz fixa no monorepositório: `--config` a partir de um pacote (ex.: apps/desktop) encontra `tests/`.
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Pacotes do workspace resolvidos a partir de `src/` (condição `source`), sem depender de `dist/`.
  resolve: { conditions: ['source'] },
  test: {
    coverage: { enabled: false },
    include: ['tests/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
    setupFiles: ['tests/setup.ts'],
  },
});
