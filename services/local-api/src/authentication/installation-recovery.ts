import { randomUUID } from 'node:crypto';

import {
  PersistenceError,
  type NewRecoveryCode,
  type RecoveryEventInput,
  type RecoveryEventReason,
  type SqliteAuthenticationStore,
  type SqliteInstallationRecoveryStore,
  type StoredPasswordCredential,
  type StoredRecoveryCode,
} from '@kil-business/database';
import {
  PasswordPolicyError,
  preparePassword,
  RecordConflictError,
  type PasswordPolicyViolation,
  type Timestamp,
  type User,
  type UserId,
} from '@kil-business/shared-types';

import type { AuthenticationBackend } from './authentication-backend.js';
import { toStoredCredential } from './credential-manager.js';
import type { LocalAuthenticator } from './local-authenticator.js';
import { PasswordHashingError, type PasswordHash } from './password-hashing.js';
import {
  createRecoveryCodePresentation,
  generateRecoveryCode,
  parseRecoveryCode,
  RecoveryCodeFormatError,
  type RandomBytes,
  type RecoveryCodePresentation,
} from './recovery-code.js';
import {
  evaluateRecoveryAttempt,
  RECOVERY_THROTTLE_POLICY,
  recoveryThrottleAfterSuccess,
} from './recovery-throttle-policy.js';
import { throttleKeyFor, type ThrottlePolicy } from './throttle-policy.js';

/*
 * Recuperação local do administrador inicial — R1 (E1.07-D3-R1; PD-77; D-215, D-223, D-233).
 *
 * É o ÚNICO caminho que substitui a credencial do administrador inicial; as operações comuns
 * continuam a recusá-lo (D-208, D-220, D-227). Interno ao serviço local: usado só pela CLI local,
 * com a base em uso exclusivo; nunca exposto por HTTP nem IPC. Não cria identidades nem
 * credenciais, não reactiva identidades e não toca em associações, perfis, concessões, empresas,
 * estabelecimentos nem no registo da instalação: não concede autoridade nenhuma.
 *
 * Protocolo (E1.07-D3-R1-P §6): derivações Argon2id sempre FORA das transacções (que são síncronas,
 * D-034); dentro de cada transacção `IMMEDIATE` os factos lidos antes são verificados de novo. O
 * novo código só é entregue depois do *commit*, por `RecoveryCodePresentation.reveal()`.
 */

export type RotationResult =
  | {
      readonly ok: true;
      readonly code: RecoveryCodePresentation;
      readonly issuedReason: 'first-issuance' | 'rotation';
      readonly supersededSequence: number | undefined;
    }
  /** Username/palavra-passe errados, identidade inactiva ou inexistente (resposta genérica, D-093). */
  | { readonly ok: false; readonly reason: 'authentication-failed' }
  | { readonly ok: false; readonly reason: 'throttled'; readonly retryAfterSeconds: number }
  /** A identidade autenticada não é o administrador inicial, ou a âncora/estado não o permitem. */
  | {
      readonly ok: false;
      readonly reason: 'rotation-refused';
      readonly cause: Extract<RecoveryEventReason, 'anchor-not-intact' | 'administrator-not-active' | 'not-initial-administrator'>;
    }
  /** A credencial ou o código activo mudaram durante a operação; nada foi escrito. */
  | { readonly ok: false; readonly reason: 'rotation-conflict' };

