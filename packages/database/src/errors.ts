// As mensagens não reproduzem SQL, valores nem caminhos; a causa original fica em `cause`.

export type PersistenceErrorReason =
  | 'async-transaction'
  | 'constraint'
  | 'foreign-keys-disabled'
  | 'invalid-stored-record'
  | 'location-inside-protected-directory'
  | 'location-invalid-extension'
  | 'location-not-absolute'
  | 'location-not-configured'
  | 'migration-checksum-mismatch'
  | 'migration-sequence-invalid'
  | 'sqlite'
  | 'transaction-closed'
  | 'unknown-schema-version';

export class PersistenceError extends Error {
  override readonly name = 'PersistenceError';

  constructor(
    readonly reason: PersistenceErrorReason,
    options?: { readonly cause?: unknown },
  ) {
    super(`Falha de persistência: ${reason}.`, options);
  }
}
