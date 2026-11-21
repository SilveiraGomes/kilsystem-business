import { describeAuthorizationRepositoryContract } from './support/authorization-repository-contract';
import { createLocalServiceAuthorizationHarness } from './support/local-service-harness';
import { createSqliteAuthorizationHarness } from './support/sqlite-harness';

// A mesma suite valida a persistência RBAC sobre SQLite real e através do serviço local em `READY`
// (E1.07-D2, D-183; extensão de D-021 e D-089). Nenhum mock substitui a base.
describeAuthorizationRepositoryContract('SQLite on a temporary file', createSqliteAuthorizationHarness);
describeAuthorizationRepositoryContract('SQLite through the local service', createLocalServiceAuthorizationHarness);
