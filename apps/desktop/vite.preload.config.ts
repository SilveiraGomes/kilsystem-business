import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('src/main/preload.cts', import.meta.url)),
      fileName: () => 'preload.cjs',
      formats: ['cjs'],
    },
    minify: false,
    outDir: 'dist-electron',
    rollupOptions: {
      external: ['electron'],
    },
  },
});
