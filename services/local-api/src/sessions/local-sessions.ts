import { randomUUID } from 'node:crypto';

import type { SessionLookup, SqliteSessionStore, StoredSession } from '@kil-business/database';
import {
  parseSessionId,
  parseUserId,
  RecordNotFoundError,
  type SessionId,
  type SessionPolicy,
  type Timestamp,
  type UserId,
} from '@kil-business/shared-types';

import { isAuthenticatedIdentity, type AuthenticatedIdentity } from '../authentication/local-authenticator.js';
import type { AuthenticationProofRegistry } from './authentication-proof.js';
import type { SessionClock } from './session-clock.js';
import { digestSessionToken, generateSessionToken, sameDigest } from './session-token.js';

/*
 * Sessões locais (E1.07-C, D-107 a D-114). Uma sessão comprova apenas que uma identidade foi
 * autenticada por este serviço, neste arranque: não contém empresa, tenant, âmbito nem permissões,
 * e não é uma autorização empresarial (E1.07-D). Todas as operações correm de forma síncrona,
 * numa transacção `IMMEDIATE`, logo depois de confirmarem que o serviço está em `READY` no mesmo
 * arranque: não há pontos de espera em que o serviço possa encerrar a meio.
 */

/** Dependências fornecidas pela composição do serviço local. */
export interface SessionBackend {
  /**
   * Armazenamento e arranque correntes. Recusa (`LocalServiceStateError`) fora de `READY` e
   * quando a referência pertence a um arranque anterior.
   */
  readonly acquire: () => { readonly store: SqliteSessionStore; readonly serviceRunId: string };
  readonly now: SessionClock;
  readonly proofs: AuthenticationProofRegistry;
  readonly policy: SessionPolicy;
}

/** Resultado da emissão: o token só é entregue aqui, uma única vez. */
export interface IssuedSession {
  readonly sessionId: SessionId;
  readonly token: string;
  readonly absoluteExpiresAt: Timestamp;
  readonly idleExpiresAt: Timestamp;
}

export type SessionCreationResult =
  | { readonly ok: true; readonly session: IssuedSession }
  /** Comprovativo inexistente, forjado, expirado, já utilizado, de outro arranque ou desactualizado. */
  | { readonly ok: false; readonly reason: 'authentication-required' }
  /** Limite de sessões válidas da identidade; nenhuma outra sessão é revogada. */
  | { readonly ok: false; readonly reason: 'session-limit-reached' };

/** Sessão válida: identidade autenticada, sem qualquer dado empresarial. */
export interface ValidatedSession {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly absoluteExpiresAt: Timestamp;
  readonly idleExpiresAt: Timestamp;
}

export type SessionValidationResult =
  | { readonly ok: true; readonly session: ValidatedSession }
  /** Recusa genérica: token malformado, inexistente, revogado, expirado ou desactualizado. */
  | { readonly ok: false; readonly reason: 'invalid-session' };

/** Operações do titular da sessão (serviço local, sem HTTP nem IPC nesta etapa). */
export interface LocalSessions {
  /** Exige o `AuthenticatedIdentity` devolvido por `authenticate`, recente e ainda não utilizado. */
  create(identity: AuthenticatedIdentity): Promise<SessionCreationResult>;
  /** Verifica a sessão sem alterar a actividade. */
  validate(token: unknown): Promise<SessionValidationResult>;
  /** Verifica e, só se for válida, regista actividade (nunca para além da expiração absoluta). */
  registerActivity(token: unknown): Promise<SessionValidationResult>;
  /** Terminação pelo titular; idempotente e silenciosa para tokens desconhecidos. */
  logout(token: unknown): Promise<void>;
}

/** Operações INTERNAS de administração e manutenção (D-087); autorização própria em E1.07-D. */
export interface SessionAdministration {
  /** Revoga uma sessão; devolve se havia uma sessão por revogar. */
  revokeSession(sessionId: SessionId): Promise<boolean>;
  /** Revoga todas as sessões da identidade e avança a sua versão de segurança. */
  revokeUserSessions(userId: UserId): Promise<number>;
  /** Marca como expiradas as sessões cuja validade terminou; devolve quantas. */
  expireSessions(): Promise<number>;
  /** Expira e elimina sessões terminadas há mais do que a retenção; devolve quantas eliminou. */
  cleanupSessions(): Promise<number>;
}

const SECOND = 1000;
const DAY = 86400 * SECOND;
const MAX_TOKEN_ATTEMPTS = 3;

const AUTHENTICATION_REQUIRED: SessionCreationResult = Object.freeze({ ok: false, reason: 'authentication-required' });
const SESSION_LIMIT: SessionCreationResult = Object.freeze({ ok: false, reason: 'session-limit-reached' });
const INVALID_SESSION: SessionValidationResult = Object.freeze({ ok: false, reason: 'invalid-session' });

