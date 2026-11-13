import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createSqliteTenantPersistence,
  openSqliteDatabase,
  runMigrations,
  type SqliteDatabase,
} from '../../packages/database/src/index';
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
