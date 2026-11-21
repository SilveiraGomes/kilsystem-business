import type { InstallationAnchor } from '@kil-business/database';
import {
  createUser,
  preparePassword,
  type Timestamp,
  type UserId,
} from '@kil-business/shared-types';

import type { AuthenticationBackend } from './authentication-backend.js';
import { toStoredCredential } from './credential-manager.js';

/**
 * Inicialização explícita da instalação (D-096). Cria a primeira identidade administrativa
 * da instalação e a sua credencial numa única transacção, uma única vez. Não existem contas
 * nem palavras-passe predefinidas, nada é criado no arranque, e a identidade criada NÃO recebe
 * associações nem permissões empresariais (autoridade efectiva: E1.07-D; administração KIL
 * separada, D-083).
 */
export interface InitialAdministratorInput {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
}

export interface InstallationStatus {
  readonly initialised: boolean;
  readonly initialAdministratorId?: UserId;
  readonly completedAt?: string;
}

export interface InstallationBootstrap {
  /** Descritivo: o identificador persistido não comprova a identidade (usar `verifyAnchor`). */
  status(): Promise<InstallationStatus>;
  /**
   * Única fonte admissível da identidade do administrador inicial para a futura autoridade da
   * instalação (E1.07-D3-G0, D-201): recusa fechada (`broken`) se a identidade referida não existir,
   * não for a criada na inicialização ou não tiver credencial. Não autentica e não concede autoridade.
   */
  verifyAnchor(): Promise<InstallationAnchor>;
  initialise(administrator: InitialAdministratorInput, password: unknown): Promise<{ readonly initialAdministratorId: UserId }>;
}

export type InstallationBootstrapErrorReason = 'already-initialised';

export class InstallationBootstrapError extends Error {
  override readonly name = 'InstallationBootstrapError';

  constructor(readonly reason: InstallationBootstrapErrorReason) {
    super(`Inicialização da instalação recusada: ${reason}.`);
  }
}

export const createInstallationBootstrap = (backend: AuthenticationBackend): InstallationBootstrap =>
  Object.freeze({
    status: (): Promise<InstallationStatus> =>
      new Promise<InstallationStatus>((resolve) => {
        const record = backend.acquire().readBootstrap();
        resolve(
          Object.freeze(
            record === undefined
              ? { initialised: false }
              : { completedAt: record.completedAt, initialAdministratorId: record.initialAdministratorId, initialised: true },
          ),
        );
      }),
    verifyAnchor: (): Promise<InstallationAnchor> =>
      new Promise<InstallationAnchor>((resolve) => {
        resolve(backend.acquire().readInstallationAnchor());
      }),
    initialise: async (administrator: InitialAdministratorInput, password: unknown) => {
      const store = backend.acquire();
      const at = backend.clock().toISOString() as Timestamp;
      // Sempre uma identidade NOVA: identidades provisionadas antes nunca são promovidas.
      const user = createUser({
        createdAt: at,
        displayName: administrator.displayName,
        email: administrator.email,
        id: administrator.id,
        phone: administrator.phone,
        status: 'ACTIVE',
        username: administrator.username,
      });
      const prepared = preparePassword(password, { commonPasswords: backend.commonPasswords, username: user.username });
      if (store.readBootstrap() !== undefined) throw new InstallationBootstrapError('already-initialised');

      const hashed = await backend.hasher.hash(prepared);
      backend.assertCurrent(store);
      // Transacção IMMEDIATE: inicializações concorrentes ficam serializadas e só a primeira grava.
      store.transaction(() => {
        if (store.readBootstrap() !== undefined) throw new InstallationBootstrapError('already-initialised');
        store.insertUser(user);
        store.insertCredential(toStoredCredential(user.id, hashed, at, at));
        store.insertBootstrap({ completedAt: at, initialAdministratorId: user.id });
      });
      return Object.freeze({ initialAdministratorId: user.id });
    },
  });