const iso = (milliseconds: number): Timestamp => new Date(milliseconds).toISOString() as Timestamp;

/** Executa de forma síncrona e devolve uma promessa (excepções tornam-se rejeições). */
const run = <T>(operation: () => T): Promise<T> =>
  new Promise<T>((resolve) => {
    resolve(operation());
  });

interface Assessment {
  readonly session: StoredSession;
  readonly absoluteExpiresAt: number;
  readonly lastActivityAt: number;
}

/**
 * Decide se uma sessão é válida AGORA, comparando-a com o estado corrente da identidade e da
 * credencial lido na mesma consulta. Independente do marcador de revogação: versões diferentes
 * são recusadas mesmo que a revogação não tenha sido persistida.
 */
const assess = (
  lookup: SessionLookup | undefined,
  digest: Buffer,
  serviceRunId: string,
  now: number,
  policy: SessionPolicy,
): Assessment | undefined => {
  if (lookup === undefined) return undefined;
  const { session, subject } = lookup;
  if (!sameDigest(session.tokenDigest, digest)) return undefined;
  if (session.revokedAt !== undefined) return undefined;
  if (session.serviceRunId !== serviceRunId) return undefined;
  if (subject.status !== 'ACTIVE') return undefined;
  if (subject.securityVersion !== session.securityVersion) return undefined;
  if (subject.credentialVersion === undefined || subject.credentialVersion !== session.credentialVersion) return undefined;

  const createdAt = Date.parse(session.createdAt);
  const lastActivityAt = Date.parse(session.lastActivityAt);
  const storedExpiry = Date.parse(session.absoluteExpiresAt);
  if (![createdAt, lastActivityAt, storedExpiry].every(Number.isFinite)) return undefined;
  // Registos "no futuro" são inconsistentes com o relógio efectivo (que nunca recua): recusar.
  if (createdAt > now || lastActivityAt > now) return undefined;
  // Nunca mais do que a duração absoluta da política corrente, mesmo que o registo diga outra coisa.
  const absoluteExpiresAt = Math.min(storedExpiry, createdAt + policy.absoluteLifetimeSeconds * SECOND);
  if (now >= absoluteExpiresAt) return undefined;
  if (now >= lastActivityAt + policy.idleTimeoutSeconds * SECOND) return undefined;
  return { absoluteExpiresAt, lastActivityAt, session };
};

const validated = (assessment: Assessment, lastActivityAt: number, policy: SessionPolicy): SessionValidationResult =>
  Object.freeze({
    ok: true,
    session: Object.freeze({
      absoluteExpiresAt: iso(assessment.absoluteExpiresAt),
      idleExpiresAt: iso(
        Math.min(lastActivityAt + policy.idleTimeoutSeconds * SECOND, assessment.absoluteExpiresAt),
      ),
      sessionId: assessment.session.id,
      userId: assessment.session.userId,
    }),
  });

