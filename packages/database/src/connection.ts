import Database from 'better-sqlite3';

import { PersistenceError } from './errors.js';

export type SqliteDatabase = Database.Database;

export interface OpenSqliteOptions {
  /** Caminho validado por `resolveDatabaseLocation`, ou `:memory:`. */
  readonly filename: string;
  readonly busyTimeoutMs?: number;
}

/**
 * Abre uma ligação SQLite com integridade referencial obrigatória. Destina-se à camada de
 * serviços locais (D-028); não deve ser usada no renderer nem no processo principal Electron.
 */
export const openSqliteDatabase = ({ filename, busyTimeoutMs = 5000 }: OpenSqliteOptions): SqliteDatabase => {
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError('busyTimeoutMs deve ser um inteiro não negativo.');
  }
  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    database.pragma(`busy_timeout = ${busyTimeoutMs}`);
    if (filename !== ':memory:') database.pragma('journal_mode = WAL');
    if (database.pragma('foreign_keys', { simple: true }) !== 1) {
      throw new PersistenceError('foreign-keys-disabled');
    }
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
};
