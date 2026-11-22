import type { SqliteAuthenticationStore } from '@kil-business/database';
import type { UserId } from '@kil-business/shared-types';

/**
 * E1.07-D3-G0 (PD-75; D-201, condição 3): o estado e a credencial do administrador inicial só podem
 * ser alterados com autoridade da instalação. Essa autoridade ainda não existe — a activação está
 * bloqueada até ao processo de recuperação e administração aprovado —, pelo que o provisionamento
 * interno recusa, de forma fechada, alterar o estado ou criar ou substituir administrativamente a
 * credencial desta identidade — também quando a credencial falta (E1.07-D3-G0-R1, PD-80): repô-la é
 * matéria da recuperação R1 (D-215), ainda não implementada, e nunca do provisionamento comum. Pela
 * mesma razão, recusa recriar a identidade quando a linha falta (E1.07-D3-G0-R3, PD-82). Saber o
 * identificador do administrador não é prova de autoridade. Não abrange a renovação da derivação feita pelo próprio titular ao autenticar-se
 * com a palavra-passe correcta (D-090), nem a revogação das suas sessões.
 *
 * Fronteira (D-201, condição 4): um escritor SQL pela ligação normal continua a poder editar a linha
 * e substituir a credencial; esta protecção é da aplicação, não do esquema.
 */
export class InitialAdministratorProtectedError extends Error {
  override readonly name = 'InitialAdministratorProtectedError';
  readonly reason = 'initial-administrator-protected';

  constructor() {
    super('Operação recusada: o administrador inicial só pode ser alterado com autoridade da instalação.');
  }
}

/**
 * Recusa quando `userId` é a identidade referida pelo registo da instalação. O registo é imutável
 * (migração 7) e a inicialização cria sempre uma identidade nova, pelo que uma identidade existente
 * nunca passa a ser o administrador inicial depois desta verificação.
 */
export const assertNotInitialAdministrator = (store: SqliteAuthenticationStore, userId: UserId): void => {
  if (store.readBootstrap()?.initialAdministratorId === userId) throw new InitialAdministratorProtectedError();
};

/**
 * E1.07-D3-G0-R3 (PD-82): recusa uma identidade NOVA cujo identificador é o do administrador
 * inicial, exista ou não a linha `users` dele. O provisionamento comum nunca recria essa identidade:
 * uma âncora `broken` por identidade ausente só pode ser tratada pela recuperação R1 (D-215). Corre
 * antes de qualquer validação do candidato; lê `id` uma única vez e normaliza-o como `parseUserId`
 * (UUID em minúsculas), sem validar o resto. A verificação definitiva é a repetida dentro da
 * transacção, sobre a identidade já validada.
 */
export const assertCandidateIsNotInitialAdministrator = (store: SqliteAuthenticationStore, candidate: unknown): void => {
  const id: unknown = typeof candidate === 'object' && candidate !== null ? (candidate as { readonly id?: unknown }).id : undefined;
  if (typeof id === 'string') assertNotInitialAdministrator(store, id.toLowerCase() as UserId);
};
