import { createInMemoryTenantRepositories } from './support/in-memory-tenant-repositories';
import { describeTenantRepositoryContract } from './support/tenant-repository-contract';

// A implementação em memória é apenas um duplo de teste; a SQLite (E1.04) reutilizará esta suite.
describeTenantRepositoryContract('in-memory test double', createInMemoryTenantRepositories);
