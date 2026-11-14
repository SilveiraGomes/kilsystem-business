import { createHash } from 'node:crypto';

import type { SqliteDatabase } from './connection.js';
import { PersistenceError } from './errors.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  /** Imutável depois de publicada: alterações exigem uma nova migração. */
  readonly sql: string;
}

export interface MigrationResult {
  readonly applied: readonly number[];
  readonly currentVersion: number;
}

const V1_COMPANIES_AND_BRANCHES = `
CREATE TABLE sector_types (
  code TEXT PRIMARY KEY NOT NULL
) STRICT;

INSERT INTO sector_types (code) VALUES ('PHARMACY'), ('SUPERMARKET'), ('FUEL_STATION'), ('RESTAURANT');

CREATE TABLE companies (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  jurisdiction TEXT NOT NULL CHECK (length(jurisdiction) = 2 AND jurisdiction = upper(jurisdiction)),
  legal_name TEXT NOT NULL CHECK (length(trim(legal_name)) > 0),
  trade_name TEXT CHECK (trade_name IS NULL OR length(trim(trade_name)) > 0),
  nif TEXT CHECK (nif IS NULL OR length(trim(nif)) > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT companies_tenant_unique UNIQUE (tenant_id),
  CONSTRAINT companies_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT companies_id_distinct_from_tenant CHECK (id <> tenant_id),
  CONSTRAINT companies_active_requires_nif CHECK (status <> 'ACTIVE' OR nif IS NOT NULL),
  CONSTRAINT companies_chronology CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE branches (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  code TEXT NOT NULL CHECK (length(code) > 0 AND code = upper(code)),
  sector_type TEXT NOT NULL REFERENCES sector_types (code) ON UPDATE RESTRICT ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT branches_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES companies (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT branches_code_unique_per_company UNIQUE (company_id, code),
  CONSTRAINT branches_chronology CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX branches_tenant_company_idx ON branches (tenant_id, company_id);
`;

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({ name: 'create_companies_and_branches', sql: V1_COMPANIES_AND_BRANCHES, version: 1 }),
]);

export const migrationChecksum = (migration: Migration): string =>
  createHash('sha256').update(migration.sql, 'utf8').digest('hex');

interface AppliedMigration {
  readonly version: number;
  readonly checksum: string;
}

const readApplied = (database: SqliteDatabase): readonly AppliedMigration[] =>
  database
    .prepare('SELECT version, checksum FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => {
      if (
        typeof row !== 'object' ||
        row === null ||
        !('version' in row) ||
        !('checksum' in row) ||
        typeof row.version !== 'number' ||
        typeof row.checksum !== 'string'
      ) {
        throw new PersistenceError('invalid-stored-record');
      }
      return { checksum: row.checksum, version: row.version };
    });

const assertSequence = (migrations: readonly Migration[]): void => {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) throw new PersistenceError('migration-sequence-invalid');
  });
};

export interface MigrationStatus {
  /** Versões aplicadas, já verificadas contra as migrações conhecidas. */
  readonly appliedVersions: readonly number[];
  readonly pendingVersions: readonly number[];
  readonly targetVersion: number;
}

/**
 * Verifica o estado das migrações sem alterar a base. Recusa bases com migrações alteradas
 * (`migration-checksum-mismatch`) ou de versão superior (`unknown-schema-version`).
 */
export const inspectMigrations = (
  database: SqliteDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationStatus => {
  assertSequence(migrations);
  const tracked =
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get() !==
    undefined;
  const applied = tracked ? readApplied(database) : [];
  for (const record of applied) {
    const known = migrations.find((migration) => migration.version === record.version);
    if (known === undefined) throw new PersistenceError('unknown-schema-version');
    if (migrationChecksum(known) !== record.checksum) {
      throw new PersistenceError('migration-checksum-mismatch');
    }
  }

  const appliedVersions = applied.map((record) => record.version);
  const appliedSet = new Set(appliedVersions);
  return {
    appliedVersions,
    pendingVersions: migrations
      .filter((migration) => !appliedSet.has(migration.version))
      .map((migration) => migration.version),
    targetVersion: migrations.length,
  };
};

/**
 * Aplica as migrações pendentes, cada uma na sua transacção. É seguro reexecutar: migrações
 * aplicadas são ignoradas, mas a respectiva soma de verificação tem de coincidir.
 */
export const runMigrations = (
  database: SqliteDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
): MigrationResult => {
  assertSequence(migrations);
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);

  const { pendingVersions } = inspectMigrations(database, migrations);
  const pending = new Set(pendingVersions);
  const register = database.prepare(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );
  const appliedNow: number[] = [];
  for (const migration of migrations) {
    if (!pending.has(migration.version)) continue;
    database
      .transaction(() => {
        database.exec(migration.sql);
        register.run(migration.version, migration.name, migrationChecksum(migration), new Date().toISOString());
      })
      .immediate();
    appliedNow.push(migration.version);
  }

  return { applied: appliedNow, currentVersion: migrations.length };
};
