import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { openSqliteDatabase, type OpenSqliteOptions, type SqliteDatabase } from '../../packages/database/src/index';
import { parseLocalServiceConfig, type LocalServiceConfig } from '../../services/local-api/src/config';
import {
  createLocalService,
  type LocalService,
  type LocalServiceDependencies,
} from '../../services/local-api/src/local-service';
import { createJsonLogger } from '../../services/local-api/src/logger';
import type { AuthorizationRepositoryHarness } from './authorization-repository-contract';
import type { IdentityRepositoryHarness } from './membership-repository-contract';
import { stopServicesThenDisposeNow } from './service-cleanup';
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

/** Dependências substituíveis em testes (relógios, derivação, lista de palavras-passe, sessões). */
export type ServiceTestDependencies = Partial<
  Pick<
    LocalServiceDependencies,
    'clock' | 'commonPasswords' | 'databaseLockTimeoutMs' | 'monotonicClock' | 'passwordHashing' | 'sessionPolicy'
  >
>;

// Ligações abertas pelos serviços em teste, para que a inspecção use a ligação proprietária.
const serviceConnections = new Set<SqliteDatabase>();

const sameFile = (left: string, right: string): boolean => {
  try {
    return realpathSync.native(left).toLowerCase() === realpathSync.native(right).toLowerCase();
  } catch {
    return false;
  }
};

/** Ligação aberta de um serviço em teste que detém `filename`, se existir. */
export const liveServiceConnection = (filename: string): SqliteDatabase | undefined => {
  for (const connection of serviceConnections) if (!connection.open) serviceConnections.delete(connection);
  return [...serviceConnections].find((connection) => sameFile(connection.name, filename));
};

/**
 * Inspecção directa de uma base de teste (E1.07-X). Um serviço em `READY` detém a base em
 * exclusivo e recusa qualquer segunda ligação; nesse caso, `work` corre na ligação do próprio
 * serviço, e no fim os pragmas por ligação (`foreign_keys`, `recursive_triggers`) são repostos e
 * uma transacção deixada aberta é anulada, como faria o fecho de uma ligação própria. Sem serviço
 * a deter a base, usa uma ligação própria e fecha-a.
 */
export const inspectDatabase = <T>(
  filename: string,
  openOwn: () => SqliteDatabase,
  work: (database: SqliteDatabase) => T,
): T => {
  const live = liveServiceConnection(filename);
  if (live === undefined) {
    const own = openOwn();
    try {
      return work(own);
    } finally {
      own.close();
    }
  }
  const foreignKeys = live.pragma('foreign_keys', { simple: true }) === 1;
  const recursiveTriggers = live.pragma('recursive_triggers', { simple: true }) === 1;
  try {
    return work(live);
  } finally {
    if (live.inTransaction) live.exec('ROLLBACK');
    live.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    live.pragma(`recursive_triggers = ${recursiveTriggers ? 'ON' : 'OFF'}`);
  }
};

export const createServiceUnderTest = (
  config: LocalServiceConfig,
  open: (options: OpenSqliteOptions) => SqliteDatabase | Promise<SqliteDatabase> = openSqliteDatabase,
  dependencies: ServiceTestDependencies = {},
): ServiceUnderTest => {
  const lines: string[] = [];
  const connections: SqliteDatabase[] = [];
  const logger = createJsonLogger({
    instanceId: config.instanceId,
    level: config.logLevel,
    sink: (line) => lines.push(line),
  });
  const service = createLocalService(config, {
    ...dependencies,
    logger,
    openDatabase: async (options) => {
      const connection = await open(options);
      connections.push(connection);
      serviceConnections.add(connection);
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
  const harness = createServiceUnderTest(serviceConfig(temporary.filename));
  const { service } = harness;
  await service.start();
  return {
    branches: service.branches,
    companies: service.companies,
    // PD87-C2 (PD-57): a base só é apagada depois de parar o serviço e confirmar as ligações fechadas.
    dispose: () => stopServicesThenDisposeNow([harness], temporary),
  };
};

/** Identidades e associações através do serviço local em `READY` (E1.07-A, D-089). */
export const createLocalServiceIdentityHarness = async (): Promise<IdentityRepositoryHarness> => {
  const temporary = createTemporaryDatabase();
  const harness = createServiceUnderTest(serviceConfig(temporary.filename));
  const { service } = harness;
  await service.start();
  return {
    branches: service.branches,
    branchMemberships: service.branchMemberships,
    companies: service.companies,
    companyMemberships: service.companyMemberships,
    // PD87-C2 (PD-57): a base só é apagada depois de parar o serviço e confirmar as ligações fechadas.
    dispose: () => stopServicesThenDisposeNow([harness], temporary),
    scopes: service.membershipScopes,
    users: service.identityProvisioning.users,
  };
};

/** Persistência RBAC e motor interno através do serviço local em `READY` (E1.07-D2). */
export const createLocalServiceAuthorizationHarness = async (): Promise<AuthorizationRepositoryHarness> => {
  const temporary = createTemporaryDatabase();
  const harness = createServiceUnderTest(serviceConfig(temporary.filename));
  const { service } = harness;
  await service.start();
  const rbac = service.internalAuthorization;
  return {
    branches: service.branches,
    branchMemberships: service.branchMemberships,
    companies: service.companies,
    companyMemberships: service.companyMemberships,
    diagnostics: rbac.diagnostics,
    // PD87-C2 (PD-57): a base só é apagada depois de parar o serviço e confirmar as ligações fechadas.
    dispose: () => stopServicesThenDisposeNow([harness], temporary),
    evaluator: rbac.domainEvaluator,
    roleAssignments: rbac.roleAssignments,
    rolePermissions: rbac.rolePermissions,
    roles: rbac.roles,
    scopes: service.membershipScopes,
    sql: (work) => inspectDatabase(temporary.filename, temporary.open, work),
    users: service.identityProvisioning.users,
  };
};
