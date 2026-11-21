import { describe, expect, it } from 'vitest';

import { describeAuthorizationRepositoryContract } from './support/authorization-repository-contract';
import { companyTarget } from './support/authorization-fixtures';
import { newCompany } from './support/fixtures';
import { newUser } from './support/identity-fixtures';
import { createLocalServiceAuthorizationHarness } from './support/local-service-harness';
import { createSqliteAuthorizationHarness } from './support/sqlite-harness';

// A mesma suite valida a persistência RBAC sobre SQLite real e através do serviço local em `READY`
// (E1.07-D2, D-183; extensão de D-021 e D-089). Nenhum mock substitui a base.
describeAuthorizationRepositoryContract('SQLite on a temporary file', createSqliteAuthorizationHarness);
describeAuthorizationRepositoryContract('SQLite through the local service', createLocalServiceAuthorizationHarness);

describe('local-service authorization lifecycle', () => {
  it('[O1] refuses persisted-fact evaluation after the service leaves READY', async () => {
    const harness = await createLocalServiceAuthorizationHarness();
    const evaluator = harness.evaluator;
    const company = newCompany();
    const user = newUser();
    await harness.dispose?.();

    await expect(
      evaluator.evaluate({ permissionCode: 'company.read', scope: companyTarget(company), userId: user.id }),
    ).rejects.toMatchObject({ reason: 'not-ready', state: 'STOPPED' });
  });
});
