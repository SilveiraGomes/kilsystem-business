import type { SecurityVersions, SqliteAuthenticationStore } from '@kil-business/database';
import type { CommonPasswordList } from '@kil-business/shared-types';

import type { AuthenticatedIdentity } from './local-authenticator.js';
import type { PasswordHasher } from './password-hashing.js';

/**
 * Dependências das operações de autenticação, fornecidas pela composição do serviço local.
 * `acquire` recusa fora de `READY`; `assertCurrent` é chamado depois de cada derivação
 * assíncrona, para que uma operação concluída após o encerramento (ou após um novo arranque)
 * nunca escreva através de uma ligação obsoleta.
 */
export interface AuthenticationBackend {
  readonly acquire: () => SqliteAuthenticationStore;
  readonly assertCurrent: (store: SqliteAuthenticationStore) => void;
  /**
   * Associa à identidade emitida o comprovativo interno (E1.07-C, D-108), ligado às versões
   * confirmadas e ao arranque corrente. Recusa se `store` já não pertencer ao arranque activo.
   */
  readonly registerProof: (
    store: SqliteAuthenticationStore,
    identity: AuthenticatedIdentity,
    versions: SecurityVersions,
  ) => void;
  readonly hasher: PasswordHasher;
  readonly clock: () => Date;
  readonly commonPasswords: CommonPasswordList;
}
