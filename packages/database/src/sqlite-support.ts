import Database from 'better-sqlite3';

import {
  DomainValidationError,
  RecordConflictError,
  RecordNotFoundError,
  TenantContextError,
  TenantMismatchError,
} from '@kil-business/shared-types';

import { PersistenceError } from './errors.js';

/*
 * Auxiliares internos comuns aos repositórios SQLite (E1.04 e E1.07-A). Não são exportados
 * pelo pacote.
 */

const DOMAIN_ERRORS = [
  DomainValidationError,
  PersistenceError,
  RecordConflictError,
  RecordNotFoundError,
  TenantContextError,
  TenantMismatchError,
] as const;

/** Erros de domínio passam inalterados; erros SQLite tornam-se `PersistenceError` sem SQL nem valores. */
export const translateError = (error: unknown): unknown => {
  if (DOMAIN_ERRORS.some((type) => error instanceof type)) return error;
  if (error instanceof Database.SqliteError) {
    return new PersistenceError(error.code.startsWith('SQLITE_CONSTRAINT') ? 'constraint' : 'sqlite', {
      cause: error,
    });
  }
  return error;
};

export const translated = <T>(operation: () => T): T => {
  try {
    return operation();
  } catch (error) {
    throw translateError(error);
  }
};

/** Converte excepções síncronas em promessas rejeitadas, mantendo o contrato assíncrono. */
export const settle = <T>(operation: () => T): Promise<T> =>
  new Promise<T>((resolve) => {
    resolve(translated(operation));
  });

export const isPromiseLike = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function';

export const readRow = (row: unknown): Record<string, unknown> => {
  if (typeof row !== 'object' || row === null) throw new PersistenceError('invalid-stored-record');
  return row as Record<string, unknown>;
};

export const text = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new PersistenceError('invalid-stored-record');
  return value;
};

export const optionalText = (row: Record<string, unknown>, key: string): string | undefined =>
  row[key] === null ? undefined : text(row, key);

/** Registos persistidos inválidos são reportados como `invalid-stored-record` (D-036). */
export const restoreStored = <T>(restore: () => T): T => {
  try {
    return restore();
  } catch (error) {
    throw new PersistenceError('invalid-stored-record', { cause: error });
  }
};

/** Prepara um conjunto nomeado de instruções parametrizadas. */
export const prepareAll = <Key extends string>(
  database: Database.Database,
  sql: Readonly<Record<Key, string>>,
): Record<Key, Database.Statement> =>
  Object.fromEntries(Object.entries<string>(sql).map(([key, statement]) => [key, database.prepare(statement)])) as Record<
    Key,
    Database.Statement
  >;
