import { createLocalServiceIdentityHarness } from './support/local-service-harness';
import { describeIdentityRepositoryContract } from './support/membership-repository-contract';
import { createSqliteIdentityHarness } from './support/sqlite-harness';

// A mesma suite valida a implementação SQLite real e o acesso através do serviço local em
// `READY` (D-089, extensão de D-021 às identidades e associações).
describeIdentityRepositoryContract('SQLite on a temporary file', createSqliteIdentityHarness);
describeIdentityRepositoryContract('SQLite through the local service', createLocalServiceIdentityHarness);
