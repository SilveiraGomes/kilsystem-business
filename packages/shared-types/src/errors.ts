// As mensagens identificam o campo ou a regra violada, mas nunca reproduzem valores recebidos.

export class DomainValidationError extends Error {
  override readonly name = 'DomainValidationError';

  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`Valor inválido em '${field}': ${reason}.`);
  }
}

export type TenantContextErrorReason = 'missing' | 'invalid';

export class TenantContextError extends Error {
  override readonly name = 'TenantContextError';

  constructor(readonly reason: TenantContextErrorReason) {
    super(
      reason === 'missing'
        ? 'A operação exige um contexto empresarial.'
        : 'O contexto empresarial fornecido é inválido.',
    );
  }
}

export class TenantMismatchError extends Error {
  override readonly name = 'TenantMismatchError';

  constructor() {
    super('O registo não pertence ao tenant do contexto empresarial.');
  }
}

export type RecordKind =
  | 'Company'
  | 'Branch'
  | 'User'
  | 'CompanyMembership'
  | 'BranchMembership'
  | 'PasswordCredential'
  | 'Role'
  | 'RoleAssignment';

export class RecordNotFoundError extends Error {
  override readonly name = 'RecordNotFoundError';

  constructor(readonly kind: RecordKind) {
    super(`Registo '${kind}' não encontrado no contexto empresarial.`);
  }
}

export type RecordConflictReason =
  | 'duplicate-id'
  | 'tenant-already-has-company'
  | 'company-has-branches'
  | 'duplicate-branch-code'
  | 'immutable-field'
  | 'duplicate-username'
  | 'duplicate-company-membership'
  | 'duplicate-branch-membership'
  | 'membership-not-branch-restricted'
  | 'duplicate-credential'
  | 'credential-changed'
  | 'duplicate-role-code'
  | 'duplicate-role-permission'
  | 'duplicate-role-assignment';

export class RecordConflictError extends Error {
  override readonly name = 'RecordConflictError';

  constructor(readonly reason: RecordConflictReason) {
    super(`Operação recusada por conflito: ${reason}.`);
  }
}

/**
 * Violação de uma regra dos contratos de autorização (E1.07-D1): catálogo de permissões, concessões
 * a perfis e atribuições. Não é uma decisão de autorização nem deve chegar a consumidores externos.
 */
export type AuthorizationContractErrorReason =
  | 'duplicate-permission'
  | 'invalid-catalog-version'
  /** Catálogo sem proveniência reconhecida (estrutura fabricada, cópia ou clone; E1.07-D1-R1). */
  | 'untrusted-catalog'
  /** Catálogo reconhecido mas experimental, onde só o oficial é admissível (E1.07-D1-R1). */
  | 'catalog-not-official'
  | 'unknown-permission'
  | 'permission-unavailable'
  | 'permission-authority-incompatible'
  | 'role-inactive'
  | 'membership-inactive'
  | 'branch-inactive'
  | 'assignment-scope-exceeds-membership';

export class AuthorizationContractError extends Error {
  override readonly name = 'AuthorizationContractError';

  constructor(readonly reason: AuthorizationContractErrorReason) {
    super(`Regra de autorização violada: ${reason}.`);
  }
}