export type RecoveryResult =
  | { readonly ok: true; readonly code: RecoveryCodePresentation; readonly consumedSequence: number }
  /** Entrada mal formada ou com controlo errado; não conta como tentativa nem toca no segredo. */
  | { readonly ok: false; readonly reason: 'malformed-recovery-code' }
  /** A nova palavra-passe não cumpre D-091; recusada antes da admissão, sem gastar tentativas. */
  | { readonly ok: false; readonly reason: 'password-rejected'; readonly violation: PasswordPolicyViolation }
  | { readonly ok: false; readonly reason: 'throttled'; readonly retryAfterSeconds: number }
  /** Âncora não `intact` ou administrador não `ACTIVE`: só o procedimento de perda total (§10). */
  | {
      readonly ok: false;
      readonly reason: 'recovery-refused';
      readonly cause: Extract<RecoveryEventReason, 'anchor-not-intact' | 'administrator-not-active'>;
    }
  /** Resposta única perante o segredo: código errado, consumido, substituído ou inexistente. */
  | { readonly ok: false; readonly reason: 'invalid-recovery-code' }
  /** O código activo ou a credencial mudaram durante a operação; nada foi escrito e o código continua válido. */
  | { readonly ok: false; readonly reason: 'recovery-conflict' };

export interface InstallationRecovery {
  /**
   * Primeira emissão ou rotação do código, com autenticação completa do administrador inicial
   * (username e palavra-passe, com a limitação de D-094; D-233, DP-04). O código anterior, se
   * existir, fica `SUPERSEDED` sem ser preciso conhecê-lo.
   */
  rotate(username: unknown, password: unknown): Promise<RotationResult>;
  /** Recuperação com o código activo e uma nova palavra-passe (D-091). */
  recover(code: unknown, newPassword: unknown): Promise<RecoveryResult>;
}

export interface InstallationRecoveryStores {
  readonly authentication: SqliteAuthenticationStore;
  /** Sobre a MESMA ligação de `authentication`: compõe-se dentro de `authentication.transaction`. */
  readonly recovery: SqliteInstallationRecoveryStore;
}

export interface InstallationRecoveryBackend {
  readonly authentication: AuthenticationBackend;
  readonly authenticator: LocalAuthenticator;
  /** Recusa fora de `READY`; os dois armazenamentos pertencem ao arranque corrente. */
  readonly acquire: () => InstallationRecoveryStores;
  readonly throttlePolicy?: ThrottlePolicy;
  readonly randomBytes?: RandomBytes;
  readonly newId?: () => string;
}

/** Interrupção controlada dentro de uma transacção: provoca *rollback* e um resultado de recusa. */
type RefusalReason = Extract<RecoveryEventReason, 'anchor-not-intact' | 'administrator-not-active' | 'not-initial-administrator'>;

class RecoveryAbort extends Error {
  override readonly name = 'RecoveryAbort';

  constructor(readonly refusal: RefusalReason) {
    super(`Recuperação interrompida: ${refusal}.`);
  }
}

interface Anchored {
  readonly user: User;
  readonly completedAt: string;
}

/**
 * Âncora `intact` e administrador `ACTIVE` (D-233, DP-05). Recusa fechada em qualquer outro caso; a
 * recuperação nunca repara a âncora nem reactiva a identidade.
 */
const anchoredAdministrator = (
  store: SqliteAuthenticationStore,
): Anchored | Extract<RecoveryEventReason, 'anchor-not-intact' | 'administrator-not-active'> => {
  const anchor = store.readInstallationAnchor();
  if (anchor.state !== 'intact') return 'anchor-not-intact';
  const user = store.findUserById(anchor.initialAdministratorId);
  if (user === undefined) return 'anchor-not-intact';
  if (user.status !== 'ACTIVE') return 'administrator-not-active';
  return { completedAt: anchor.completedAt, user };
};

/**
 * Fim de um código nunca anterior à sua emissão (CHECK da migração 9): com o relógio do sistema
 * recuado, a recuperação e a rotação continuam possíveis em vez de falharem até o relógio avançar.
 */
const endInstant = (code: StoredRecoveryCode, at: string): string => (at < code.issuedAt ? code.issuedAt : at);

const sameCode = (left: StoredRecoveryCode | undefined, right: StoredRecoveryCode | undefined): boolean =>
  left !== undefined && right !== undefined && left.id === right.id && left.sequence === right.sequence && left.hash.equals(right.hash);

/** Igual a `sameCode`, mas dois "sem código activo" também coincidem (primeira emissão). */
const sameActiveCode = (left: StoredRecoveryCode | undefined, right: StoredRecoveryCode | undefined): boolean =>
  (left === undefined && right === undefined) || sameCode(left, right);

