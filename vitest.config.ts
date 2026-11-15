import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Raiz fixa no monorepositório: `--config` a partir de um pacote (ex.: apps/desktop) encontra `tests/`.
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Pacotes do workspace resolvidos a partir de `src/` (condição `source`), sem depender de `dist/`.
  // `resolve.conditions` aplica-se ao ambiente `client` do Vite (jsdom); o ambiente `node` do Vitest
  // usa o ambiente `ssr`, que desde o Vite 6/Vitest 4 não herda essa opção (D-078).
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source', 'import', 'default'] } },
  test: {
    coverage: { enabled: false },
    include: ['tests/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
    setupFiles: ['tests/setup.ts'],
  },
});
