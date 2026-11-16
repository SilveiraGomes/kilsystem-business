import Database from 'better-sqlite3';

import { PersistenceError } from './errors.js';

export type SqliteDatabase = Database.Database;

/**
 * Espera máxima configurada para obter o bloqueio exclusivo da base (E1.07-X). O SQLite repete a
 * tentativa durante este intervalo; um segundo serviço é recusado sem esperar indefinidamente.
 */
export const DEFAULT_DATABASE_LOCK_TIMEOUT_MS = 2000;
export const MAX_DATABASE_LOCK_TIMEOUT_MS = 30_000;

export interface OpenSqliteOptions {
  /** Caminho validado por `resolveDatabaseLocation`, ou `:memory:`. */
  readonly filename: string;
  readonly busyTimeoutMs?: number;
  /** Quando `true`, recusa abrir (e criar) um ficheiro inexistente. */
  readonly fileMustExist?: boolean;
  /**
   * Quando `true`, a ligação usa `locking_mode = EXCLUSIVE` antes do primeiro acesso ao ficheiro e
   * adquire o bloqueio exclusivo do sistema operativo durante a abertura (E1.07-X). Exige ficheiro.
   */
  readonly exclusive?: boolean;
}

/** Código estendido do SQLite (`SQLITE_BUSY`, `SQLITE_CANTOPEN_ISDIR`, ...), quando existir. */
export const sqliteErrorCode = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || !('code' in error)) return undefined;
  const { code } = error;
  return typeof code === 'string' && code.startsWith('SQLITE_') ? code : undefined;
};

/** `SQLITE_BUSY` e variantes: outra ligação mantém um bloqueio incompatível. */
export const isSqliteBusy = (error: unknown): boolean => {
  const code = sqliteErrorCode(error);
  return code === 'SQLITE_BUSY' || code?.startsWith('SQLITE_BUSY_') === true;
};

/**
 * Abre uma ligação SQLite com integridade referencial obrigatória. Destina-se à camada de
 * serviços locais (D-028); não deve ser usada no renderer nem no processo principal Electron.
 */
export const openSqliteDatabase = ({
  filename,
  busyTimeoutMs = 5000,
  fileMustExist = false,
  exclusive = false,
}: OpenSqliteOptions): SqliteDatabase => {
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError('busyTimeoutMs deve ser um inteiro não negativo.');
  }
  if (exclusive && filename === ':memory:') {
    throw new RangeError('A exclusividade exige uma base em ficheiro.');
  }
  const database = new Database(filename, { fileMustExist });
  try {
    database.pragma('foreign_keys = ON');
    database.pragma(`busy_timeout = ${busyTimeoutMs}`);
    // O modo exclusivo tem de ser definido antes do primeiro acesso ao ficheiro: em WAL, o SQLite
    // obtém então um bloqueio EXCLUSIVE do ficheiro principal, sem memória partilhada, e só o
    // liberta ao fechar a ligação (ou quando o sistema operativo termina o processo).
    if (exclusive && database.pragma('locking_mode = EXCLUSIVE', { simple: true }) !== 'exclusive') {
      throw new PersistenceError('exclusive-lock-unverified');
    }
    if (filename !== ':memory:') database.pragma('journal_mode = WAL');
    if (database.pragma('foreign_keys', { simple: true }) !== 1) {
      throw new PersistenceError('foreign-keys-disabled');
    }
    // Uma transacção de escrita vazia confirma, na abertura, o bloqueio de escrita e a permissão de
    // escrita, antes de qualquer leitura ou escrita do esquema.
    if (exclusive) database.exec('BEGIN EXCLUSIVE; COMMIT;');
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
};

const readSchema = (connection: SqliteDatabase): void => {
  connection.prepare('SELECT count(*) FROM sqlite_schema').pluck().get();
};

/**
 * Demonstra que `connection` detém efectivamente o bloqueio exclusivo de `filename`: a ligação está
 * em `locking_mode = EXCLUSIVE` e WAL, já acedeu ao ficheiro, e uma segunda ligação independente,
 * sem espera, é recusada com `SQLITE_BUSY`. Qualquer outro resultado falha fechado com
 * `exclusive-lock-unverified`. Não escreve na base.
 */
export const verifyExclusiveOwnership = (connection: SqliteDatabase, filename: string): void => {
  if (
    !connection.open ||
    connection.pragma('locking_mode', { simple: true }) !== 'exclusive' ||
    connection.pragma('journal_mode', { simple: true }) !== 'wal'
  ) {
    throw new PersistenceError('exclusive-lock-unverified');
  }
  readSchema(connection);

  let probe: SqliteDatabase | undefined;
  try {
    probe = new Database(filename, { fileMustExist: true, timeout: 0 });
    probe.pragma('busy_timeout = 0');
    readSchema(probe);
  } catch (error) {
    if (isSqliteBusy(error)) return;
    throw new PersistenceError('exclusive-lock-unverified', { cause: error });
  } finally {
    if (probe?.open) probe.close();
  }
  throw new PersistenceError('exclusive-lock-unverified');
};
