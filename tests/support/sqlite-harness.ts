import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createSqliteMembershipPersistence,
  createSqliteTenantPersistence,
  createSqliteUserDirectory,
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from '../../packages/database/src/index';
import type { IdentityRepositoryHarness } from './membership-repository-contract';
import type { TenantRepositoryHarness } from './tenant-repository-contract';

/** Base SQLite temporária em disco, fora do repositório, apagada em `dispose`. */
export interface TemporaryDatabase {
  readonly directory: string;
  readonly filename: string;
  readonly open: () => SqliteDatabase;
  readonly dispose: () => void;
}

export const createTemporaryDatabase = (): TemporaryDatabase => {
  const directory = mkdtempSync(path.join(tmpdir(), 'kil-business-test-'));
  const filename = path.join(directory, 'tenant-test.sqlite');
  const connections: SqliteDatabase[] = [];

  return {
    directory,
    filename,
    open: () => {
      const connection = openSqliteDatabase({ filename });
      connections.push(connection);
      return connection;
    },
    dispose: () => {
      for (const connection of connections) if (connection.open) connection.close();
      rmSync(directory, { force: true, recursive: true });
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
