import '@testing-library/jest-dom/vitest';
import path from 'node:path';

import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, expect } from 'vitest';

import { CLASSIFIED_DERIVATION_FILES, DIRECT_DETERMINISTIC_ALLOWED } from './support/argon2-test-classification';
import { unmetFailureReasons } from './support/expected-failure';
import { pendingTestDirectories } from './support/temporary-directories';
import { executedTests, fileDerivationGuard } from './support/test-derivation';

afterEach(() => {
  cleanup();
});

// PD-87 (RV-02): registados antes dos hooks de cada ficheiro, o `beforeEach` corre antes e o
// `afterEach` depois deles (ordem `stack`). Cada teste de um ficheiro com *tracker* de derivação tem
// de ser reposto e verificado pelos hooks desse ficheiro; derivações determinísticas fora de um
// *tracker* só são aceites nos testes de `DIRECT_DETERMINISTIC_ALLOWED`. PD87-C1 (RV-PD87M-01): se
// algum destes hooks não correr, a própria guarda faz falhar o teste ou o ficheiro (`finishFile`).
beforeEach(() => {
  fileDerivationGuard.beginTest(expect.getState().currentTestName ?? '');
});

afterEach(() => {
  const { currentTestName, testPath } = expect.getState();
  const expectedTrackers = CLASSIFIED_DERIVATION_FILES.includes(path.basename(testPath ?? '')) ? 1 : 0;
  const problems = fileDerivationGuard.endTest(currentTestName ?? '', { directAllowed: DIRECT_DETERMINISTIC_ALLOWED, expectedTrackers });
  if (problems.length > 0) throw new Error(`ligação do tracker de derivação (PD-87):\n${problems.join('\n')}`);
});

// PD65-T1: registado antes dos hooks de cada ficheiro, corre depois deles (ordem `stack`). Cada
// ficheiro de testes tem de terminar sem pastas temporárias próprias por remover. PD87-C1: corre
// depois da inversão dos `it.fails`, por isso verifica aqui a razão exacta dos testes negativos.
// eslint-disable-next-line no-empty-pattern -- o Vitest 5.1.0 exige desestruturação no 1.º argumento (fixtures, não usadas); o ficheiro é o 2.º.
afterAll(({}, file) => {
  // Todas as verificações são feitas e comunicadas juntas; uma não esconde a outra.
  const pending = pendingTestDirectories();
  const problems = [
    ...(pending.length > 0 ? [`pastas temporárias de ensaio não removidas: ${pending.join(', ')}`] : []),
    ...fileDerivationGuard.finishFile(executedTests(file)),
    ...unmetFailureReasons(),
  ];
  if (problems.length > 0) throw new Error(`fim do ficheiro de testes (PD65-T1, PD-87):\n${problems.join('\n')}`);
});
