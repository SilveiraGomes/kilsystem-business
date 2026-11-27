import '@testing-library/jest-dom/vitest';
import path from 'node:path';

import { cleanup } from '@testing-library/react';
import { afterAll, aroundEach } from 'vitest';

import { CLASSIFIED_DERIVATION_FILES, DIRECT_DETERMINISTIC_ALLOWED } from './support/argon2-test-classification';
import { observeFailures, unmetFailureReasons } from './support/expected-failure';
import { RUNTIME_SKIP_ALLOWED } from './support/runtime-skips';
import { pendingTestDirectories } from './support/temporary-directories';
import { fileDerivationGuard, fileExecution } from './support/test-derivation';

// PD-87 (RV-02): cada teste de um ficheiro com *tracker* de derivação tem de ser reposto e verificado
// pelos hooks desse ficheiro; derivações determinísticas fora de um *tracker* só são aceites nos
// testes de `DIRECT_DETERMINISTIC_ALLOWED`. PD87-C1 (RV-PD87M-01): se a guarda não começar ou não
// terminar um teste, ela própria faz falhar o teste ou o ficheiro (`finishFile`). PD87-C2 (RV-C1M-04):
// num `aroundEach`, a guarda começa antes de todos os `beforeEach` e termina depois de todos os
// `afterEach`, mesmo quando um `afterEach` de um `describe` lança e o Vitest salta os `afterEach`
// exteriores; o teste seguinte já não herda uma falha artificial. A limpeza do React vem para aqui
// pela mesma razão.
aroundEach(async (runTest, { task }) => {
  fileDerivationGuard.beginTest(task.fullTestName);
  try {
    await runTest();
  } finally {
    cleanup();
  }
  const expectedTrackers = CLASSIFIED_DERIVATION_FILES.includes(path.basename(task.file.filepath)) ? 1 : 0;
  const problems = fileDerivationGuard.endTest(task.fullTestName, { directAllowed: DIRECT_DETERMINISTIC_ALLOWED, expectedTrackers });
  const guardFailure = problems.length > 0 ? new Error(`ligação do tracker de derivação (PD-87):\n${problems.join('\n')}`) : undefined;
  // PD87-C2: último passo antes da inversão de `it.fails`; inclui a falha da guarda que vai ser lançada.
  observeFailures(task, guardFailure === undefined ? [] : [guardFailure]);
  if (guardFailure !== undefined) throw guardFailure;
});

// PD65-T1: registado antes dos hooks de cada ficheiro, corre depois deles (ordem `stack`). Cada
// ficheiro de testes tem de terminar sem pastas temporárias próprias por remover. PD87-C1: corre
// depois da inversão dos `it.fails`, por isso verifica aqui a razão exacta dos testes negativos.
// PD87-C2: cada `it.fails` que correu tem de ter declarado a razão (RV-C1M-02), e um teste ignorado
// em execução só é aceite se constar de `RUNTIME_SKIP_ALLOWED` (RV-C1M-01). A remoção destas
// verificações é detectada por comportamento em processo filho ([C2-P01]).
// eslint-disable-next-line no-empty-pattern -- o Vitest 5.1.0 exige desestruturação no 1.º argumento (fixtures, não usadas); o ficheiro é o 2.º.
afterAll(({}, file) => {
  // Todas as verificações são feitas e comunicadas juntas; uma não esconde a outra.
  const pending = pendingTestDirectories();
  const problems = [
    ...(pending.length > 0 ? [`pastas temporárias de ensaio não removidas: ${pending.join(', ')}`] : []),
    ...fileDerivationGuard.finishFile(fileExecution(file), RUNTIME_SKIP_ALLOWED),
    ...unmetFailureReasons(file),
  ];
  if (problems.length > 0) throw new Error(`fim do ficheiro de testes (PD65-T1, PD-87):\n${problems.join('\n')}`);
});