export const createLocalSessions = (backend: SessionBackend): LocalSessions => {
  const { policy } = backend;
  const idleMs = policy.idleTimeoutSeconds * SECOND;

  return Object.freeze({
    create: (identity: AuthenticatedIdentity): Promise<SessionCreationResult> =>
      run(() => {
        const { serviceRunId, store } = backend.acquire();
        // Retirado antes de qualquer verificação: um comprovativo nunca serve duas vezes.
        const proof = isAuthenticatedIdentity(identity) ? backend.proofs.consume(identity) : undefined;
        if (proof === undefined || proof.serviceRunId !== serviceRunId) return AUTHENTICATION_REQUIRED;
        const now = backend.now();
        const age = now - proof.issuedAt;
        if (age < 0 || age > policy.proofValiditySeconds * SECOND) return AUTHENTICATION_REQUIRED;

        return store.transaction((): SessionCreationResult => {
          // Revalidação imediatamente antes da criação, dentro da transacção que a grava.
          const subject = store.readSubject(proof.userId);
          if (
            subject === undefined ||
            subject.status !== 'ACTIVE' ||
            subject.securityVersion !== proof.securityVersion ||
            subject.credentialVersion !== proof.credentialVersion
          ) {
            return AUTHENTICATION_REQUIRED;
          }
          const active = store.countActiveSessions(proof.userId, {
            credentialVersion: proof.credentialVersion,
            idleSince: iso(now - idleMs),
            now: iso(now),
            securityVersion: proof.securityVersion,
            serviceRunId,
          });
          if (active >= policy.maxActiveSessionsPerUser) return SESSION_LIMIT;

          let generated = generateSessionToken();
          for (let attempt = 1; attempt < MAX_TOKEN_ATTEMPTS && store.digestExists(generated.digest); attempt += 1) {
            generated = generateSessionToken();
          }
          const absoluteExpiresAt = now + policy.absoluteLifetimeSeconds * SECOND;
          const sessionId = parseSessionId(randomUUID());
          store.insertSession({
            absoluteExpiresAt: iso(absoluteExpiresAt),
            createdAt: iso(now),
            credentialVersion: proof.credentialVersion,
            id: sessionId,
            lastActivityAt: iso(now),
            revocationReason: undefined,
            revokedAt: undefined,
            securityVersion: proof.securityVersion,
            serviceRunId,
            tokenDigest: generated.digest,
            userId: proof.userId,
          });
          return Object.freeze({
            ok: true,
            session: Object.freeze({
              absoluteExpiresAt: iso(absoluteExpiresAt),
              idleExpiresAt: iso(Math.min(now + idleMs, absoluteExpiresAt)),
              sessionId,
              token: generated.token,
            }),
          });
        });
      }),

    validate: (token: unknown): Promise<SessionValidationResult> =>
      run(() => {
        const { serviceRunId, store } = backend.acquire();
        const digest = digestSessionToken(token);
        if (digest === undefined) return INVALID_SESSION;
        const assessment = assess(store.findByDigest(digest), digest, serviceRunId, backend.now(), policy);
        return assessment === undefined ? INVALID_SESSION : validated(assessment, assessment.lastActivityAt, policy);
      }),

    registerActivity: (token: unknown): Promise<SessionValidationResult> =>
      run(() => {
        const { serviceRunId, store } = backend.acquire();
        const digest = digestSessionToken(token);
        if (digest === undefined) return INVALID_SESSION;
        return store.transaction(() => {
          const now = backend.now();
          const assessment = assess(store.findByDigest(digest), digest, serviceRunId, now, policy);
          // Só uma sessão válida regista actividade; uma tentativa inválida não a prolonga.
          if (assessment === undefined || !store.recordActivity(assessment.session.id, iso(now))) return INVALID_SESSION;
          return validated(assessment, now, policy);
        });
      }),

    logout: (token: unknown): Promise<void> =>
      run(() => {
        const { store } = backend.acquire();
        const digest = digestSessionToken(token);
        if (digest === undefined) return;
        store.transaction(() => store.revokeByDigest(digest, iso(backend.now()), 'logout'));
      }),
  });
};

export const createSessionAdministration = (backend: SessionBackend): SessionAdministration => {
  const { policy } = backend;
  const idleSince = (now: number): string => iso(now - policy.idleTimeoutSeconds * SECOND);

  return Object.freeze({
    revokeSession: (sessionId: SessionId): Promise<boolean> =>
      run(() => {
        const id = parseSessionId(sessionId);
        const { store } = backend.acquire();
        return store.transaction(() => store.revokeById(id, iso(backend.now()), 'administrative') > 0);
      }),

    revokeUserSessions: (userId: UserId): Promise<number> =>
      run(() => {
        const id = parseUserId(userId);
        const { store } = backend.acquire();
        return store.transaction(() => {
          if (store.readSubject(id) === undefined) throw new RecordNotFoundError('User');
          const revoked = store.revokeUserSessions(id, iso(backend.now()), 'user-sessions-revoked');
          // Também invalida comprovativos ainda não utilizados desta identidade.
          store.advanceSecurityVersion(id);
          return revoked;
        });
      }),

    expireSessions: (): Promise<number> =>
      run(() => {
        const { store } = backend.acquire();
        const now = backend.now();
        return store.transaction(() => store.expireSessions(iso(now), idleSince(now)));
      }),

    cleanupSessions: (): Promise<number> =>
      run(() => {
        const { store } = backend.acquire();
        const now = backend.now();
        return store.transaction(() => {
          store.expireSessions(iso(now), idleSince(now));
          return store.deleteEndedBefore(iso(now - policy.sessionRetentionDays * DAY));
        });
      }),
  });
};

/**
 * Preparação de um novo arranque: revoga as sessões de arranques anteriores (que já não podem
 * ser validadas) e elimina as terminadas há mais do que a retenção. Corre antes de `READY`.
 */
export const resetSessionsForRun = (
  store: SqliteSessionStore,
  serviceRunId: string,
  now: number,
  policy: SessionPolicy,
): { readonly revokedSessions: number; readonly removedSessions: number } =>
  store.transaction(() => {
    const revokedSessions = store.revokeOtherRuns(serviceRunId, iso(now));
    const removedSessions = store.deleteEndedBefore(iso(now - policy.sessionRetentionDays * DAY));
    return Object.freeze({ removedSessions, revokedSessions });
  });
