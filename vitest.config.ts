import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Raiz fixa no monorepositório: `--config` a partir de um pacote (ex.: apps/desktop) encontra `tests/`.
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    coverage: { enabled: false },
    include: ['tests/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
    setupFiles: ['tests/setup.ts'],
  },
});
