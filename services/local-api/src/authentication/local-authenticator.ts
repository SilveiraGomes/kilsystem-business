import type { StoredPasswordCredential } from '@kil-business/database';
import {
  DomainValidationError,
  isUserEligible,
  normalizePasswordInput,
  normalizeUsername,
  PasswordPolicyError,
  type Timestamp,
  type User,
  type UserId,
} from '@kil-business/shared-types';

import type { AuthenticationBackend } from './authentication-backend.js';
import { PasswordHashingError, type PasswordHash } from './password-hashing.js';
import {
  AUTHENTICATION_THROTTLE_POLICY,
  evaluateAttempt,
  instanceAfterSuccess,
  INSTANCE_THROTTLE_KEY,
  throttleKeyFor,
  type ThrottlePolicy,
} from './throttle-policy.js';

/**
 * Resultado mínimo de uma autenticação local por palavra-passe (D-093). Não é uma sessão, um
 * token nem uma autorização: não contém empresa, tenant, âmbito ou permissões. Só os objectos
 * emitidos por este módulo são reconhecidos por `isAuthenticatedIdentity`, o que NÃO basta para
 * criar sessões: a criação exige o comprovativo interno associado a este objecto pelo serviço,
 * válido durante 60 s, de utilização única e ligado ao arranque e às versões de segurança
 * (E1.07-C, D-108; resolve a PD-40).
 */
export interface AuthenticatedIdentity {
  readonly userId: UserId;
  readonly method: 'password';
  readonly authenticatedAt: Timestamp;
}

export type AuthenticationResult =
  | { readonly ok: true; readonly identity: AuthenticatedIdentity }
  /** Recusa genérica: username inexistente, palavra-passe errada, identidade inactiva ou sem credencial. */
  | { readonly ok: false; readonly reason: 'invalid-credentials' }
  /** Limitação de tentativas; aplica-se igualmente a usernames existentes e inexistentes. */
  | { readonly ok: false; readonly reason: 'throttled'; readonly retryAfterSeconds: number };

export interface LocalAuthenticator {
  authenticate(username: unknown, password: unknown): Promise<AuthenticationResult>;
}

// Registo dos resultados genuínos: um objecto com a mesma forma, criado por outro código, não é
// reconhecido. A emissão não é exportada.
const issued = new WeakSet<object>();

const issueIdentity = (userId: UserId, at: Date): AuthenticatedIdentity => {
  const identity: AuthenticatedIdentity = Object.freeze({
    authenticatedAt: at.toISOString() as Timestamp,
    method: 'password',
    userId,
  });
  issued.add(identity);
  return identity;
};

/** Verdadeiro apenas para identidades emitidas por `authenticate` neste processo. */
export const isAuthenticatedIdentity = (value: unknown): value is AuthenticatedIdentity =>
  typeof value === 'object' && value !== null && issued.has(value);

const INVALID: AuthenticationResult = Object.freeze({ ok: false, reason: 'invalid-credentials' });

interface Candidate {
  readonly user: User;
  readonly credential: StoredPasswordCredential;
}

/**
 * Autenticação local por username e palavra-passe, offline, sobre o SQLite do serviço (D-093):
 * 1. entradas limitadas e normalizadas; 2. limitação de tentativas (contagem antecipada);
 * 3. identidade e credencial localizadas internamente; 4. estado verificado; 5. uma única
 * derivação Argon2id em todos os casos admitidos (derivação equivalente quando não há
 * credencial elegível); 6. confirmação transaccional e eventual actualização de parâmetros.
 */
export const createLocalAuthenticator = (
  backend: AuthenticationBackend,
  policy: ThrottlePolicy = AUTHENTICATION_THROTTLE_POLICY,
): LocalAuthenticator => {
  const verify = async (password: string, candidate: Candidate | undefined): Promise<boolean> => {
    if (candidate === undefined) {
      await backend.hasher.burn(password);
      return false;
    }
    try {
      return await backend.hasher.verify(password, candidate.credential);
    } catch (error) {
      if (!(error instanceof PasswordHashingError) || error.reason !== 'malformed-hash') throw error;
      await backend.hasher.burn(password);
      return false;
    }
  };

  return Object.freeze({
    authenticate: async (username: unknown, password: unknown): Promise<AuthenticationResult> => {
      const store = backend.acquire();
      let normalizedUsername: string;
      let normalizedPassword: string;
      try {
        normalizedUsername = normalizeUsername(username);
        normalizedPassword = normalizePasswordInput(password);
      } catch (error) {
        if (error instanceof DomainValidationError || error instanceof PasswordPolicyError) return INVALID;
        throw error;
      }

      const key = throttleKeyFor(normalizedUsername);
      const now = backend.clock().getTime();
      const admission = store.transaction(() => {
        const decision = evaluateAttempt(
          key,
          store.readThrottle(key),
          store.readThrottle(INSTANCE_THROTTLE_KEY),
          now,
          policy,
        );
        if (!decision.allowed) return { candidate: undefined, decision };
        store.writeThrottle(decision.user);
        store.writeThrottle(decision.instance);
        store.pruneThrottle(new Date(now - policy.failureMemorySeconds * 1000).toISOString(), policy.maxTrackedKeys);
        const user = store.findUserByUsername(normalizedUsername);
        const credential = user !== undefined && isUserEligible(user) ? store.findCredential(user.id) : undefined;
        const candidate: Candidate | undefined =
          user !== undefined && credential !== undefined ? { credential, user } : undefined;
        return { candidate, decision };
      });
      if (!admission.decision.allowed) {
        return Object.freeze({
          ok: false,
          reason: 'throttled',
          retryAfterSeconds: admission.decision.retryAfterSeconds,
        });
      }

      const { candidate } = admission;
      const valid = await verify(normalizedPassword, candidate);
      backend.assertCurrent(store);
      if (!valid || candidate === undefined) return INVALID;

      let upgraded: PasswordHash | undefined;
      if (backend.hasher.needsRehash(candidate.credential)) {
        upgraded = await backend.hasher.hash(normalizedPassword);
        backend.assertCurrent(store);
      }

      const at = backend.clock();
      const confirmed = store.transaction(() => {
        // A identidade ou a credencial podem ter mudado durante a derivação.
        const user = store.findUserById(candidate.user.id);
        const credential = store.findCredential(candidate.user.id);
        if (user === undefined || !isUserEligible(user) || credential === undefined) return undefined;
        if (!credential.hash.equals(candidate.credential.hash)) return undefined;
        store.deleteThrottle(key);
        const instance = instanceAfterSuccess(store.readThrottle(INSTANCE_THROTTLE_KEY));
        if (instance !== undefined) store.writeThrottle(instance);
        if (upgraded !== undefined) {
          // Avança a versão da credencial e, pelos triggers, revoga as sessões da identidade (D-111).
          // Na prática não há nenhuma: as de arranques anteriores foram revogadas no arranque e,
          // com parâmetros fixos por serviço, recalcula a primeira autenticação neste arranque.
          store.replaceCredential(
            { ...upgraded, createdAt: credential.createdAt, updatedAt: at.toISOString() as Timestamp, userId: user.id },
            credential.hash,
          );
        }
        // Versões confirmadas na mesma transacção, depois de qualquer recálculo.
        return store.readSecurityVersions(user.id);
      });
      if (confirmed === undefined) return INVALID;
      const identity = issueIdentity(candidate.user.id, at);
      backend.registerProof(store, identity, confirmed);
      return Object.freeze({ identity, ok: true });
    },
  });
};
