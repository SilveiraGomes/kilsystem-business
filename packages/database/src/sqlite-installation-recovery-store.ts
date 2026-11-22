import type Database from 'better-sqlite3';

import { RecordConflictError, type UserId } from '@kil-business/shared-types';

import { PersistenceError } from './errors.js';
import { prepareAll, readRow, restoreStored } from './sqlite-support.js';

/*
 * E1.07-D3-R1 (PD-77; D-215, D-233): armazenamento SÍNCRONO da recuperação local do administrador
 * inicial (migração 9). Interno ao serviço local: não é um repositório empresarial, não recebe
 * `TenantContext` e nunca é exposto por HTTP nem IPC. Não guarda o código de recuperação: só o seu
 * verificador Argon2id. As operações são compostas dentro de `SqliteAuthenticationStore.transaction`
 * sobre a MESMA ligação, para que a substituição da credencial e o consumo do código sejam atómicos.
 */

export type RecoveryCodeState = 'ACTIVE' | 'CONSUMED' | 'SUPERSEDED';
export type RecoveryCodeIssueReason = 'first-issuance' | 'rotation' | 'recovery';

export interface StoredRecoveryCode {
  readonly id: string;
  readonly sequence: number;
  readonly initialAdministratorId: UserId;
  readonly anchorCompletedAt: string;
  readonly algorithm: 'argon2id';
  readonly algorithmVersion: number;
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
  readonly issuedAt: string;
  readonly issuedReason: RecoveryCodeIssueReason;
  readonly state: RecoveryCodeState;
  readonly endedAt: string | undefined;
}

/** Novo código: entra sempre `ACTIVE`, sem fim. */
export type NewRecoveryCode = Omit<StoredRecoveryCode, 'state' | 'endedAt'>;

export interface RecoveryThrottleRecord {
  readonly failures: number;
  /** Recusas por limitação, agregadas numa contagem (não geram um evento cada uma). */
  readonly refusedCount: number;
  readonly windowStartedAt: string;
  readonly lockedUntil: string | undefined;
  readonly lastAttemptAt: string;
}

export type RecoveryEventKind =
  | 'code-issued'
  | 'code-rotated'
  | 'rotation-refused'
  | 'recovery-attempted'
  | 'recovery-refused'
  | 'recovery-failed'
  | 'recovery-succeeded';

export type RecoveryEventReason =
  | 'anchor-not-intact'
  | 'administrator-not-active'
  | 'not-initial-administrator'
  | 'invalid-recovery-code'
  | 'recovery-code-changed'
  | 'credential-changed';

/** Evento sem segredos nem dados pessoais: só instante, tipo, motivo, sequências e versão. */
export interface RecoveryEventInput {
  readonly id: string;
  readonly occurredAt: string;
  readonly kind: RecoveryEventKind;
  readonly reason?: RecoveryEventReason;
  readonly consumedCodeSequence?: number;
  readonly issuedCodeSequence?: number;
  readonly resultingCredentialVersion?: number;
}

export interface RecoveryEventRecord extends RecoveryEventInput {
  readonly sequence: number;
}

export interface SqliteInstallationRecoveryStore {
  /** O único código `ACTIVE`, se existir. */
  readActiveCode(): StoredRecoveryCode | undefined;
  /** Sequência que o próximo código tem de usar (`max + 1`). */
  nextCodeSequence(): number;
  insertCode(code: NewRecoveryCode): void;
  /**
   * Termina o código `id` (`CONSUMED` ou `SUPERSEDED`) só se continuar `ACTIVE` com o verificador
   * `expectedHash`; caso contrário, `RecordConflictError('recovery-code-changed')`.
   */
  endCode(id: string, expectedHash: Buffer, state: Exclude<RecoveryCodeState, 'ACTIVE'>, endedAt: string): void;
  readThrottle(): RecoveryThrottleRecord | undefined;
  writeThrottle(record: RecoveryThrottleRecord): void;
  /** Acrescenta um evento com a sequência seguinte e devolve-o. */
  appendEvent(event: RecoveryEventInput): RecoveryEventRecord;
  /** Eventos por ordem de sequência (diagnóstico e futura auditoria, E1.07-E). */
  listEvents(): readonly RecoveryEventRecord[];
}

