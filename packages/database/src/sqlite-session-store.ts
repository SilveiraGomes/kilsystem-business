import {
  parseOneOf,
  parseSessionId,
  parseUserId,
  SESSION_REVOCATION_REASONS,
  USER_STATUSES,
  type SessionId,
  type SessionRevocationReason,
  type UserId,
  type UserStatus,
} from '@kil-business/shared-types';

import type { SqliteDatabase } from './connection.js';
import { PersistenceError } from './errors.js';
import { isPromiseLike, prepareAll, readRow, restoreStored, translated } from './sqlite-support.js';

/** Bytes do digest SHA-256 persistido em vez do token (o token nunca é guardado). */
export const SESSION_TOKEN_DIGEST_BYTES = 32;

/**
 * Sessão local persistida (E1.07-C, D-109). Contém o digest do token, nunca o token. As colunas
 * de ligação (identidade, versões, arranque, criação e expiração absoluta) são imutáveis; só a
 * actividade e a revogação podem mudar, e a revogação é definitiva (triggers da migração 4).
 */
export interface StoredSession {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly tokenDigest: Buffer;
  readonly securityVersion: number;
  readonly credentialVersion: number;
  /** Arranque efectivo do serviço que emitiu a sessão (não é o identificador da instalação). */
  readonly serviceRunId: string;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly absoluteExpiresAt: string;
  readonly revokedAt: string | undefined;
  readonly revocationReason: SessionRevocationReason | undefined;
}

/** Estado corrente da identidade titular, lido na mesma consulta que a sessão. */
export interface SessionSubjectState {
  readonly status: UserStatus;
  readonly securityVersion: number;
  /** `undefined` quando a identidade não tem credencial. */
  readonly credentialVersion: number | undefined;
}

export interface SessionLookup {
  readonly session: StoredSession;
  readonly subject: SessionSubjectState;
}

/** Critérios de uma sessão efectivamente válida, para a contagem do limite por identidade. */
export interface ActiveSessionCriteria {
  readonly serviceRunId: string;
  readonly securityVersion: number;
  readonly credentialVersion: number;
  /** Instante corrente (ISO 8601): a expiração absoluta tem de ser posterior. */
  readonly now: string;
  /** Instante corrente menos a inactividade máxima: a última actividade tem de ser posterior. */
  readonly idleSince: string;
}

/**
 * Operações SÍNCRONAS sobre sessões, para compor passos atómicos com `transaction`. Interno ao
 * serviço local: sem `TenantContext`, sem pesquisa nem listagem de sessões (D-087, D-109).
 */
export interface SqliteSessionStore {
  readSubject(userId: UserId): SessionSubjectState | undefined;
  countActiveSessions(userId: UserId, criteria: ActiveSessionCriteria): number;
  digestExists(tokenDigest: Buffer): boolean;
  insertSession(session: StoredSession): void;
  findByDigest(tokenDigest: Buffer): SessionLookup | undefined;
  findById(id: SessionId): StoredSession | undefined;
  /** Só avança a actividade de uma sessão não revogada, sem recuar e sem passar a expiração absoluta. */
  recordActivity(id: SessionId, at: string): boolean;
  revokeByDigest(tokenDigest: Buffer, at: string, reason: SessionRevocationReason): number;
  revokeById(id: SessionId, at: string, reason: SessionRevocationReason): number;
  revokeUserSessions(userId: UserId, at: string, reason: SessionRevocationReason): number;
  /** Avança a versão de segurança da identidade (os triggers revogam o que restar). */
  advanceSecurityVersion(userId: UserId): boolean;
  /** Revoga as sessões não revogadas de qualquer outro arranque do serviço. */
  revokeOtherRuns(serviceRunId: string, at: string): number;
  /** Marca como expiradas as sessões não revogadas cuja validade terminou. */
  expireSessions(now: string, idleSince: string): number;
  /** Elimina apenas sessões já revogadas, terminadas antes de `cutoff`. */
  deleteEndedBefore(cutoff: string): number;
  /** Transacção `IMMEDIATE` síncrona; trabalho assíncrono é recusado (D-034). */
  transaction<T>(work: () => T): T;
}

