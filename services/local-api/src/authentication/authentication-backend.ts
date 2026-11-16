import type { SqliteAuthenticationStore } from '@kil-business/database';
import type { CommonPasswordList } from '@kil-business/shared-types';

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
  readonly hasher: PasswordHasher;
  readonly clock: () => Date;
  readonly commonPasswords: CommonPasswordList;
}
