import { createInMemoryTenantRepositories } from './support/in-memory-tenant-repositories';
import { createSqliteHarness } from './support/sqlite-harness';
import { describeTenantRepositoryContract } from './support/tenant-repository-contract';

// A mesma suite valida o duplo em memória (referência) e a implementação SQLite real (D-021).
describeTenantRepositoryContract('in-memory test double', createInMemoryTenantRepositories);
describeTenantRepositoryContract('SQLite on a temporary file', createSqliteHarness);
