import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: { enabled: false },
    include: ['tests/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
    setupFiles: ['tests/setup.ts'],
  },
});
