import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, expect } from 'vitest';

import { pendingTestDirectories } from './support/temporary-directories';

afterEach(() => {
  cleanup();
});

// PD65-T1: registado antes dos hooks de cada ficheiro, corre depois deles (ordem `stack`). Cada
// ficheiro de testes tem de terminar sem pastas temporárias próprias por remover.
afterAll(() => {
  expect(pendingTestDirectories(), 'pastas temporárias de ensaio não removidas').toEqual([]);
});