const SESSION_COLUMNS = `s.id, s.user_id AS userId, s.token_digest AS tokenDigest, s.security_version AS securityVersion,
  s.credential_version AS credentialVersion, s.service_run_id AS serviceRunId, s.created_at AS createdAt,
  s.last_activity_at AS lastActivityAt, s.absolute_expires_at AS absoluteExpiresAt, s.revoked_at AS revokedAt,
  s.revocation_reason AS revocationReason`;

const SQL = {
  subject: `SELECT u.status AS subjectStatus, u.security_version AS subjectSecurityVersion,
    c.credential_version AS subjectCredentialVersion
    FROM users u LEFT JOIN password_credentials c ON c.user_id = u.id WHERE u.id = ?`,
  countActive: `SELECT count(*) FROM local_sessions s
    JOIN users u ON u.id = s.user_id
    JOIN password_credentials c ON c.user_id = s.user_id
    WHERE s.user_id = @userId AND s.revoked_at IS NULL AND u.status = 'ACTIVE'
      AND s.service_run_id = @serviceRunId
      AND s.security_version = @securityVersion AND u.security_version = @securityVersion
      AND s.credential_version = @credentialVersion AND c.credential_version = @credentialVersion
      AND s.absolute_expires_at > @now AND s.last_activity_at > @idleSince`,
  digestExists: 'SELECT 1 FROM local_sessions WHERE token_digest = ?',
  insert: `INSERT INTO local_sessions (id, user_id, token_digest, security_version, credential_version, service_run_id,
    created_at, last_activity_at, absolute_expires_at, revoked_at, revocation_reason)
    VALUES (@id, @userId, @tokenDigest, @securityVersion, @credentialVersion, @serviceRunId,
    @createdAt, @lastActivityAt, @absoluteExpiresAt, @revokedAt, @revocationReason)`,
  byDigest: `SELECT ${SESSION_COLUMNS}, u.status AS subjectStatus, u.security_version AS subjectSecurityVersion,
    c.credential_version AS subjectCredentialVersion
    FROM local_sessions s JOIN users u ON u.id = s.user_id LEFT JOIN password_credentials c ON c.user_id = s.user_id
    WHERE s.token_digest = ?`,
  byId: `SELECT ${SESSION_COLUMNS} FROM local_sessions s WHERE s.id = ?`,
  recordActivity: `UPDATE local_sessions SET last_activity_at = @at
    WHERE id = @id AND revoked_at IS NULL AND last_activity_at <= @at AND absolute_expires_at > @at`,
  revokeByDigest: `UPDATE local_sessions SET revoked_at = @at, revocation_reason = @reason
    WHERE token_digest = @tokenDigest AND revoked_at IS NULL`,
  revokeById: `UPDATE local_sessions SET revoked_at = @at, revocation_reason = @reason
    WHERE id = @id AND revoked_at IS NULL`,
  revokeUser: `UPDATE local_sessions SET revoked_at = @at, revocation_reason = @reason
    WHERE user_id = @userId AND revoked_at IS NULL`,
  advanceSecurityVersion: 'UPDATE users SET security_version = security_version + 1 WHERE id = ?',
  revokeOtherRuns: `UPDATE local_sessions SET revoked_at = @at, revocation_reason = 'service-restarted'
    WHERE revoked_at IS NULL AND service_run_id <> @serviceRunId`,
  expireAbsolute: `UPDATE local_sessions SET revoked_at = @now, revocation_reason = 'absolute-timeout'
    WHERE revoked_at IS NULL AND absolute_expires_at <= @now`,
  expireIdle: `UPDATE local_sessions SET revoked_at = @now, revocation_reason = 'idle-timeout'
    WHERE revoked_at IS NULL AND last_activity_at <= @idleSince`,
  deleteEnded: `DELETE FROM local_sessions
    WHERE revoked_at IS NOT NULL AND revoked_at < @cutoff AND absolute_expires_at < @cutoff`,
} as const;

const text = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== 'string') throw new PersistenceError('invalid-stored-record');
  return value;
};

