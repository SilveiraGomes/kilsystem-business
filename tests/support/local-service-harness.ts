import { fileURLToPath } from 'node:url';

import { openSqliteDatabase, type OpenSqliteOptions, type SqliteDatabase } from '../../packages/database/src/index';
import { parseLocalServiceConfig, type LocalServiceConfig } from '../../services/local-api/src/config';
import { createLocalService, type LocalService } from '../../services/local-api/src/local-service';
import { createJsonLogger } from '../../services/local-api/src/logger';
import type { IdentityRepositoryHarness } from './membership-repository-contract';
import { createTemporaryDatabase } from './sqlite-harness';
import type { TenantRepositoryHarness } from './tenant-repository-contract';

export const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const PROTECTED_DIRECTORIES: readonly string[] = [REPOSITORY_ROOT];

export const serviceConfig = (
  databasePath: string,
  overrides: Readonly<Record<string, unknown>> = {},
): LocalServiceConfig =>
  parseLocalServiceConfig(
    {
      databasePath,
      environment: 'test',
      instanceId: 'test-instance',
      logLevel: 'debug',
      startupPolicy: { onMissingDatabase: 'create', onPendingMigrations: 'apply' },
      ...overrides,
    },
    { protectedDirectories: PROTECTED_DIRECTORIES },
  );

export interface ServiceUnderTest {
  readonly service: LocalService;
  /** Linhas JSON exactamente como seriam escritas. */
  readonly lines: string[];
  readonly records: () => readonly Record<string, unknown>[];
  /** Todas as ligações abertas pelo serviço, para verificar que ficam fechadas. */
  readonly connections: SqliteDatabase[];
}

export const createServiceUnderTest = (
  config: LocalServiceConfig,
  open: (options: OpenSqliteOptions) => SqliteDatabase | Promise<SqliteDatabase> = openSqliteDatabase,
): ServiceUnderTest => {
  const lines: string[] = [];
  const connections: SqliteDatabase[] = [];
  const logger = createJsonLogger({
    instanceId: config.instanceId,
    level: config.logLevel,
    sink: (line) => lines.push(line),
  });
  const service = createLocalService(config, {
    logger,
    openDatabase: async (options) => {
      const connection = await open(options);
      connections.push(connection);
      return connection;
    },
    protectedDirectories: PROTECTED_DIRECTORIES,
  });
  return {
    connections,
    lines,
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    service,
  };
};

/** Suite de contrato através do serviço local em `READY`, sobre base temporária. */
export const createLocalServiceHarness = async (): Promise<TenantRepositoryHarness> => {
  const temporary = createTemporaryDatabase();
  const { service } = createServiceUnderTest(serviceConfig(temporary.filename));
  await service.start();
  return {
    branches: service.branches,
    companies: service.companies,
    dispose: async () => {
      await service.stop();
      temporary.dispose();
    },
  };
};

/** Identidades e associações através do serviço local em `READY` (E1.07-A, D-089). */
export const createLocalServiceIdentityHarness = async (): Promise<IdentityRepositoryHarness> => {
  const temporary = createTemporaryDatabase();
  const { service } = createServiceUnderTest(serviceConfig(temporary.filename));
  await service.start();
  return {
    branches: service.branches,
    branchMemberships: service.branchMemberships,
    companies: service.companies,
    companyMemberships: service.companyMemberships,
    dispose: async () => {
      await service.stop();
      temporary.dispose();
    },
    scopes: service.membershipScopes,
    users: service.identityProvisioning.users,
  };
};
