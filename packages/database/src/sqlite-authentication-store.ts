import {
  createUser,
  RecordConflictError,
  type Timestamp,
  type User,
  type UserId,
} from '@kil-business/shared-types';

import type { SqliteDatabase } from './connection.js';
import { PersistenceError } from './errors.js';
import { INSERT_USER_SQL, toUser, USER_COLUMNS, userParameters } from './sqlite-rows.js';
import { isPromiseLike, prepareAll, readRow, restoreStored, translated } from './sqlite-support.js';

/**
 * Credencial de palavra-passe persistida (D-092): só a derivação Argon2id, o salt e os
 * parâmetros. Não pertence ao contrato `User` e nunca sai do serviço local.
 */
export interface StoredPasswordCredential {
  readonly userId: UserId;
  readonly algorithm: 'argon2id';
  /** Versão do algoritmo Argon2 (19 = v1.3). */
  readonly algorithmVersion: number;
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/** Estado persistente da limitação de tentativas (D-094). As chaves de utilizador são SHA-256. */
export interface ThrottleRecord {
  readonly key: string;
  readonly failures: number;
  readonly windowStartedAt: string;
  readonly lockedUntil: string | undefined;
  readonly lastAttemptAt: string;
}

export interface InstallationBootstrapRecord {
  readonly initialAdministratorId: UserId;
  readonly completedAt: string;
}

/**
 * Operações SÍNCRONAS de autenticação sobre SQLite, para compor passos atómicos com
 * `transaction`. Interno ao serviço local: não é um repositório empresarial e não recebe
 * `TenantContext` (D-087, D-093).
 */
export interface SqliteAuthenticationStore {
  /** Localização interna exacta pelo username normalizado; não é uma pesquisa. */
  findUserByUsername(username: string): User | undefined;
  findUserById(id: UserId): User | undefined;
  /** Recusa identificador ou username repetidos (`RecordConflictError`). */
  insertUser(user: User): void;
  findCredential(userId: UserId): StoredPasswordCredential | undefined;
  /** Recusa uma segunda credencial principal (`RecordConflictError('duplicate-credential')`). */
  insertCredential(credential: StoredPasswordCredential): void;
  /**
   * Substitui a credencial só se o hash actual for `expectedHash` (concorrência optimista);
   * caso contrário, `RecordConflictError('credential-changed')`.
   */
  replaceCredential(credential: StoredPasswordCredential, expectedHash: Buffer): void;
  readThrottle(key: string): ThrottleRecord | undefined;
  writeThrottle(record: ThrottleRecord): void;
  deleteThrottle(key: string): void;
  /** Remove registos sem actividade desde `inactiveSince` e mantém no máximo `maxRows` (mais recentes). */
  pruneThrottle(inactiveSince: string, maxRows: number): void;
  countThrottle(): number;
  readBootstrap(): InstallationBootstrapRecord | undefined;
  insertBootstrap(record: InstallationBootstrapRecord): void;
  /** Transacção `IMMEDIATE` síncrona; trabalho assíncrono é recusado (D-034). */
  transaction<T>(work: () => T): T;
}

const SQL = {
  userByUsername: `SELECT ${USER_COLUMNS} FROM users WHERE username = ?`,
  userById: `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
  userIdExists: 'SELECT 1 FROM users WHERE id = ?',
  usernameTaken: 'SELECT 1 FROM users WHERE username = ?',
  insertUser: INSERT_USER_SQL,
  credentialByUser: `SELECT user_id AS userId, algorithm, algorithm_version AS algorithmVersion,
    memory_kib AS memoryKiB, passes, parallelism, salt, hash, created_at AS createdAt, updated_at AS updatedAt
    FROM password_credentials WHERE user_id = ?`,
  insertCredential: `INSERT INTO password_credentials
    (user_id, algorithm, algorithm_version, memory_kib, passes, parallelism, salt, hash, created_at, updated_at)
    VALUES (@userId, @algorithm, @algorithmVersion, @memoryKiB, @passes, @parallelism, @salt, @hash, @createdAt, @updatedAt)`,
  replaceCredential: `UPDATE password_credentials SET algorithm = @algorithm, algorithm_version = @algorithmVersion,
    memory_kib = @memoryKiB, passes = @passes, parallelism = @parallelism, salt = @salt, hash = @hash,
    updated_at = @updatedAt
    WHERE user_id = @userId AND hash = @expectedHash`,
  throttleByKey: `SELECT throttle_key AS key, failures, window_started_at AS windowStartedAt,
    locked_until AS lockedUntil, last_attempt_at AS lastAttemptAt FROM authentication_throttle WHERE throttle_key = ?`,
  upsertThrottle: `INSERT INTO authentication_throttle
    (throttle_key, failures, window_started_at, locked_until, last_attempt_at)
    VALUES (@key, @failures, @windowStartedAt, @lockedUntil, @lastAttemptAt)
    ON CONFLICT (throttle_key) DO UPDATE SET failures = excluded.failures,
      window_started_at = excluded.window_started_at, locked_until = excluded.locked_until,
      last_attempt_at = excluded.last_attempt_at`,
  deleteThrottle: 'DELETE FROM authentication_throttle WHERE throttle_key = ?',
  pruneInactiveThrottle: `DELETE FROM authentication_throttle
    WHERE throttle_key <> 'instance' AND last_attempt_at < ?`,
  pruneExcessThrottle: `DELETE FROM authentication_throttle WHERE throttle_key IN (
    SELECT throttle_key FROM authentication_throttle WHERE throttle_key <> 'instance'
    ORDER BY last_attempt_at DESC, throttle_key LIMIT -1 OFFSET ?)`,
  countThrottle: 'SELECT count(*) FROM authentication_throttle',
  bootstrap: `SELECT initial_administrator_id AS initialAdministratorId, completed_at AS completedAt
    FROM installation_bootstrap WHERE id = 1`,
  insertBootstrap: `INSERT INTO installation_bootstrap (id, initial_administrator_id, completed_at)
    VALUES (1, @initialAdministratorId, @completedAt)`,
} as const;

const integer = (row: Record<string, unknown>, key: string): number => {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new PersistenceError('invalid-stored-record');
  return value;
};

const blob = (row: Record<string, unknown>, key: string): Buffer => {
  const value = row[key];
  if (!Buffer.isBuffer(value)) throw new PersistenceError('invalid-stored-record');
  return value;
};

const textValue = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new PersistenceError('invalid-stored-record');
  return value;
};

const toCredential = (value: unknown): StoredPasswordCredential => {
  const row = readRow(value);
  const algorithm = textValue(row, 'algorithm');
  if (algorithm !== 'argon2id') throw new PersistenceError('invalid-stored-record');
  return Object.freeze({
    algorithm,
    algorithmVersion: integer(row, 'algorithmVersion'),
    createdAt: textValue(row, 'createdAt') as Timestamp,
    hash: blob(row, 'hash'),
    memoryKiB: integer(row, 'memoryKiB'),
    parallelism: integer(row, 'parallelism'),
    passes: integer(row, 'passes'),
    salt: blob(row, 'salt'),
    updatedAt: textValue(row, 'updatedAt') as Timestamp,
    userId: textValue(row, 'userId') as UserId,
  });
};

const toThrottle = (value: unknown): ThrottleRecord => {
  const row = readRow(value);
  const lockedUntil = row['lockedUntil'];
  if (lockedUntil !== null && typeof lockedUntil !== 'string') throw new PersistenceError('invalid-stored-record');
  return Object.freeze({
    failures: integer(row, 'failures'),
    key: textValue(row, 'key'),
    lastAttemptAt: textValue(row, 'lastAttemptAt'),
    lockedUntil: lockedUntil ?? undefined,
    windowStartedAt: textValue(row, 'windowStartedAt'),
  });
};

const credentialParameters = (credential: StoredPasswordCredential): Record<string, string | number | Buffer> => ({
  algorithm: credential.algorithm,
  algorithmVersion: credential.algorithmVersion,
  createdAt: credential.createdAt,
  hash: credential.hash,
  memoryKiB: credential.memoryKiB,
  parallelism: credential.parallelism,
  passes: credential.passes,
  salt: credential.salt,
  updatedAt: credential.updatedAt,
  userId: credential.userId,
});

/** Armazenamento SQLite de credenciais, limitação de tentativas e inicialização (E1.07-B). */
export const createSqliteAuthenticationStore = (database: SqliteDatabase): SqliteAuthenticationStore => {
  const statements = prepareAll(database, SQL);

  const findUserById = (id: UserId): User | undefined => {
    const row: unknown = statements.userById.get(id);
    return row === undefined ? undefined : toUser(row);
  };

  return {
    findUserByUsername: (username) => {
      const row: unknown = statements.userByUsername.get(username);
      return row === undefined ? undefined : toUser(row);
    },
    findUserById,
    insertUser: (candidate) => {
      const user = createUser(candidate);
      if (statements.userIdExists.get(user.id) !== undefined) throw new RecordConflictError('duplicate-id');
      if (statements.usernameTaken.get(user.username) !== undefined) {
        throw new RecordConflictError('duplicate-username');
      }
      statements.insertUser.run(userParameters(user));
    },
    findCredential: (userId) => {
      const row: unknown = statements.credentialByUser.get(userId);
      return row === undefined ? undefined : restoreStored(() => toCredential(row));
    },
    insertCredential: (credential) => {
      if (statements.credentialByUser.get(credential.userId) !== undefined) {
        throw new RecordConflictError('duplicate-credential');
      }
      statements.insertCredential.run(credentialParameters(credential));
    },
    replaceCredential: (credential, expectedHash) => {
      const result = statements.replaceCredential.run({ ...credentialParameters(credential), expectedHash });
      if (result.changes !== 1) throw new RecordConflictError('credential-changed');
    },
    readThrottle: (key) => {
      const row: unknown = statements.throttleByKey.get(key);
      return row === undefined ? undefined : toThrottle(row);
    },
    writeThrottle: (record) => {
      statements.upsertThrottle.run({ ...record, lockedUntil: record.lockedUntil ?? null });
    },
    deleteThrottle: (key) => {
      statements.deleteThrottle.run(key);
    },
    pruneThrottle: (inactiveSince, maxRows) => {
      statements.pruneInactiveThrottle.run(inactiveSince);
      statements.pruneExcessThrottle.run(maxRows);
    },
    countThrottle: () => statements.countThrottle.pluck().get() as number,
    readBootstrap: () => {
      const row: unknown = statements.bootstrap.get();
      if (row === undefined) return undefined;
      const record = readRow(row);
      return Object.freeze({
        completedAt: textValue(record, 'completedAt'),
        initialAdministratorId: textValue(record, 'initialAdministratorId') as UserId,
      });
    },
    insertBootstrap: (record) => {
      statements.insertBootstrap.run(record);
    },
    transaction: <T>(work: () => T): T =>
      translated(() =>
        database
          .transaction(() => {
            const result = work();
            if (isPromiseLike(result)) throw new PersistenceError('async-transaction');
            return result;
          })
          .immediate(),
      ),
  };
};