const optionalText = (row: Record<string, unknown>, key: string): string | undefined =>
  row[key] === null ? undefined : text(row, key);

const version = (row: Record<string, unknown>, key: string): number => {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new PersistenceError('invalid-stored-record');
  }
  return value;
};

const optionalVersion = (row: Record<string, unknown>, key: string): number | undefined =>
  row[key] === null ? undefined : version(row, key);

const digest = (row: Record<string, unknown>, key: string): Buffer => {
  const value = row[key];
  if (!Buffer.isBuffer(value) || value.length !== SESSION_TOKEN_DIGEST_BYTES) {
    throw new PersistenceError('invalid-stored-record');
  }
  return value;
};

const toSession = (row: Record<string, unknown>): StoredSession =>
  restoreStored(() => {
    const reason = optionalText(row, 'revocationReason');
    return Object.freeze({
      absoluteExpiresAt: text(row, 'absoluteExpiresAt'),
      createdAt: text(row, 'createdAt'),
      credentialVersion: version(row, 'credentialVersion'),
      id: parseSessionId(text(row, 'id'), 'id'),
      lastActivityAt: text(row, 'lastActivityAt'),
      revocationReason:
        reason === undefined ? undefined : parseOneOf(reason, SESSION_REVOCATION_REASONS, 'revocationReason'),
      revokedAt: optionalText(row, 'revokedAt'),
      securityVersion: version(row, 'securityVersion'),
      serviceRunId: text(row, 'serviceRunId'),
      tokenDigest: digest(row, 'tokenDigest'),
      userId: parseUserId(text(row, 'userId'), 'userId'),
    });
  });

const toSubject = (row: Record<string, unknown>): SessionSubjectState =>
  restoreStored(() =>
    Object.freeze({
      credentialVersion: optionalVersion(row, 'subjectCredentialVersion'),
      securityVersion: version(row, 'subjectSecurityVersion'),
      status: parseOneOf(text(row, 'subjectStatus'), USER_STATUSES, 'status'),
    }),
  );

/** Armazenamento SQLite das sessões locais (E1.07-C). Consultas sempre parametrizadas. */
export const createSqliteSessionStore = (database: SqliteDatabase): SqliteSessionStore => {
  const statements = prepareAll(database, SQL);

  return {
    readSubject: (userId) => {
      const row: unknown = statements.subject.get(userId);
      return row === undefined ? undefined : toSubject(readRow(row));
    },
    countActiveSessions: (userId, criteria) =>
      statements.countActive.pluck().get({ ...criteria, userId }) as number,
    digestExists: (tokenDigest) => statements.digestExists.get(tokenDigest) !== undefined,
    insertSession: (session) => {
      statements.insert.run({
        ...session,
        revocationReason: session.revocationReason ?? null,
        revokedAt: session.revokedAt ?? null,
      });
    },
    findByDigest: (tokenDigest) => {
      const row: unknown = statements.byDigest.get(tokenDigest);
      if (row === undefined) return undefined;
      const record = readRow(row);
      return Object.freeze({ session: toSession(record), subject: toSubject(record) });
    },
    findById: (id) => {
      const row: unknown = statements.byId.get(id);
      return row === undefined ? undefined : toSession(readRow(row));
    },
    recordActivity: (id, at) => statements.recordActivity.run({ at, id }).changes === 1,
    revokeByDigest: (tokenDigest, at, reason) => statements.revokeByDigest.run({ at, reason, tokenDigest }).changes,
    revokeById: (id, at, reason) => statements.revokeById.run({ at, id, reason }).changes,
    revokeUserSessions: (userId, at, reason) => statements.revokeUser.run({ at, reason, userId }).changes,
    advanceSecurityVersion: (userId) => statements.advanceSecurityVersion.run(userId).changes === 1,
    revokeOtherRuns: (serviceRunId, at) => statements.revokeOtherRuns.run({ at, serviceRunId }).changes,
    expireSessions: (now, idleSince) =>
      statements.expireAbsolute.run({ now }).changes + statements.expireIdle.run({ idleSince, now }).changes,
    deleteEndedBefore: (cutoff) => statements.deleteEnded.run({ cutoff }).changes,
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