export const createInstallationRecovery = ({
  acquire,
  authentication: backend,
  authenticator,
  newId = randomUUID,
  randomBytes,
  throttlePolicy = RECOVERY_THROTTLE_POLICY,
}: InstallationRecoveryBackend): InstallationRecovery => {
  const now = (): string => backend.clock().toISOString();
  const event = (input: Omit<RecoveryEventInput, 'id' | 'occurredAt'>): RecoveryEventInput => ({
    ...input,
    id: newId(),
    occurredAt: now(),
  });

  const newCodeRow = (
    verifier: PasswordHash,
    anchored: Anchored,
    sequence: number,
    issuedReason: StoredRecoveryCode['issuedReason'],
    issuedAt: string,
  ): NewRecoveryCode => {
    return {
      algorithm: verifier.algorithm,
      algorithmVersion: verifier.algorithmVersion,
      anchorCompletedAt: anchored.completedAt,
      hash: verifier.hash,
      id: newId(),
      initialAdministratorId: anchored.user.id,
      issuedAt,
      issuedReason,
      memoryKiB: verifier.memoryKiB,
      parallelism: verifier.parallelism,
      passes: verifier.passes,
      salt: verifier.salt,
      sequence,
    };
  };

  /** Verificação do código em tempo equivalente com ou sem código activo (`burn`). */
  const verifyCode = async (candidate: string, active: StoredRecoveryCode | undefined): Promise<boolean> => {
    if (active === undefined) {
      await backend.hasher.burn(candidate);
      return false;
    }
    try {
      return await backend.hasher.verify(candidate, active);
    } catch (error) {
      if (!(error instanceof PasswordHashingError) || error.reason !== 'malformed-hash') throw error;
      await backend.hasher.burn(candidate);
      return false;
    }
  };

  const rotate = async (username: unknown, password: unknown): Promise<RotationResult> => {
    const authenticated = await authenticator.authenticate(username, password);
    if (!authenticated.ok) {
      return authenticated.reason === 'throttled'
        ? Object.freeze({ ok: false, reason: 'throttled', retryAfterSeconds: authenticated.retryAfterSeconds })
        : Object.freeze({ ok: false, reason: 'authentication-failed' });
    }
    const userId: UserId = authenticated.identity.userId;
    const { authentication: store, recovery } = acquire();

    const refuse = (cause: RefusalReason): RotationResult => {
      store.transaction(() => recovery.appendEvent(event({ kind: 'rotation-refused', reason: cause })));
      return Object.freeze({ cause, ok: false, reason: 'rotation-refused' });
    };

    const anchored = anchoredAdministrator(store);
    if (typeof anchored === 'string') return refuse(anchored);
    if (anchored.user.id !== userId) return refuse('not-initial-administrator');
    // Versões confirmadas depois da autenticação: uma substituição concorrente da credencial anula a rotação.
    const versions = store.readSecurityVersions(userId);
    // Código activo que esta rotação substitui (RV-R1M-03, E1.07-D3-R1-C1): se outra rotação ou uma
    // recuperação o mudar durante a derivação, esta rotação perde e não entrega código nenhum.
    const expectedActive = recovery.readActiveCode();

    const generated = generateRecoveryCode(randomBytes);
    const verifier = await backend.hasher.hash(generated.normalized);
    backend.assertCurrent(store);

    const at = now();
    let outcome: { readonly sequence: number; readonly superseded: number | undefined; readonly first: boolean };
    try {
      outcome = store.transaction(() => {
        const current = anchoredAdministrator(store);
        if (typeof current === 'string') throw new RecoveryAbort(current);
        if (current.user.id !== userId || current.completedAt !== anchored.completedAt) {
          throw new RecoveryAbort('not-initial-administrator');
        }
        const confirmed = store.readSecurityVersions(userId);
        if (
          versions === undefined ||
          confirmed === undefined ||
          confirmed.credentialVersion !== versions.credentialVersion ||
          confirmed.securityVersion !== versions.securityVersion
        ) {
          throw new RecordConflictError('credential-changed');
        }
        const active = recovery.readActiveCode();
        if (!sameActiveCode(active, expectedActive)) throw new RecordConflictError('recovery-code-changed');
        const sequence = recovery.nextCodeSequence();
        if (active !== undefined) {
          recovery.endCode(active.id, active.hash, 'SUPERSEDED', endInstant(active, at));
          recovery.insertCode(newCodeRow(verifier, current, sequence, 'rotation', at));
          recovery.appendEvent(
            event({ consumedCodeSequence: active.sequence, issuedCodeSequence: sequence, kind: 'code-rotated' }),
          );
          return { first: false, sequence, superseded: active.sequence };
        }
        recovery.insertCode(newCodeRow(verifier, current, sequence, 'first-issuance', at));
        recovery.appendEvent(event({ issuedCodeSequence: sequence, kind: 'code-issued' }));
        return { first: true, sequence, superseded: undefined };
      });
    } catch (error) {
      if (error instanceof RecoveryAbort) return refuse(error.refusal);
      // Sem código activo, mas com códigos anteriores (só por SQL directo): o esquema recusa a emissão.
      if (error instanceof RecordConflictError || (error instanceof PersistenceError && error.reason === 'constraint')) {
        return Object.freeze({ ok: false, reason: 'rotation-conflict' });
      }
      throw error;
    }
    return Object.freeze({
      code: createRecoveryCodePresentation(generated.formatted, outcome.sequence),
      issuedReason: outcome.first ? 'first-issuance' : 'rotation',
      ok: true,
      supersededSequence: outcome.superseded,
    });
  };

  const recover = async (code: unknown, newPassword: unknown): Promise<RecoveryResult> => {
    // 1. Validação local da entrada, antes de tocar no segredo.
    let candidate: string;
    try {
      candidate = parseRecoveryCode(code);
    } catch (error) {
      if (error instanceof RecoveryCodeFormatError) return Object.freeze({ ok: false, reason: 'malformed-recovery-code' });
      throw error;
    }
    const { authentication: store, recovery } = acquire();
    const bootstrap = store.readBootstrap();
    const named = bootstrap === undefined ? undefined : store.findUserById(bootstrap.initialAdministratorId);
    let prepared: string | undefined;
    if (named !== undefined) {
      try {
        prepared = preparePassword(newPassword, { commonPasswords: backend.commonPasswords, username: named.username });
      } catch (error) {
        if (error instanceof PasswordPolicyError) {
          return Object.freeze({ ok: false, reason: 'password-rejected', violation: error.violation });
        }
        throw error;
      }
    }

    // 2. Admissão: limitação contada ANTES da derivação; pré-condições; evento da tentativa.
    const instant = backend.clock().getTime();
    type Admission =
      | { readonly kind: 'throttled'; readonly retryAfterSeconds: number }
      | { readonly kind: 'refused'; readonly cause: Extract<RecoveryEventReason, 'anchor-not-intact' | 'administrator-not-active'> }
      | {
          readonly kind: 'admitted';
          readonly anchored: Anchored;
          readonly active: StoredRecoveryCode | undefined;
          readonly credential: StoredPasswordCredential | undefined;
        };
    const admission = store.transaction((): Admission => {
      const decision = evaluateRecoveryAttempt(recovery.readThrottle(), instant, throttlePolicy);
      if (!decision.allowed) {
        recovery.writeThrottle(decision.refused);
        return { kind: 'throttled', retryAfterSeconds: decision.retryAfterSeconds };
      }
      recovery.writeThrottle(decision.counted);
      recovery.appendEvent(event({ kind: 'recovery-attempted' }));
      const anchored = anchoredAdministrator(store);
      if (typeof anchored === 'string') {
        recovery.appendEvent(event({ kind: 'recovery-refused', reason: anchored }));
        return { cause: anchored, kind: 'refused' };
      }
      return {
        active: recovery.readActiveCode(),
        anchored,
        credential: store.findCredential(anchored.user.id),
        kind: 'admitted',
      };
    });
    if (admission.kind === 'throttled') {
      return Object.freeze({ ok: false, reason: 'throttled', retryAfterSeconds: admission.retryAfterSeconds });
    }
    if (admission.kind === 'refused') return Object.freeze({ cause: admission.cause, ok: false, reason: 'recovery-refused' });

    // 3. Verificação do código, fora da transacção; resposta única perante o segredo.
    const valid = await verifyCode(candidate, admission.active);
    backend.assertCurrent(store);
    const { active, anchored, credential } = admission;
    if (!valid || active === undefined || credential === undefined || prepared === undefined || named?.id !== anchored.user.id) {
      store.transaction(() => recovery.appendEvent(event({ kind: 'recovery-failed', reason: 'invalid-recovery-code' })));
      return Object.freeze({ ok: false, reason: 'invalid-recovery-code' });
    }

    // 4. Derivações da nova palavra-passe e do próximo código, fora da transacção.
    const hashedPassword = await backend.hasher.hash(prepared);
    backend.assertCurrent(store);
    const generated = generateRecoveryCode(randomBytes);
    const verifier = await backend.hasher.hash(generated.normalized);
    backend.assertCurrent(store);

    // 5. Confirmação atómica: reverificação, substituição, consumo, emissão, limitação e evento.
    const at = now();
    let issued: number;
    try {
      issued = store.transaction(() => {
        const current = anchoredAdministrator(store);
        if (typeof current === 'string') throw new RecoveryAbort(current);
        if (current.user.id !== anchored.user.id || current.completedAt !== anchored.completedAt) {
          throw new RecoveryAbort('anchor-not-intact');
        }
        if (!sameCode(recovery.readActiveCode(), active)) throw new RecordConflictError('recovery-code-changed');
        const updatedAt = (at < credential.createdAt ? credential.createdAt : at) as Timestamp;
        // Avança `credential_version`; os triggers da migração 4 revogam todas as sessões da identidade.
        store.replaceCredential(toStoredCredential(current.user.id, hashedPassword, credential.createdAt, updatedAt), credential.hash);
        recovery.endCode(active.id, active.hash, 'CONSUMED', endInstant(active, at));
        const sequence = recovery.nextCodeSequence();
        recovery.insertCode(newCodeRow(verifier, current, sequence, 'recovery', at));
        recovery.writeThrottle(recoveryThrottleAfterSuccess(recovery.readThrottle(), at));
        store.deleteThrottle(throttleKeyFor(current.user.username));
        const versions = store.readSecurityVersions(current.user.id);
        if (versions === undefined) throw new RecoveryAbort('anchor-not-intact');
        recovery.appendEvent(
          event({
            consumedCodeSequence: active.sequence,
            issuedCodeSequence: sequence,
            kind: 'recovery-succeeded',
            resultingCredentialVersion: versions.credentialVersion,
          }),
        );
        return sequence;
      });
    } catch (error) {
      if (error instanceof RecoveryAbort) {
        const cause = error.refusal === 'administrator-not-active' ? 'administrator-not-active' : 'anchor-not-intact';
        store.transaction(() => recovery.appendEvent(event({ kind: 'recovery-refused', reason: cause })));
        return Object.freeze({ cause, ok: false, reason: 'recovery-refused' });
      }
      if (error instanceof RecordConflictError) {
        const reason = error.reason === 'credential-changed' ? 'credential-changed' : 'recovery-code-changed';
        store.transaction(() => recovery.appendEvent(event({ kind: 'recovery-failed', reason })));
        return Object.freeze({ ok: false, reason: 'recovery-conflict' });
      }
      throw error;
    }
    return Object.freeze({
      code: createRecoveryCodePresentation(generated.formatted, issued),
      consumedSequence: active.sequence,
      ok: true,
    });
  };

  return Object.freeze({ recover, rotate });
};
