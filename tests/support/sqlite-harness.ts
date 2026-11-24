import path from 'node:path';

import {
  createSqliteAuthorizationPersistence,
  createSqliteMembershipPersistence,
  createSqliteTenantPersistence,
  createSqliteUserDirectory,
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from '../../packages/database/src/index';
import { createInternalDomainAuthorizationEvaluator } from '../../services/local-api/src/authorization/domain-authorization-engine';
import type { AuthorizationRepositoryHarness } from './authorization-repository-contract';
import type { IdentityRepositoryHarness } from './membership-repository-contract';
import { createTestDirectory, removeTestDirectory } from './temporary-directories';
import type { TenantRepositoryHarness } from './tenant-repository-contract';

/** Base SQLite temporária em disco, fora do repositório, apagada em `dispose`. */
export interface TemporaryDatabase {
  readonly directory: string;
  readonly filename: string;
  readonly open: () => SqliteDatabase;
  readonly dispose: () => void;
}

/** `prefix`: `infra` nos testes da própria infra-estrutura, para os seus registos de limpeza serem reconhecidos como sintéticos. */
export const createTemporaryDatabase = (prefix = 'test'): TemporaryDatabase => {
  const directory = createTestDirectory(prefix);
  const filename = path.join(directory, 'tenant-test.sqlite');
  const connections: SqliteDatabase[] = [];
  let disposed = false;

  return {
    directory,
    filename,
    open: () => {
      const connection = openSqliteDatabase({ filename });
      connections.push(connection);
      return connection;
    },
    // Idempotente: um teste que falhe a meio pode deixar o `afterEach` a eliminar a mesma base outra vez.
    dispose: () => {
      for (const connection of connections) if (connection.open) connection.close();
      if (disposed) return;
      removeTestDirectory(directory);
      disposed = true;
    },
  };
};

export const createSqliteHarness = (): TenantRepositoryHarness => {
  const temporary = createTemporaryDatabase();
  const connection = temporary.open();
  runMigrations(connection);
  const { branches, companies } = createSqliteTenantPersistence(connection);
  return { branches, companies, dispose: temporary.dispose };
};

/** Identidades e associações sobre SQLite real em ficheiro temporário (E1.07-A). */
export const createSqliteIdentityHarness = (): IdentityRepositoryHarness => {
  const temporary = createTemporaryDatabase();
  const connection = temporary.open();
  runMigrations(connection);
  const { branches, companies } = createSqliteTenantPersistence(connection);
  const { branchMemberships, companyMemberships, scopes } = createSqliteMembershipPersistence(connection);
  return {
    branches,
    branchMemberships,
    companies,
    companyMemberships,
    dispose: temporary.dispose,
    scopes,
    users: createSqliteUserDirectory(connection),
  };
};

/** Persistência RBAC e motor interno sobre SQLite real em ficheiro temporário (E1.07-D2). */
export const createSqliteAuthorizationHarness = (): AuthorizationRepositoryHarness => {
  const temporary = createTemporaryDatabase();
  const connection = temporary.open();
  runMigrations(connection);
  const { branches, companies } = createSqliteTenantPersistence(connection);
  const { branchMemberships, companyMemberships, scopes } = createSqliteMembershipPersistence(connection);
  const authorization = createSqliteAuthorizationPersistence(connection);
  return {
    branches,
    branchMemberships,
    companies,
    companyMemberships,
    diagnostics: authorization.diagnostics,
    dispose: temporary.dispose,
    evaluator: createInternalDomainAuthorizationEvaluator(authorization.readCompanyAuthorizationFacts),
    roleAssignments: authorization.roleAssignments,
    rolePermissions: authorization.rolePermissions,
    roles: authorization.roles,
    scopes,
    sql: (work) => work(connection),
    users: createSqliteUserDirectory(connection),
  };
};