const SQL = {
  activeCode: `SELECT id, sequence, initial_administrator_id AS initialAdministratorId,
    anchor_completed_at AS anchorCompletedAt, algorithm, algorithm_version AS algorithmVersion,
    memory_kib AS memoryKiB, passes, parallelism, salt, hash, issued_at AS issuedAt,
    issued_reason AS issuedReason, state, ended_at AS endedAt
    FROM installation_recovery_codes WHERE state = 'ACTIVE'`,
  nextCodeSequence: 'SELECT coalesce(max(sequence), 0) + 1 FROM installation_recovery_codes',
  insertCode: `INSERT INTO installation_recovery_codes
    (id, sequence, initial_administrator_id, anchor_completed_at, algorithm, algorithm_version, memory_kib, passes,
      parallelism, salt, hash, issued_at, issued_reason, state, ended_at)
    VALUES (@id, @sequence, @initialAdministratorId, @anchorCompletedAt, @algorithm, @algorithmVersion, @memoryKiB,
      @passes, @parallelism, @salt, @hash, @issuedAt, @issuedReason, 'ACTIVE', NULL)`,
  endCode: `UPDATE installation_recovery_codes SET state = @state, ended_at = @endedAt
    WHERE id = @id AND state = 'ACTIVE' AND hash = @expectedHash`,
  throttle: `SELECT failures, refused_count AS refusedCount, window_started_at AS windowStartedAt,
    locked_until AS lockedUntil, last_attempt_at AS lastAttemptAt FROM installation_recovery_throttle WHERE id = 1`,
  upsertThrottle: `INSERT INTO installation_recovery_throttle
    (id, failures, refused_count, window_started_at, locked_until, last_attempt_at)
    VALUES (1, @failures, @refusedCount, @windowStartedAt, @lockedUntil, @lastAttemptAt)
    ON CONFLICT (id) DO UPDATE SET failures = excluded.failures, refused_count = excluded.refused_count,
      window_started_at = excluded.window_started_at, locked_until = excluded.locked_until,
      last_attempt_at = excluded.last_attempt_at`,
  appendEvent: `INSERT INTO installation_recovery_events
    (id, sequence, occurred_at, kind, reason, consumed_code_sequence, issued_code_sequence, resulting_credential_version)
    VALUES (@id, (SELECT coalesce(max(sequence), 0) + 1 FROM installation_recovery_events), @occurredAt, @kind,
      @reason, @consumedCodeSequence, @issuedCodeSequence, @resultingCredentialVersion)`,
  eventById: 'SELECT sequence FROM installation_recovery_events WHERE id = ?',
  events: `SELECT id, sequence, occurred_at AS occurredAt, kind, reason, consumed_code_sequence AS consumedCodeSequence,
    issued_code_sequence AS issuedCodeSequence, resulting_credential_version AS resultingCredentialVersion
    FROM installation_recovery_events ORDER BY sequence`,
} as const;

const CODE_STATES: readonly RecoveryCodeState[] = ['ACTIVE', 'CONSUMED', 'SUPERSEDED'];
const ISSUE_REASONS: readonly RecoveryCodeIssueReason[] = ['first-issuance', 'rotation', 'recovery'];
const EVENT_KINDS: readonly RecoveryEventKind[] = [
  'code-issued',
  'code-rotated',
  'rotation-refused',
  'recovery-attempted',
  'recovery-refused',
  'recovery-failed',
  'recovery-succeeded',
];
const EVENT_REASONS: readonly RecoveryEventReason[] = [
  'anchor-not-intact',
  'administrator-not-active',
  'not-initial-administrator',
  'invalid-recovery-code',
  'recovery-code-changed',
  'credential-changed',
];

const invalid = (): never => {
  throw new PersistenceError('invalid-stored-record');
};

const text = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  return typeof value === 'string' ? value : invalid();
};

const optionalText = (row: Record<string, unknown>, key: string): string | undefined =>
  row[key] === null || row[key] === undefined ? undefined : text(row, key);

