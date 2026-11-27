import { rmSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createTestDirectory } from '../support/temporary-directories';

// [C2-P01] tem de falhar no `afterAll` (PD65-T1): a pasta é removida do disco por fora do registo,
// por isso continua pendente para a guarda, sem deixar nada no disco.
describe('[GF-PENDING]', () => {
  it('leaves a registered directory pending', () => {
    const directory = createTestDirectory('infra');
    rmSync(directory, { force: true, recursive: true });
    expect(directory).toMatch(/kil-business-infra-/);
  });
});
