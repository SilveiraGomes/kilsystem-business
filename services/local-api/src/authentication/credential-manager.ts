import type { StoredPasswordCredential } from '@kil-business/database';
import {
  preparePassword,
  RecordConflictError,
  RecordNotFoundError,
  type Timestamp,
  type UserId,
} from '@kil-business/shared-types';

import type { AuthenticationBackend } from './authentication-backend.js';
import type { PasswordHash } from './password-hashing.js';
import { throttleKeyFor } from './throttle-policy.js';

/**
 * Gestão INTERNA de credenciais (D-095): só para procedimentos internos confiáveis do serviço
 * local. Não é exposta a consumidores empresariais, por HTTP, IPC ou interface pública, e não
 * existe recuperação por email, SMS ou outro canal.
 */
export interface CredentialManager {
  /** Primeira credencial de uma identidade existente; recusa uma segunda (`duplicate-credential`). */
  create(userId: UserId, password: unknown): Promise<void>;
  /** Substituição controlada; repõe o contador de tentativas do username. */
  replace(userId: UserId, password: unknown): Promise<void>;
}

export const toStoredCredential = (
  userId: UserId,
  hashed: PasswordHash,
  createdAt: Timestamp,
  updatedAt: Timestamp,
): StoredPasswordCredential =>
  Object.freeze({
    algorithm: hashed.algorithm,
    algorithmVersion: hashed.algorithmVersion,
    createdAt,
    hash: hashed.hash,
    memoryKiB: hashed.memoryKiB,
    parallelism: hashed.parallelism,
    passes: hashed.passes,
    salt: hashed.salt,
    updatedAt,
    userId,
  });

export const createCredentialManager = (backend: AuthenticationBackend): CredentialManager => {
  const prepare = (userId: UserId, password: unknown) => {
    const store = backend.acquire();
    const user = store.findUserById(userId);
    if (user === undefined) throw new RecordNotFoundError('User');
    const prepared = preparePassword(password, { commonPasswords: backend.commonPasswords, username: user.username });
    return { prepared, store, user };
  };

  return Object.freeze({
    create: async (userId: UserId, password: unknown): Promise<void> => {
      const { prepared, store } = prepare(userId, password);
      if (store.findCredential(userId) !== undefined) throw new RecordConflictError('duplicate-credential');
      const hashed = await backend.hasher.hash(prepared);
      backend.assertCurrent(store);
      const at = backend.clock().toISOString() as Timestamp;
      store.transaction(() => {
        if (store.findUserById(userId) === undefined) throw new RecordNotFoundError('User');
        store.insertCredential(toStoredCredential(userId, hashed, at, at));
      });
    },
    replace: async (userId: UserId, password: unknown): Promise<void> => {
      const { prepared, store, user } = prepare(userId, password);
      const existing = store.findCredential(userId);
      if (existing === undefined) throw new RecordNotFoundError('PasswordCredential');
      const hashed = await backend.hasher.hash(prepared);
      backend.assertCurrent(store);
      const at = backend.clock().toISOString() as Timestamp;
      store.transaction(() => {
        const updatedAt = at < existing.createdAt ? existing.createdAt : at;
        store.replaceCredential(toStoredCredential(userId, hashed, existing.createdAt, updatedAt), existing.hash);
        store.deleteThrottle(throttleKeyFor(user.username));
      });
    },
  });
};
