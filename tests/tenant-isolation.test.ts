import { createInMemoryTenantRepositories } from './support/in-memory-tenant-repositories';
import { createLocalServiceHarness } from './support/local-service-harness';
import { createSqliteHarness } from './support/sqlite-harness';
import { describeTenantRepositoryContract } from './support/tenant-repository-contract';

// A mesma suite valida o duplo em memória (referência), a implementação SQLite real e o acesso
// através do serviço local em `READY` (D-021).
describeTenantRepositoryContract('in-memory test double', createInMemoryTenantRepositories);
describeTenantRepositoryContract('SQLite on a temporary file', createSqliteHarness);
describeTenantRepositoryContract('SQLite through the local service', createLocalServiceHarness);
