import '@testing-library/jest-dom/vitest';
import path from 'node:path';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, expect } from 'vitest';

import { CLASSIFIED_DERIVATION_FILES, DIRECT_DETERMINISTIC_ALLOWED } from './support/argon2-test-classification';
import { pendingTestDirectories } from './support/temporary-directories';
import { fileDerivationGuard } from './support/test-derivation';

afterEach(() => {
  cleanup();
});

// PD-87 (RV-02): registados antes dos hooks de cada ficheiro, o `beforeEach` corre antes e o
// `afterEach` depois deles (ordem `stack`). Cada teste de um ficheiro com *tracker* de derivação tem
// de ser reposto e verificado pelos hooks desse ficheiro; derivações determinísticas fora de um
// *tracker* só são aceites nos testes de `DIRECT_DETERMINISTIC_ALLOWED`.
beforeEach(() => {
  fileDerivationGuard.beginTest();
});

afterEach(() => {
  const { currentTestName, testPath } = expect.getState();
  const expectedTrackers = CLASSIFIED_DERIVATION_FILES.includes(path.basename(testPath ?? '')) ? 1 : 0;
  const problems = fileDerivationGuard.endTest(currentTestName ?? '', { directAllowed: DIRECT_DETERMINISTIC_ALLOWED, expectedTrackers });
  expect(problems.join('\n'), 'ligação do tracker de derivação (PD-87)').toBe('');
});

// PD65-T1: registado antes dos hooks de cada ficheiro, corre depois deles (ordem `stack`). Cada
// ficheiro de testes tem de terminar sem pastas temporárias próprias por remover.
afterAll(() => {
  expect(pendingTestDirectories(), 'pastas temporárias de ensaio não removidas').toEqual([]);
});
