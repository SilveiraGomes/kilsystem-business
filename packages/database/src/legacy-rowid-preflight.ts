import type { SqliteDatabase } from './connection.js';
import { PersistenceError } from './errors.js';

/**
 * As dez tabelas cujas inserções a migração 7 guarda por `rowid` (D-196). Depois da 7, uma destas
 * tabelas que só tenha `rowid` não positivos, escritos por SQL directo antes da 7, deixa de aceitar
 * inserções (PD-76, RV-D2-R4-02).
 */
export const ROWID_GUARDED_TABLES = Object.freeze([
  'companies',
  'branches',
  'users',
  'password_credentials',
  'local_sessions',
  'company_memberships',
  'branch_memberships',
  'roles',
  'role_permissions',
  'role_assignments',
] as const);

export type RowidGuardedTable = (typeof ROWID_GUARDED_TABLES)[number];

export interface NonPositiveRowidFinding {
  readonly table: RowidGuardedTable;
  readonly rows: number;
}

/** Recusa da actualização de uma base com `rowid` legados não positivos; nunca os renumera. */
export class NonPositiveRowidError extends PersistenceError {
  constructor(readonly findings: readonly NonPositiveRowidFinding[]) {
    super('legacy-nonpositive-rowid');
  }
}

const TABLE_EXISTS = "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?";

/**
 * Conta, só por leitura, as linhas com `rowid <= 0` em cada tabela guardada que exista na base.
 * As tabelas ainda não criadas são ignoradas. Não altera nem renumera nada.
 */
export const findNonPositiveRowids = (database: SqliteDatabase): readonly NonPositiveRowidFinding[] => {
  const exists = database.prepare(TABLE_EXISTS);
  const findings: NonPositiveRowidFinding[] = [];
  for (const table of ROWID_GUARDED_TABLES) {
    if (exists.get(table) === undefined) continue;
    // `table` vem só da lista fixa acima; nunca de uma entrada externa.
    const rows = database.prepare(`SELECT count(*) FROM "${table}" WHERE rowid <= 0`).pluck().get();
    if (typeof rows !== 'number' || !Number.isSafeInteger(rows)) throw new PersistenceError('invalid-stored-record');
    if (rows > 0) findings.push(Object.freeze({ rows, table }));
  }
  return Object.freeze(findings);
};

/**
 * Pré-verificação obrigatória antes de aplicar migrações a uma base existente (PD-76, E1.07-D3-G0):
 * recusa (`NonPositiveRowidError`, com as tabelas e contagens, sem valores) quando alguma tabela
 * guardada tem `rowid` não positivos. Não corrige nem renumera dados.
 */
export const assertNoNonPositiveRowids = (database: SqliteDatabase): void => {
  const findings = findNonPositiveRowids(database);
  if (findings.length > 0) throw new NonPositiveRowidError(findings);
};
