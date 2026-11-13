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

export type RecordKind = 'Company' | 'Branch';

export class RecordNotFoundError extends Error {
  override readonly name = 'RecordNotFoundError';

  constructor(readonly kind: RecordKind) {
    super(`Registo '${kind}' não encontrado no contexto empresarial.`);
  }
}

export type RecordConflictReason =
  | 'duplicate-id'
  | 'tenant-already-has-company'
  | 'company-has-branches';

export class RecordConflictError extends Error {
  override readonly name = 'RecordConflictError';

  constructor(readonly reason: RecordConflictReason) {
    super(`Operação recusada por conflito: ${reason}.`);
  }
}