const integer = (row: Record<string, unknown>, key: string): number => {
  const value = row[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : invalid();
};

const optionalInteger = (row: Record<string, unknown>, key: string): number | undefined =>
  row[key] === null || row[key] === undefined ? undefined : integer(row, key);

const blob = (row: Record<string, unknown>, key: string): Buffer => {
  const value = row[key];
  return Buffer.isBuffer(value) ? value : invalid();
};

const oneOf = <T extends string>(allowed: readonly T[], value: string): T =>
  (allowed as readonly string[]).includes(value) ? (value as T) : invalid();

const toCode = (value: unknown): StoredRecoveryCode => {
  const row = readRow(value);
  const algorithm = text(row, 'algorithm');
  if (algorithm !== 'argon2id') invalid();
  return Object.freeze({
    algorithm: 'argon2id',
    algorithmVersion: integer(row, 'algorithmVersion'),
    anchorCompletedAt: text(row, 'anchorCompletedAt'),
    endedAt: optionalText(row, 'endedAt'),
    hash: blob(row, 'hash'),
    id: text(row, 'id'),
    initialAdministratorId: text(row, 'initialAdministratorId') as UserId,
    issuedAt: text(row, 'issuedAt'),
    issuedReason: oneOf(ISSUE_REASONS, text(row, 'issuedReason')),
    memoryKiB: integer(row, 'memoryKiB'),
    parallelism: integer(row, 'parallelism'),
    passes: integer(row, 'passes'),
    salt: blob(row, 'salt'),
    sequence: integer(row, 'sequence'),
    state: oneOf(CODE_STATES, text(row, 'state')),
  });
};

const toThrottle = (value: unknown): RecoveryThrottleRecord => {
  const row = readRow(value);
  return Object.freeze({
    failures: integer(row, 'failures'),
    lastAttemptAt: text(row, 'lastAttemptAt'),
    lockedUntil: optionalText(row, 'lockedUntil'),
    refusedCount: integer(row, 'refusedCount'),
    windowStartedAt: text(row, 'windowStartedAt'),
  });
};

const toEvent = (value: unknown): RecoveryEventRecord => {
  const row = readRow(value);
  const reason = optionalText(row, 'reason');
  const consumedCodeSequence = optionalInteger(row, 'consumedCodeSequence');
  const issuedCodeSequence = optionalInteger(row, 'issuedCodeSequence');
  const resultingCredentialVersion = optionalInteger(row, 'resultingCredentialVersion');
  return Object.freeze({
    id: text(row, 'id'),
    kind: oneOf(EVENT_KINDS, text(row, 'kind')),
    occurredAt: text(row, 'occurredAt'),
    sequence: integer(row, 'sequence'),
    ...(reason === undefined ? {} : { reason: oneOf(EVENT_REASONS, reason) }),
    ...(consumedCodeSequence === undefined ? {} : { consumedCodeSequence }),
    ...(issuedCodeSequence === undefined ? {} : { issuedCodeSequence }),
    ...(resultingCredentialVersion === undefined ? {} : { resultingCredentialVersion }),
  });
};

/** Armazenamento SQLite da recuperação do administrador inicial (migração 9). */
export const createSqliteInstallationRecoveryStore = (database: Database.Database): SqliteInstallationRecoveryStore => {
  const statements = prepareAll(database, SQL);

  return Object.freeze<SqliteInstallationRecoveryStore>({
    readActiveCode: () => {
      const row: unknown = statements.activeCode.get();
      return row === undefined ? undefined : restoreStored(() => toCode(row));
    },
    nextCodeSequence: () => statements.nextCodeSequence.pluck().get() as number,
    insertCode: (code) => {
      statements.insertCode.run({
        algorithm: code.algorithm,
        algorithmVersion: code.algorithmVersion,
        anchorCompletedAt: code.anchorCompletedAt,
        hash: code.hash,
        id: code.id,
        initialAdministratorId: code.initialAdministratorId,
        issuedAt: code.issuedAt,
        issuedReason: code.issuedReason,
        memoryKiB: code.memoryKiB,
        parallelism: code.parallelism,
        passes: code.passes,
        salt: code.salt,
        sequence: code.sequence,
      });
    },
    endCode: (id, expectedHash, state, endedAt) => {
      const result = statements.endCode.run({ endedAt, expectedHash, id, state });
      if (result.changes !== 1) throw new RecordConflictError('recovery-code-changed');
    },
    readThrottle: () => {
      const row: unknown = statements.throttle.get();
      return row === undefined ? undefined : restoreStored(() => toThrottle(row));
    },
    writeThrottle: (record) => {
      statements.upsertThrottle.run({ ...record, lockedUntil: record.lockedUntil ?? null });
    },
    appendEvent: (event) => {
      statements.appendEvent.run({
        consumedCodeSequence: event.consumedCodeSequence ?? null,
        id: event.id,
        issuedCodeSequence: event.issuedCodeSequence ?? null,
        kind: event.kind,
        occurredAt: event.occurredAt,
        reason: event.reason ?? null,
        resultingCredentialVersion: event.resultingCredentialVersion ?? null,
      });
      const sequence = statements.eventById.pluck().get(event.id) as number;
      return Object.freeze({ ...event, sequence });
    },
    listEvents: () => Object.freeze(statements.events.all().map((row) => restoreStored(() => toEvent(row)))),
  });
};
