import type { UserId } from '@kil-business/shared-types';

/*
 * Comprovativo interno de autenticação (E1.07-C, D-108). É emitido pelo serviço local depois de
 * uma autenticação confirmada e fica associado, num `WeakMap` privado de cada serviço, ao objecto
 * `AuthenticatedIdentity` devolvido por `authenticate`. Não é persistido, não contém segredos e
 * nunca é exposto: o consumidor só pode entregar o objecto recebido, e uma cópia ou um objecto
 * com a mesma forma não tem comprovativo.
 */
export interface AuthenticationProof {
  readonly userId: UserId;
  readonly securityVersion: number;
  readonly credentialVersion: number;
  /** Arranque do serviço em que a autenticação foi confirmada. */
  readonly serviceRunId: string;
  /** Instante efectivo da emissão (relógio das sessões, em milissegundos). */
  readonly issuedAt: number;
}

export interface AuthenticationProofRegistry {
  register(identity: object, proof: AuthenticationProof): void;
  /**
   * Utilização única e atómica: devolve o comprovativo e retira-o antes de qualquer verificação.
   * O JavaScript executa esta operação sem interrupções, pelo que de duas utilizações
   * concorrentes só a primeira o obtém. Valores sem comprovativo devolvem `undefined`.
   */
  consume(value: unknown): AuthenticationProof | undefined;
}

export const createAuthenticationProofRegistry = (): AuthenticationProofRegistry => {
  const proofs = new WeakMap<object, AuthenticationProof>();
  return Object.freeze({
    register: (identity: object, proof: AuthenticationProof): void => {
      proofs.set(identity, Object.freeze({ ...proof }));
    },
    consume: (value: unknown): AuthenticationProof | undefined => {
      if (typeof value !== 'object' || value === null) return undefined;
      const proof = proofs.get(value);
      proofs.delete(value);
      return proof;
    },
  });
};
