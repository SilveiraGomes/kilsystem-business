import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createSqliteAuthenticationStore,
  createSqliteMembershipPersistence,
  createSqliteTenantPersistence,
  createSqliteUserDirectory,
  inspectMigrations,
  MIGRATIONS,
  migrationChecksum,
  runMigrations,
  type SqliteDatabase,
} from '../packages/database/src/index';
import {
  createBranch,
  deactivateBranch,
  deactivateCompany,
  type Branch,
  type BranchMembership,
  type Company,
  type CompanyMembership,
  type User,
} from '../packages/shared-types/src/index';
import { branchInput, contextFor, CREATED_AT, newCompany, newId, UPDATED_AT } from './support/fixtures';
import { newBranchMembership, newCompanyMembership, newUser } from './support/identity-fixtures';
import { createServiceUnderTest, inspectDatabase, serviceConfig, type ServiceUnderTest } from './support/local-service-harness';
import { stopServicesThenDisposeNow } from './support/service-cleanup';
import { createTemporaryDatabase, type TemporaryDatabase } from './support/sqlite-harness';

/*
 * E1.07-D3-PD78-C1 — migração 10: identidades empresariais permanentes (PD-78; D-222, D-253).
 * Empresas, estabelecimentos e sectores nunca são eliminados nem substituídos; o código de um
 * estabelecimento nunca é tomado por outro; o sector de um estabelecimento é imutável. SQLite real,
 * bases descartáveis, dados fictícios, nas quatro combinações de foreign_keys/recursive_triggers.
 * E1.07-PD89: estabelecimentos inactivos, sector alterado com o estado e soma publicada da migração 10.
 */

/** Soma publicada da migração 10 (`main` = `70f6fa2`, D-255): SHA-256 do SQL aplicado e registado (PD-89). */
const PUBLISHED_CHECKSUM_10 = '63056894ac6173e4b251b55668cafacbfa1b3f56e4da6bc54eb21aecffd4bf43';

/** Somas publicadas das migrações 1 a 9 (`main` = `39a06a7`); a migração 10 não as altera. */
const PUBLISHED_CHECKSUMS_1_TO_9 = [
  'c70164d253bed3637177a1a434282a3fb9e4d16c294134dd2f6ec61dbf734b61',
  'b05636332e82baa7250873473b7c91fd0a571ec07e2b90b7ee2d236fd9bfc2d0',
  '340d886e73aae09527f46db3e3dbecfa9afc7b9fafa126e0267cea9d1d1a1f53',
  '95e09724388a7dce7e6c5588a55f3c35ee98f7a7202356885720dd7d1cdedf6e',
  'd404e58df245f3a42ed9970be395b0ae90cc7b8d0c08cdcb14d5da871823b7a4',
  'f7bf395b5827dfb64a4b2c661416b77e3dfc168c0276d6509315d174f5b3d09f',
  'a6dd64de16b2734d15be2a4714b9e6d7bb0eea9ad66a352b38eecdb758e59f7d',
  'b152678abefadee615ad90dfd487fe2e9ded8ac1e3ba7db69d332d16815d7e3f',
  'cb70c62866e74c94fab0275d21c33b4601adca6eccad5bed14bfa55c173fc779',
];

const MIGRATION_10_TRIGGERS = [
  'branches_code_never_taken_over',
  'branches_never_deleted',
  'branches_sector_immutable',
  'companies_never_deleted',
  'sector_types_immutable',
  'sector_types_insert_requires_new_sector',
  'sector_types_never_deleted',
  'sector_types_rowid_positive',
];

const MIGRATED_TO_9 = MIGRATIONS.slice(0, 9);

const CONFIGURATIONS = [
  { foreignKeys: true, label: 'foreign_keys ON, recursive_triggers OFF', recursiveTriggers: false },
  { foreignKeys: false, label: 'foreign_keys OFF, recursive_triggers OFF', recursiveTriggers: false },
  { foreignKeys: true, label: 'foreign_keys ON, recursive_triggers ON', recursiveTriggers: true },
  { foreignKeys: false, label: 'foreign_keys OFF, recursive_triggers ON', recursiveTriggers: true },
] as const;

type Configuration = (typeof CONFIGURATIONS)[number];

const applyPragmas = (database: SqliteDatabase, { foreignKeys, recursiveTriggers }: Configuration): void => {
  database.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  database.pragma(`recursive_triggers = ${recursiveTriggers ? 'ON' : 'OFF'}`);
  expect(database.pragma('foreign_keys', { simple: true })).toBe(foreignKeys ? 1 : 0);
  expect(database.pragma('recursive_triggers', { simple: true })).toBe(recursiveTriggers ? 1 : 0);
};

const SNAPSHOT_TABLES = [
  'sector_types',
  'companies',
  'branches',
  'users',
  'password_credentials',
  'local_sessions',
  'company_memberships',
  'branch_memberships',
] as const;

const snapshot = (database: SqliteDatabase): Record<string, unknown[]> =>
  Object.fromEntries(
    SNAPSHOT_TABLES.map((table) => [table, database.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all()]),
  );

const triggerNames = (database: SqliteDatabase): unknown[] =>
  database.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name").pluck().all();

const rowidOf = (database: SqliteDatabase, table: string, where: string, value: string): number =>
  database.prepare(`SELECT rowid FROM ${table} WHERE ${where} = ?`).pluck().get(value) as number;

interface Seed {
  /** ACTIVE, com dois estabelecimentos e uma associação. */
  readonly company: Company;
  /** DRAFT, sem estabelecimentos nem associações (sem linhas filhas). */
  readonly draft: Company;
  /** ACTIVE, de outro tenant, com um estabelecimento de código `X1`. */
  readonly other: Company;
  /** Código `N`, sector PHARMACY, com associação local. */
  readonly north: Branch;
  /** Código `S`, sector RESTAURANT, sem linhas filhas. */
  readonly south: Branch;
  readonly otherBranch: Branch;
  readonly user: User;
  readonly membership: CompanyMembership;
  readonly local: BranchMembership;
  readonly sessionId: string;
}

/** Estado típico, escrito pelos repositórios como a aplicação; sem dados reais. */
const seed = async (database: SqliteDatabase): Promise<Seed> => {
  const tenant = createSqliteTenantPersistence(database);
  const memberships = createSqliteMembershipPersistence(database);
  const company = newCompany({ legalName: 'Empresa Norte, Lda.' });
  const draft = newCompany({ legalName: 'Rascunho, Lda.', nif: undefined, status: 'DRAFT' });
  const other = newCompany({ legalName: 'Outra Empresa, Lda.' });
  for (const each of [company, draft, other]) await tenant.companies.create(contextFor(each.tenantId), each);
  const context = contextFor(company.tenantId);
  const north = createBranch(branchInput(company, { code: 'N', name: 'Farmácia Norte', sectorType: 'PHARMACY' }));
  const south = createBranch(branchInput(company, { code: 'S', name: 'Restaurante Sul', sectorType: 'RESTAURANT' }));
  const otherBranch = createBranch(branchInput(other, { code: 'X1', sectorType: 'SUPERMARKET' }));
  await tenant.branches.create(context, north);
  await tenant.branches.create(context, south);
  await tenant.branches.create(contextFor(other.tenantId), otherBranch);

  const user = newUser();
  await createSqliteUserDirectory(database).create(user);
  createSqliteAuthenticationStore(database).insertCredential({
    algorithm: 'argon2id',
    algorithmVersion: 19,
    createdAt: user.createdAt,
    hash: randomBytes(32),
    memoryKiB: 19456,
    parallelism: 1,
    passes: 2,
    salt: randomBytes(16),
    updatedAt: user.createdAt,
    userId: user.id,
  });
  const sessionId = randomUUID();
  database
    .prepare(
      `INSERT INTO local_sessions (id, user_id, token_digest, security_version, credential_version, service_run_id,
         created_at, last_activity_at, absolute_expires_at) VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?)`,
    )
    .run(sessionId, user.id, randomBytes(32), randomBytes(16).toString('hex'), CREATED_AT, CREATED_AT, UPDATED_AT);
  const membership = newCompanyMembership(user, company, { scope: 'BRANCH_RESTRICTED' });
  await memberships.companyMemberships.create(context, membership);
  const local = newBranchMembership(membership, north);
  await memberships.branchMemberships.create(context, local);
  return { company, draft, local, membership, north, other, otherBranch, sessionId, south, user };
};

const companyRow = (id: string, tenantId: string, legalName = 'Impostora, Lda.'): string =>
  `INSERT INTO companies (id, tenant_id, jurisdiction, legal_name, trade_name, nif, status, created_at, updated_at)
   VALUES ('${id}', '${tenantId}', 'PT', '${legalName}', NULL, NULL, 'DRAFT', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`;

const branchRow = (id: string, company: Company, code: string, sector = 'FUEL_STATION'): string =>
  `INSERT INTO branches (id, tenant_id, company_id, name, code, sector_type, status, created_at, updated_at)
   VALUES ('${id}', '${company.tenantId}', '${company.id}', 'Impostor', '${code}', '${sector}', 'ACTIVE',
     '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`;

const COMPANY_NEVER_DELETED = /constraint failed: companies are deactivated, never deleted/;
const BRANCH_NEVER_DELETED = /constraint failed: branches are deactivated, never deleted/;
const CODE_TAKEN = /constraint failed: branches code belongs to another branch/;
const BRANCH_SECTOR = /constraint failed: branches sector is immutable/;
const SECTOR_NEVER_DELETED = /constraint failed: sector_types are never deleted/;
const SECTOR_IMMUTABLE = /constraint failed: sector_types are immutable/;
const SECTOR_REINSERTED = /constraint failed: sector_types are never re-inserted/;
const SECTOR_ROWID = /constraint failed: sector_types rowid must be positive/;
// Já impostos pela migração 7 e preservados.
const COMPANY_REINSERTED = /constraint failed: companies are never re-inserted/;
const COMPANY_IDENTITY = /constraint failed: companies rowid, id, tenant and creation are immutable/;
const BRANCH_REINSERTED = /constraint failed: branches are never re-inserted/;
const BRANCH_IDENTITY = /constraint failed: branches rowid, id, tenant, company and creation are immutable/;

type Attack = readonly [label: string, sql: string, refusal: RegExp];

/**
 * Tentativas de eliminação, reutilização, substituição destrutiva e alteração de identidade por SQL
 * directo (ligação normal, actor E de D-209). Cada uma tem a recusa esperada a partir da migração 10.
 */
const attacks = (database: SqliteDatabase, s: Seed): readonly Attack[] => {
  const fuelRowid = rowidOf(database, 'sector_types', 'code', 'FUEL_STATION');
  const pharmacyRowid = rowidOf(database, 'sector_types', 'code', 'PHARMACY');
  const draftRowid = rowidOf(database, 'companies', 'id', s.draft.id);
  const southRowid = rowidOf(database, 'branches', 'id', s.south.id);
  return [
    // Empresas
    ['DELETE childless company', `DELETE FROM companies WHERE id = '${s.draft.id}'`, COMPANY_NEVER_DELETED],
    ['DELETE company with branches and memberships', `DELETE FROM companies WHERE id = '${s.company.id}'`, COMPANY_NEVER_DELETED],
    ['DELETE every company', 'DELETE FROM companies', COMPANY_NEVER_DELETED],
    [
      'DELETE + INSERT childless company with the same id and tenant',
      `DELETE FROM companies WHERE id = '${s.draft.id}'; ${companyRow(s.draft.id, s.draft.tenantId)}`,
      COMPANY_NEVER_DELETED,
    ],
    ['INSERT company with an existing id', companyRow(s.draft.id, newId()), COMPANY_REINSERTED],
    ['INSERT company with an existing tenant', companyRow(newId(), s.draft.tenantId), COMPANY_REINSERTED],
    ['INSERT OR REPLACE company with an existing id', companyRow(s.draft.id, newId()).replace('INSERT', 'INSERT OR REPLACE'), COMPANY_REINSERTED],
    ['REPLACE INTO company with an existing tenant', companyRow(newId(), s.company.tenantId).replace('INSERT', 'REPLACE'), COMPANY_REINSERTED],
    [
      'INSERT OR REPLACE company with an existing rowid',
      `INSERT OR REPLACE INTO companies (rowid, id, tenant_id, jurisdiction, legal_name, status, created_at, updated_at)
       VALUES (${draftRowid}, '${newId()}', '${newId()}', 'PT', 'Impostora', 'DRAFT', '${CREATED_AT}', '${CREATED_AT}')`,
      COMPANY_REINSERTED,
    ],
    [
      'UPSERT company on its id',
      `${companyRow(s.draft.id, s.draft.tenantId)} ON CONFLICT (id) DO UPDATE SET legal_name = 'Impostora'`,
      COMPANY_REINSERTED,
    ],
    ['UPSERT company on its tenant, DO NOTHING', `${companyRow(newId(), s.draft.tenantId)} ON CONFLICT (tenant_id) DO NOTHING`, COMPANY_REINSERTED],
    ['UPDATE OR REPLACE company id', `UPDATE OR REPLACE companies SET id = '${s.draft.id}' WHERE id = '${s.company.id}'`, COMPANY_IDENTITY],
    [
      'UPDATE OR REPLACE company tenant',
      `UPDATE OR REPLACE companies SET tenant_id = '${s.draft.tenantId}' WHERE id = '${s.company.id}'`,
      COMPANY_IDENTITY,
    ],
    ['UPDATE OR REPLACE company rowid', `UPDATE OR REPLACE companies SET rowid = ${draftRowid} WHERE id = '${s.company.id}'`, COMPANY_IDENTITY],
    // Estabelecimentos
    ['DELETE childless branch', `DELETE FROM branches WHERE id = '${s.south.id}'`, BRANCH_NEVER_DELETED],
    ['DELETE branch with a local membership', `DELETE FROM branches WHERE id = '${s.north.id}'`, BRANCH_NEVER_DELETED],
    ['DELETE every branch', 'DELETE FROM branches', BRANCH_NEVER_DELETED],
    [
      'DELETE + INSERT childless branch with the same id, another code and sector',
      `DELETE FROM branches WHERE id = '${s.south.id}'; ${branchRow(s.south.id, s.company, 'Q')}`,
      BRANCH_NEVER_DELETED,
    ],
    ['INSERT branch with an existing id in another tenant', branchRow(s.north.id, s.other, 'Q'), BRANCH_REINSERTED],
    ['INSERT OR REPLACE branch with an existing id', branchRow(s.south.id, s.company, 'Q').replace('INSERT', 'INSERT OR REPLACE'), BRANCH_REINSERTED],
    ['INSERT OR REPLACE branch taking an existing code', branchRow(newId(), s.company, 'S').replace('INSERT', 'INSERT OR REPLACE'), BRANCH_REINSERTED],
    ['REPLACE INTO branch taking a code with dependants', branchRow(newId(), s.company, 'N').replace('INSERT', 'REPLACE'), BRANCH_REINSERTED],
    [
      'INSERT OR REPLACE branch with an existing rowid',
      `INSERT OR REPLACE INTO branches (rowid, id, tenant_id, company_id, name, code, sector_type, status, created_at, updated_at)
       VALUES (${southRowid}, '${newId()}', '${s.company.tenantId}', '${s.company.id}', 'Impostor', 'Q', 'FUEL_STATION', 'ACTIVE',
         '${CREATED_AT}', '${CREATED_AT}')`,
      BRANCH_REINSERTED,
    ],
    [
      'UPSERT branch on (company, code)',
      `${branchRow(newId(), s.company, 'S')} ON CONFLICT (company_id, code) DO UPDATE SET name = 'Impostor'`,
      BRANCH_REINSERTED,
    ],
    ['UPDATE OR REPLACE code takeover of a childless sibling', `UPDATE OR REPLACE branches SET code = 'S' WHERE id = '${s.north.id}'`, CODE_TAKEN],
    ['UPDATE OR REPLACE code takeover of a sibling with dependants', `UPDATE OR REPLACE branches SET code = 'N' WHERE id = '${s.south.id}'`, CODE_TAKEN],
    [
      'UPDATE OR REPLACE code takeover together with the name',
      `UPDATE OR REPLACE branches SET name = 'Outro', code = 'S' WHERE id = '${s.north.id}'`,
      CODE_TAKEN,
    ],
    ['UPDATE OR REPLACE code takeover through a sub-query', `UPDATE OR REPLACE branches SET code = (SELECT 'S') WHERE id = '${s.north.id}'`, CODE_TAKEN],
    ['UPDATE OR REPLACE one code for every branch of a company', `UPDATE OR REPLACE branches SET code = 'Z' WHERE company_id = '${s.company.id}'`, CODE_TAKEN],
    ['UPDATE code to a sibling code (default ABORT)', `UPDATE branches SET code = 'S' WHERE id = '${s.north.id}'`, CODE_TAKEN],
    ['UPDATE OR REPLACE branch company', `UPDATE OR REPLACE branches SET company_id = '${s.other.id}' WHERE id = '${s.south.id}'`, BRANCH_IDENTITY],
    ['UPDATE OR REPLACE branch rowid', `UPDATE OR REPLACE branches SET rowid = ${southRowid} WHERE id = '${s.north.id}'`, BRANCH_IDENTITY],
    ['UPDATE branch sector', `UPDATE branches SET sector_type = 'SUPERMARKET' WHERE id = '${s.north.id}'`, BRANCH_SECTOR],
    ['UPDATE OR REPLACE branch sector', `UPDATE OR REPLACE branches SET sector_type = 'FUEL_STATION' WHERE id = '${s.south.id}'`, BRANCH_SECTOR],
    ['UPDATE branch sector to an unknown sector', `UPDATE branches SET sector_type = 'CASINO' WHERE id = '${s.south.id}'`, BRANCH_SECTOR],
    // Sectores
    ['DELETE unreferenced sector', "DELETE FROM sector_types WHERE code = 'FUEL_STATION'", SECTOR_NEVER_DELETED],
    ['DELETE referenced sector', "DELETE FROM sector_types WHERE code = 'PHARMACY'", SECTOR_NEVER_DELETED],
    ['DELETE every sector', 'DELETE FROM sector_types', SECTOR_NEVER_DELETED],
    ['UPDATE unreferenced sector code', "UPDATE sector_types SET code = 'FUEL' WHERE code = 'FUEL_STATION'", SECTOR_IMMUTABLE],
    ['UPDATE referenced sector code', "UPDATE sector_types SET code = 'PHARMACY_2' WHERE code = 'PHARMACY'", SECTOR_IMMUTABLE],
    ['UPDATE OR REPLACE sector code onto another sector', "UPDATE OR REPLACE sector_types SET code = 'PHARMACY' WHERE code = 'FUEL_STATION'", SECTOR_IMMUTABLE],
    ['UPDATE sector rowid', `UPDATE sector_types SET rowid = 99 WHERE rowid = ${fuelRowid}`, SECTOR_IMMUTABLE],
    ['INSERT OR REPLACE an unreferenced sector', "INSERT OR REPLACE INTO sector_types (code) VALUES ('FUEL_STATION')", SECTOR_REINSERTED],
    ['REPLACE INTO a referenced sector', "REPLACE INTO sector_types (code) VALUES ('PHARMACY')", SECTOR_REINSERTED],
    [
      'INSERT OR REPLACE a new sector on the rowid of an unreferenced sector',
      `INSERT OR REPLACE INTO sector_types (rowid, code) VALUES (${fuelRowid}, 'NEW_SECTOR')`,
      SECTOR_REINSERTED,
    ],
    [
      'INSERT OR REPLACE a new sector on the rowid of a referenced sector',
      `INSERT OR REPLACE INTO sector_types (rowid, code) VALUES (${pharmacyRowid}, 'NEW_SECTOR')`,
      SECTOR_REINSERTED,
    ],
    ['INSERT a sector with a negative rowid', "INSERT INTO sector_types (rowid, code) VALUES (-5, 'NEW_SECTOR')", SECTOR_ROWID],
    ['INSERT OR REPLACE a sector with rowid 0', "INSERT OR REPLACE INTO sector_types (rowid, code) VALUES (0, 'NEW_SECTOR')", SECTOR_ROWID],
    ['UPSERT an existing sector, DO NOTHING', "INSERT INTO sector_types (code) VALUES ('PHARMACY') ON CONFLICT (code) DO NOTHING", SECTOR_REINSERTED],
  ];
};

/** Aceites na migração 9 (cabeça publicada) em qualquer configuração: o que a migração 10 fecha. */
const ACCEPTED_AT_9_ALWAYS = [
  'DELETE childless company',
  'DELETE + INSERT childless company with the same id and tenant',
  'DELETE childless branch',
  'DELETE + INSERT childless branch with the same id, another code and sector',
  'UPDATE OR REPLACE code takeover of a childless sibling',
  'UPDATE OR REPLACE code takeover together with the name',
  'UPDATE OR REPLACE code takeover through a sub-query',
  'UPDATE branch sector',
  'UPDATE OR REPLACE branch sector',
  'DELETE unreferenced sector',
  'UPDATE unreferenced sector code',
  'UPDATE sector rowid',
  'INSERT OR REPLACE an unreferenced sector',
  'INSERT OR REPLACE a new sector on the rowid of an unreferenced sector',
  'INSERT a sector with a negative rowid',
  'INSERT OR REPLACE a sector with rowid 0',
  'UPSERT an existing sector, DO NOTHING',
];

/** Aceites na migração 9 só com foreign_keys desligado (deixam referências pendentes). */
const ACCEPTED_AT_9_WITHOUT_FOREIGN_KEYS = [
  'DELETE company with branches and memberships',
  'DELETE every company',
  'DELETE branch with a local membership',
  'DELETE every branch',
  'UPDATE OR REPLACE code takeover of a sibling with dependants',
  'UPDATE OR REPLACE one code for every branch of a company',
  'UPDATE branch sector to an unknown sector',
  'DELETE referenced sector',
  'DELETE every sector',
  'UPDATE referenced sector code',
  'UPDATE OR REPLACE sector code onto another sector',
  'REPLACE INTO a referenced sector',
  'INSERT OR REPLACE a new sector on the rowid of a referenced sector',
];

const CONFLICT_CLAUSES = ['ABORT', 'FAIL', 'IGNORE', 'REPLACE'] as const;

/** Instruções com cláusula de conflito explícita; `RAISE(ABORT)` prevalece sobre qualquer cláusula. */
const conflictAttacks = (s: Seed): readonly (readonly [string, (clause: string) => string, RegExp])[] => [
  ['INSERT company with an existing id', (c) => companyRow(s.draft.id, newId()).replace('INSERT', `INSERT OR ${c}`), COMPANY_REINSERTED],
  ['INSERT branch taking an existing code', (c) => branchRow(newId(), s.company, 'S').replace('INSERT', `INSERT OR ${c}`), BRANCH_REINSERTED],
  ['UPDATE branch code to a sibling code', (c) => `UPDATE OR ${c} branches SET code = 'S' WHERE id = '${s.north.id}'`, CODE_TAKEN],
  [
    'UPDATE every branch of a company to one code (second row collides)',
    (c) => `UPDATE OR ${c} branches SET code = 'Z' WHERE company_id = '${s.company.id}'`,
    CODE_TAKEN,
  ],
  ['UPDATE branch sector', (c) => `UPDATE OR ${c} branches SET sector_type = 'SUPERMARKET' WHERE id = '${s.north.id}'`, BRANCH_SECTOR],
  ['INSERT an existing sector', (c) => `INSERT OR ${c} INTO sector_types (code) VALUES ('PHARMACY')`, SECTOR_REINSERTED],
  ['INSERT a sector on an existing rowid', (c) => `INSERT OR ${c} INTO sector_types (rowid, code) VALUES (1, 'NEW_SECTOR')`, SECTOR_REINSERTED],
  ['UPDATE a sector code', (c) => `UPDATE OR ${c} sector_types SET code = 'PHARMACY' WHERE code = 'FUEL_STATION'`, SECTOR_IMMUTABLE],
];

type Legitimate = readonly [label: string, change: (database: SqliteDatabase) => void];

const branch = (database: SqliteDatabase, id: string): Record<string, unknown> =>
  database.prepare('SELECT code, name, sector_type, status, updated_at FROM branches WHERE id = ?').get(id) as Record<string, unknown>;
const company = (database: SqliteDatabase, id: string): Record<string, unknown> =>
  database.prepare('SELECT jurisdiction, legal_name, nif, status, updated_at FROM companies WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;

/** Alterações de campos que não são identidades protegidas: continuam aceites (S05, L5–L8). */
const legitimateChanges = (s: Seed): readonly Legitimate[] => [
  [
    'code to a free code (UPDATE)',
    (database) => {
      database.exec(`UPDATE branches SET code = 'Z' WHERE id = '${s.south.id}'`);
      expect(branch(database, s.south.id)).toMatchObject({ code: 'Z' });
    },
  ],
  [
    'code to a free code (UPDATE OR REPLACE)',
    (database) => {
      database.exec(`UPDATE OR REPLACE branches SET code = 'Z' WHERE id = '${s.south.id}'`);
      expect(branch(database, s.south.id)).toMatchObject({ code: 'Z' });
    },
  ],
  [
    'L5 code already used by a branch of another company',
    (database) => {
      database.exec(`UPDATE branches SET code = 'X1' WHERE id = '${s.south.id}'`);
      expect(branch(database, s.south.id)).toMatchObject({ code: 'X1' });
      expect(branch(database, s.otherBranch.id)).toMatchObject({ code: 'X1' });
    },
  ],
  [
    'L6 code to its own value',
    (database) => {
      database.exec(`UPDATE OR REPLACE branches SET code = 'S' WHERE id = '${s.south.id}'`);
      database.exec(`UPDATE branches SET code = code, sector_type = sector_type WHERE company_id = '${s.company.id}'`);
      expect(branch(database, s.south.id)).toMatchObject({ code: 'S', sector_type: 'RESTAURANT' });
    },
  ],
  [
    'L7 codes swapped through a temporary value',
    (database) => {
      database.exec(`UPDATE branches SET code = 'TMP' WHERE id = '${s.north.id}'`);
      database.exec(`UPDATE branches SET code = 'N' WHERE id = '${s.south.id}'`);
      database.exec(`UPDATE branches SET code = 'S' WHERE id = '${s.north.id}'`);
      expect([branch(database, s.north.id)['code'], branch(database, s.south.id)['code']]).toEqual(['S', 'N']);
    },
  ],
  [
    'L8 a freed code taken by a sibling (DP-PD78-03, code is not an identity)',
    (database) => {
      database.exec(`UPDATE branches SET code = 'N2' WHERE id = '${s.north.id}'`);
      database.exec(`UPDATE branches SET code = 'N' WHERE id = '${s.south.id}'`);
      expect(branch(database, s.south.id)).toMatchObject({ code: 'N' });
    },
  ],
  [
    'branch name, status and update time, with the sector rewritten unchanged (repository shape)',
    (database) => {
      database.exec(`UPDATE branches SET name = 'Farmácia Central', code = 'N', sector_type = 'PHARMACY', status = 'INACTIVE',
        updated_at = '${UPDATED_AT}' WHERE id = '${s.north.id}'`);
      expect(branch(database, s.north.id)).toEqual({
        code: 'N',
        name: 'Farmácia Central',
        sector_type: 'PHARMACY',
        status: 'INACTIVE',
        updated_at: UPDATED_AT,
      });
      database.exec(`UPDATE branches SET status = 'ACTIVE' WHERE id = '${s.north.id}'`);
      expect(branch(database, s.north.id)).toMatchObject({ status: 'ACTIVE' });
    },
  ],
  [
    'company suspended with a new name',
    (database) => {
      database.exec(`UPDATE companies SET status = 'SUSPENDED', legal_name = 'Empresa Renomeada, Lda.' WHERE id = '${s.company.id}'`);
      expect(company(database, s.company.id)).toMatchObject({ legal_name: 'Empresa Renomeada, Lda.', status: 'SUSPENDED' });
    },
  ],
  [
    'company and draft jurisdiction (DP-PD78-05 is not part of migration 10)',
    (database) => {
      database.exec(`UPDATE companies SET jurisdiction = 'PT' WHERE id IN ('${s.company.id}', '${s.draft.id}')`);
      expect([company(database, s.company.id)['jurisdiction'], company(database, s.draft.id)['jurisdiction']]).toEqual(['PT', 'PT']);
    },
  ],
  [
    'new company, new branch and a draft activated',
    (database) => {
      const fresh = newCompany();
      database.exec(companyRow(fresh.id, fresh.tenantId, 'Nova, Lda.'));
      database.exec(branchRow(newId(), s.company, 'NOVO', 'SUPERMARKET'));
      database.exec(`UPDATE companies SET status = 'ACTIVE', nif = 'NIF-TESTE-0009' WHERE id = '${s.draft.id}'`);
      expect(database.prepare('SELECT count(*) FROM companies').pluck().get()).toBe(4);
      expect(database.prepare('SELECT count(*) FROM branches').pluck().get()).toBe(4);
    },
  ],
  [
    'a new sector by direct SQL (boundary D-209, not a schema guarantee of DP-PD78-14)',
    (database) => {
      database.exec("INSERT INTO sector_types (code) VALUES ('NEW_SECTOR')");
      expect(database.prepare('SELECT count(*) FROM sector_types').pluck().get()).toBe(5);
    },
  ],
];

interface InactiveSeed extends Seed {
  /** Código `E`, sector SUPERMARKET, ACTIVE, sem linhas filhas; `north` e `south` ficam INACTIVE. */
  readonly east: Branch;
}

/** PD-89 (RV-PD78C1M-01): o mesmo estado, com dois estabelecimentos desactivados pelo repositório. */
const seedWithInactiveBranches = async (database: SqliteDatabase): Promise<InactiveSeed> => {
  const s = await seed(database);
  const tenant = createSqliteTenantPersistence(database);
  const context = contextFor(s.company.tenantId);
  await tenant.branches.update(context, deactivateBranch(s.north, UPDATED_AT));
  await tenant.branches.update(context, deactivateBranch(s.south, UPDATED_AT));
  const east = createBranch(branchInput(s.company, { code: 'E', name: 'Loja Este', sectorType: 'SUPERMARKET' }));
  await tenant.branches.create(context, east);
  return { ...s, east };
};

/**
 * PD-89: cenários que nenhum teste exercitava, cada um ligado à mutação da revisão que deixava passar.
 * I02 — DELETE de um estabelecimento inactivo; I03 — código de um titular inactivo tomado por
 * `UPDATE OR REPLACE` (a substituição eliminaria o titular); I04 — sector alterado com o estado.
 */
const inactiveBranchAttacks = (s: InactiveSeed): readonly Attack[] => [
  ['I02 DELETE an inactive childless branch', `DELETE FROM branches WHERE id = '${s.south.id}'`, BRANCH_NEVER_DELETED],
  ['I02 DELETE an inactive branch with a local membership', `DELETE FROM branches WHERE id = '${s.north.id}'`, BRANCH_NEVER_DELETED],
  ['I03 UPDATE OR REPLACE code of an inactive childless sibling', `UPDATE OR REPLACE branches SET code = 'S' WHERE id = '${s.east.id}'`, CODE_TAKEN],
  ['I03 UPDATE OR REPLACE code of an inactive sibling with dependants', `UPDATE OR REPLACE branches SET code = 'N' WHERE id = '${s.east.id}'`, CODE_TAKEN],
  [
    'I04 UPDATE sector while deactivating an active branch',
    `UPDATE branches SET sector_type = 'PHARMACY', status = 'INACTIVE' WHERE id = '${s.east.id}'`,
    BRANCH_SECTOR,
  ],
  [
    'I04 UPDATE sector while reactivating an inactive branch',
    `UPDATE branches SET sector_type = 'FUEL_STATION', status = 'ACTIVE' WHERE id = '${s.south.id}'`,
    BRANCH_SECTOR,
  ],
];

/** Aceites na migração 9: os cenários da PD-89 descrevem garantias que só a migração 10 dá. */
const INACTIVE_ACCEPTED_AT_9_ALWAYS = [
  'I02 DELETE an inactive childless branch',
  'I03 UPDATE OR REPLACE code of an inactive childless sibling',
  'I04 UPDATE sector while deactivating an active branch',
  'I04 UPDATE sector while reactivating an inactive branch',
];
const INACTIVE_ACCEPTED_AT_9_WITHOUT_FOREIGN_KEYS = [
  'I02 DELETE an inactive branch with a local membership',
  'I03 UPDATE OR REPLACE code of an inactive sibling with dependants',
];

describe('E1.07-D3-PD78-C1 company and branch identities (migration 10, PD-78)', () => {
  const temporaries: TemporaryDatabase[] = [];
  const running: ServiceUnderTest[] = [];

  const fresh = (migrations = MIGRATIONS): { database: SqliteDatabase; temporary: TemporaryDatabase } => {
    const temporary = createTemporaryDatabase();
    temporaries.push(temporary);
    const database = temporary.open();
    runMigrations(database, migrations);
    return { database, temporary };
  };

  const fileHash = (filename: string): string => createHash('sha256').update(readFileSync(filename)).digest('hex');

  beforeEach(() => {
    expect(temporaries).toEqual([]);
    expect(running).toEqual([]);
  });

  afterEach(async () => {
    // PD87-C2 (PD-57): as bases só são apagadas depois de parar os serviços e confirmar as ligações fechadas.
    await stopServicesThenDisposeNow(running.splice(0), {
      dispose: () => {
        for (const temporary of temporaries.splice(0)) temporary.dispose();
      },
    });
  });

  describe('reproduction at migration 9 (published head)', () => {
    it.each(CONFIGURATIONS)('[PD78-V01] identities can be deleted, re-used or replaced at migration 9 with $label', async (configuration) => {
      const { database } = fresh(MIGRATED_TO_9);
      const s = await seed(database);
      applyPragmas(database, configuration);
      const accepted: string[] = [];
      for (const [label, sql] of attacks(database, s)) {
        database.exec('BEGIN');
        try {
          database.exec(sql);
          accepted.push(label);
        } catch {
          // recusado
        } finally {
          database.exec('ROLLBACK');
        }
      }
      expect(accepted).toEqual(expect.arrayContaining(ACCEPTED_AT_9_ALWAYS));
      if (!configuration.foreignKeys) expect(accepted).toEqual(expect.arrayContaining(ACCEPTED_AT_9_WITHOUT_FOREIGN_KEYS));
    });

    it.each(CONFIGURATIONS)('[PD78-V02] an UPDATE OR REPLACE of the code silently deletes the sibling at migration 9 with $label', async (configuration) => {
      const { database } = fresh(MIGRATED_TO_9);
      const s = await seed(database);
      applyPragmas(database, configuration);
      database.exec(`UPDATE OR REPLACE branches SET code = 'S' WHERE id = '${s.north.id}'`);
      expect(database.prepare('SELECT id FROM branches WHERE company_id = ? ORDER BY code').pluck().all(s.company.id)).toEqual([s.north.id]);
      // Depois, o identificador eliminado pode ser reinserido com outro código e outro sector.
      database.exec(branchRow(s.south.id, s.company, 'OUTRO'));
      expect(database.prepare('SELECT code, sector_type FROM branches WHERE id = ?').get(s.south.id)).toEqual({
        code: 'OUTRO',
        sector_type: 'FUEL_STATION',
      });
    });
  });

  describe('schema guards after migration 10', () => {
    it.each(CONFIGURATIONS)('[PD78-S01] refuses every deletion, re-use and destructive replacement with $label', async (configuration) => {
      const { database } = fresh();
      const s = await seed(database);
      applyPragmas(database, configuration);
      const before = snapshot(database);
      const list = attacks(database, s);
      expect(list).toHaveLength(49);
      for (const [label, sql, refusal] of list) {
        expect(() => database.exec(sql), label).toThrow(refusal);
        expect(snapshot(database), label).toEqual(before);
        expect(database.prepare('PRAGMA foreign_key_check').all(), label).toEqual([]);
      }
      expect(database.inTransaction).toBe(false);
    });

    it.each(CONFIGURATIONS)('[PD78-S02] refuses the same attempts under every conflict clause with $label', async (configuration) => {
      const { database } = fresh();
      const s = await seed(database);
      applyPragmas(database, configuration);
      const before = snapshot(database);
      for (const [label, build, refusal] of conflictAttacks(s)) {
        for (const clause of CONFLICT_CLAUSES) {
          const sql = build(clause);
          expect(sql, label).toContain(`OR ${clause}`);
          // RAISE(ABORT) reverte a instrução inteira, também com OR FAIL (linhas já alteradas) e OR IGNORE.
          expect(() => database.exec(sql), `${label} OR ${clause}`).toThrow(refusal);
          expect(snapshot(database), `${label} OR ${clause}`).toEqual(before);
        }
      }
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    });

    it.each(CONFIGURATIONS)('[PD78-S03] keeps a refused statement atomic inside an open transaction with $label', async (configuration) => {
      const { database } = fresh();
      const s = await seed(database);
      applyPragmas(database, configuration);
      database.exec('BEGIN');
      database.exec(`UPDATE branches SET name = 'Alterado antes' WHERE id = '${s.south.id}'`);
      expect(() => database.exec(`UPDATE OR FAIL branches SET code = 'Z' WHERE company_id = '${s.company.id}'`)).toThrow(CODE_TAKEN);
      expect(() => database.exec(`DELETE FROM companies WHERE id = '${s.draft.id}'`)).toThrow(COMPANY_NEVER_DELETED);
      // Só a instrução recusada é revertida; a transacção continua aberta com a alteração anterior.
      expect(database.inTransaction).toBe(true);
      expect(branch(database, s.south.id)).toMatchObject({ code: 'S', name: 'Alterado antes' });
      expect(branch(database, s.north.id)).toMatchObject({ code: 'N' });
      database.exec('ROLLBACK');
      expect(branch(database, s.south.id)).toMatchObject({ name: 'Restaurante Sul' });
    });

    it.each(CONFIGURATIONS)('[PD78-S04] accepts the legitimate changes of unprotected fields with $label', async (configuration) => {
      const { database } = fresh();
      const s = await seed(database);
      applyPragmas(database, configuration);
      const before = snapshot(database);
      for (const [label, change] of legitimateChanges(s)) {
        database.exec('BEGIN');
        try {
          change(database);
          expect(database.prepare('PRAGMA foreign_key_check').all(), label).toEqual([]);
          expect(database.prepare('SELECT count(*) FROM branches').pluck().get(), label).toBeGreaterThanOrEqual(3);
        } finally {
          database.exec('ROLLBACK');
        }
        expect(snapshot(database), label).toEqual(before);
      }
    });

    it('[PD78-S05] creates exactly the eight triggers of migration 10, all BEFORE guards except the rowid check', () => {
      const { database } = fresh();
      const definitions = database
        .prepare("SELECT name, tbl_name, sql FROM sqlite_schema WHERE type = 'trigger' AND name IN (SELECT value FROM json_each(?)) ORDER BY name")
        .all(JSON.stringify(MIGRATION_10_TRIGGERS)) as { name: string; tbl_name: string; sql: string }[];
      expect(definitions.map((row) => row.name)).toEqual(MIGRATION_10_TRIGGERS);
      for (const { name, sql, tbl_name: table } of definitions) {
        expect(['companies', 'branches', 'sector_types'], name).toContain(table);
        expect(sql, name).toMatch(name === 'sector_types_rowid_positive' ? /\bAFTER INSERT ON sector_types\b/ : /\bBEFORE (DELETE|UPDATE|INSERT)\b/);
        expect(sql, name).toMatch(/RAISE\(ABORT, 'constraint failed: /);
      }
      const codeGuard = definitions.find((row) => row.name === 'branches_code_never_taken_over')?.sql ?? '';
      expect(codeGuard).toMatch(/BEFORE UPDATE OF code ON branches/);
      expect(codeGuard).toMatch(/company_id = NEW\.company_id AND code = NEW\.code AND id IS NOT OLD\.id/);
    });
  });

  describe('migration', () => {
    it('[PD78-M01] installs migration 10 on a new database; it only adds triggers and keeps checksums 1-9', () => {
      const { database } = fresh([]);
      expect(runMigrations(database)).toEqual({ applied: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], currentVersion: 10 });
      expect(MIGRATIONS.slice(0, 9).map(migrationChecksum)).toEqual(PUBLISHED_CHECKSUMS_1_TO_9);
      expect(MIGRATIONS[9]).toMatchObject({ name: 'protect_company_and_branch_identities', version: 10 });
      const sql = MIGRATIONS[9]?.sql ?? '';
      expect(sql).not.toMatch(/\b(CREATE TABLE|CREATE (UNIQUE )?INDEX|ALTER TABLE|INSERT INTO|DELETE FROM|DROP)\b|\bUPDATE\s+\w+\s+SET\b/i);
      expect([...sql.matchAll(/CREATE TRIGGER (\w+)/g)].map((match) => match[1]).sort()).toEqual(MIGRATION_10_TRIGGERS);
      expect(triggerNames(database)).toEqual(expect.arrayContaining(MIGRATION_10_TRIGGERS));
      expect(database.prepare('SELECT code FROM sector_types ORDER BY code').pluck().all()).toEqual([
        'FUEL_STATION',
        'PHARMACY',
        'RESTAURANT',
        'SUPERMARKET',
      ]);
      expect(database.prepare('SELECT checksum FROM schema_migrations WHERE version <= 9 ORDER BY version').pluck().all()).toEqual(
        PUBLISHED_CHECKSUMS_1_TO_9,
      );
    });

    it('[PD89-H01] pins the published checksum of migration 10, over its SQL content, and keeps checksums 1-9', () => {
      const latest = MIGRATIONS[9] as (typeof MIGRATIONS)[number];
      const published = [...PUBLISHED_CHECKSUMS_1_TO_9, PUBLISHED_CHECKSUM_10];
      expect(MIGRATIONS.map(migrationChecksum)).toEqual(published);
      // A soma é a do conteúdo SQL (o que é aplicado e registado), calculada aqui sem o código de execução.
      expect(createHash('sha256').update(latest.sql, 'utf8').digest('hex')).toBe(PUBLISHED_CHECKSUM_10);
      const { database } = fresh();
      expect(database.prepare('SELECT checksum FROM schema_migrations ORDER BY version').pluck().all()).toEqual(published);
      for (const altered of [`${latest.sql} `, latest.sql.replace('NEW.rowid <= 0', 'NEW.rowid < 0')]) {
        expect(altered).not.toBe(latest.sql);
        expect(migrationChecksum({ ...latest, sql: altered })).not.toBe(PUBLISHED_CHECKSUM_10);
      }
    });

    it('[PD78-M02] upgrades a migration-9 database with data without changing any row', async () => {
      const { database } = fresh(MIGRATED_TO_9);
      await seed(database);
      const before = { rows: snapshot(database), triggers: triggerNames(database) };
      expect(inspectMigrations(database)).toMatchObject({ appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9], pendingVersions: [10] });

      expect(runMigrations(database)).toEqual({ applied: [10], currentVersion: 10 });

      expect(snapshot(database)).toEqual(before.rows);
      expect(triggerNames(database)).toEqual([...before.triggers, ...MIGRATION_10_TRIGGERS].sort());
      expect(database.prepare('SELECT checksum FROM schema_migrations WHERE version <= 9 ORDER BY version').pluck().all()).toEqual(
        PUBLISHED_CHECKSUMS_1_TO_9,
      );
      expect(database.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(runMigrations(database)).toEqual({ applied: [], currentVersion: 10 });
    });

    it.each([
      ['at the end', (sql: string) => `${sql}\nSELECT * FROM missing_table;`],
      [
        'in the middle',
        (sql: string) => {
          const parts = sql.split('CREATE TRIGGER');
          return [...parts.slice(0, 5), ' missing_guard AFTER INSERT ON missing_table BEGIN SELECT 1; END;\n', ...parts.slice(5)].join('CREATE TRIGGER');
        },
      ],
    ])('[PD78-M03] rolls back a migration 10 failing %s, leaving no partial trigger', async (_where, breakSql) => {
      const { database } = fresh(MIGRATED_TO_9);
      await seed(database);
      const before = { rows: snapshot(database), triggers: triggerNames(database) };
      const latest = MIGRATIONS[9] as (typeof MIGRATIONS)[number];
      const broken = breakSql(latest.sql);
      expect(broken).not.toBe(latest.sql);

      expect(() => runMigrations(database, [...MIGRATED_TO_9, { ...latest, sql: broken }])).toThrow(/missing_table/);

      expect(triggerNames(database)).toEqual(before.triggers);
      expect(snapshot(database)).toEqual(before.rows);
      expect(inspectMigrations(database)).toMatchObject({ appliedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9], pendingVersions: [10] });
      expect(runMigrations(database)).toEqual({ applied: [10], currentVersion: 10 });
      expect(triggerNames(database)).toEqual([...before.triggers, ...MIGRATION_10_TRIGGERS].sort());
    });

    it('[PD78-M04] refuses a downgrade and a migration 10 altered after it was applied, without touching the file', async () => {
      const { database, temporary } = fresh();
      await seed(database);
      database.close();
      const hashBefore = fileHash(temporary.filename);
      const reopened = temporary.open();
      const latest = MIGRATIONS[9] as (typeof MIGRATIONS)[number];

      expect(() => runMigrations(reopened, MIGRATED_TO_9)).toThrow(/unknown-schema-version/);
      expect(() => inspectMigrations(reopened, MIGRATED_TO_9)).toThrow(/unknown-schema-version/);
      expect(() => inspectMigrations(reopened, [...MIGRATED_TO_9, { ...latest, sql: `${latest.sql}\n` }])).toThrow(
        /migration-checksum-mismatch/,
      );
      expect(() => runMigrations(reopened, [...MIGRATED_TO_9, { ...latest, sql: latest.sql.replace('BEFORE DELETE ON companies', 'AFTER DELETE ON companies') }])).toThrow(
        /migration-checksum-mismatch/,
      );
      reopened.close();
      expect(fileHash(temporary.filename)).toBe(hashBefore);
    });

    it('[PD78-M05] the local service refuses migration 10 under the strict policy, then applies only it and keeps working', async () => {
      const { database, temporary } = fresh(MIGRATED_TO_9);
      const s = await seed(database);
      database.close();
      const hashBefore = fileHash(temporary.filename);
      const strict = createServiceUnderTest(
        serviceConfig(temporary.filename, { startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'fail' } }),
      );
      running.push(strict);
      await expect(strict.service.start()).rejects.toMatchObject({ reason: 'pending-migrations' });
      expect(fileHash(temporary.filename)).toBe(hashBefore);

      const applying = createServiceUnderTest(serviceConfig(temporary.filename));
      running.push(applying);
      await applying.service.start();
      expect(applying.service.startupReport).toMatchObject({ appliedMigrations: [10], schemaVersion: 10 });
      const { branches, companies } = applying.service;
      const context = contextFor(s.company.tenantId);
      expect('delete' in companies).toBe(false);
      expect('delete' in branches).toBe(false);
      await branches.update(context, createBranch({ ...s.south, code: 'S2', name: 'Restaurante Renomeado', updatedAt: UPDATED_AT }));
      await branches.update(context, deactivateBranch(s.north, UPDATED_AT));
      await expect(branches.update(context, createBranch({ ...s.south, code: 'N', updatedAt: UPDATED_AT }))).rejects.toMatchObject({
        reason: 'duplicate-branch-code',
      });
      await expect(branches.update(context, createBranch({ ...s.south, sectorType: 'PHARMACY', updatedAt: UPDATED_AT }))).rejects.toMatchObject({
        reason: 'immutable-field',
      });
      await companies.update(context, deactivateCompany(s.company, UPDATED_AT));
      await expect(companies.create(contextFor(s.company.tenantId), newCompany({ tenantId: s.company.tenantId }))).rejects.toMatchObject({
        reason: 'tenant-already-has-company',
      });
      await applying.service.stop();

      const persisted = inspectDatabase(temporary.filename, () => temporary.open(), (own) => ({
        branches: own.prepare('SELECT id, code, status FROM branches WHERE company_id = ? ORDER BY code').all(s.company.id),
        company: own.prepare('SELECT status FROM companies WHERE id = ?').pluck().get(s.company.id),
        foreignKeys: own.prepare('PRAGMA foreign_key_check').all(),
        triggers: triggerNames(own),
      }));
      expect(persisted.triggers).toEqual(expect.arrayContaining(MIGRATION_10_TRIGGERS));
      expect({ ...persisted, triggers: undefined }).toEqual({
        branches: [
          { code: 'N', id: s.north.id, status: 'INACTIVE' },
          { code: 'S2', id: s.south.id, status: 'ACTIVE' },
        ],
        company: 'INACTIVE',
        foreignKeys: [],
        triggers: undefined,
      });
    });

    it('[PD78-M06] the PD-76 pre-check still refuses a migration-9 database with a legacy non-positive company rowid', async () => {
      const { database, temporary } = fresh(MIGRATIONS.slice(0, 6));
      const legacy = newCompany();
      database
        .prepare(
          `INSERT INTO companies (rowid, id, tenant_id, jurisdiction, legal_name, nif, status, created_at, updated_at)
           VALUES (-3, ?, ?, 'ZZ', 'Legado, Lda.', 'NIF-TESTE-0001', 'ACTIVE', ?, ?)`,
        )
        .run(legacy.id, legacy.tenantId, CREATED_AT, CREATED_AT);
      runMigrations(database, MIGRATED_TO_9);
      database.close();
      const hashBefore = fileHash(temporary.filename);

      const applying = createServiceUnderTest(serviceConfig(temporary.filename));
      running.push(applying);
      await expect(applying.service.start()).rejects.toMatchObject({ reason: 'legacy-rowid-incompatible' });
      await applying.service.stop();
      expect(fileHash(temporary.filename)).toBe(hashBefore);
      const reopened = temporary.open();
      expect(inspectMigrations(reopened)).toMatchObject({ pendingVersions: [10] });
      reopened.close();
    });

    it('[PD78-M07] neither detects nor repairs a database tampered with before migration 10 (DP-PD78-13)', async () => {
      const { database } = fresh(MIGRATED_TO_9);
      const s = await seed(database);
      database.pragma('foreign_keys = OFF');
      database.exec(`DELETE FROM branches WHERE id = '${s.north.id}'`);
      database.pragma('foreign_keys = ON');
      const violations = database.prepare('PRAGMA foreign_key_check').all();
      expect(violations).toHaveLength(1);

      expect(runMigrations(database)).toEqual({ applied: [10], currentVersion: 10 });

      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual(violations);
      expect(() => database.exec(branchRow(s.north.id, s.company, 'N'))).not.toThrow();
    });
  });

  describe('isolation and deactivation', () => {
    it('[PD78-I01] re-uses no identifier of another tenant, by repository or by SQL', async () => {
      const { database } = fresh();
      const s = await seed(database);
      const tenant = createSqliteTenantPersistence(database);
      const before = snapshot(database);
      const otherContext = contextFor(s.other.tenantId);

      await expect(tenant.branches.create(otherContext, createBranch(branchInput(s.other, { code: 'NOVO', id: s.north.id })))).rejects.toMatchObject({
        reason: 'duplicate-id',
      });
      const sameCompanyId = newCompany({ id: s.company.id });
      await expect(tenant.companies.create(contextFor(sameCompanyId.tenantId), sameCompanyId)).rejects.toMatchObject({
        reason: 'duplicate-id',
      });
      await expect(tenant.branches.update(otherContext, deactivateBranch(s.north, UPDATED_AT))).rejects.toMatchObject({
        name: 'TenantMismatchError',
      });
      expect(() => database.exec(branchRow(s.south.id, s.other, 'NOVO'))).toThrow(BRANCH_REINSERTED);
      expect(() => database.exec(companyRow(s.company.id, newId()))).toThrow(COMPANY_REINSERTED);
      expect(snapshot(database)).toEqual(before);
    });

    it('[PD78-I02] deactivating a company and a branch keeps memberships and sessions and removes them only from evaluation', async () => {
      const { database } = fresh();
      const s = await seed(database);
      const tenant = createSqliteTenantPersistence(database);
      const { scopes } = createSqliteMembershipPersistence(database);
      const context = contextFor(s.company.tenantId);
      await expect(scopes.evaluate(context, s.user.id)).resolves.toMatchObject({
        branchIds: [s.north.id],
        companyOperational: true,
        eligible: true,
      });
      const untouched = (): unknown =>
        Object.fromEntries(
          ['users', 'password_credentials', 'local_sessions', 'company_memberships', 'branch_memberships', 'sector_types'].map((table) => [
            table,
            database.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all(),
          ]),
        );
      const before = untouched();

      await tenant.branches.update(context, deactivateBranch(s.north, UPDATED_AT));
      await tenant.companies.update(context, deactivateCompany(s.company, UPDATED_AT));

      expect(untouched()).toEqual(before);
      await expect(scopes.evaluate(context, s.user.id)).resolves.toMatchObject({
        branchIds: [],
        companyOperational: false,
        eligible: true,
      });
      expect(database.prepare('SELECT revoked_at FROM local_sessions WHERE id = ?').pluck().get(s.sessionId)).toBeNull();
      expect(database.prepare('SELECT count(*) FROM branches WHERE company_id = ?').pluck().get(s.company.id)).toBe(2);
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    });
  });

  describe('inactive branches and joint sector and status changes (PD-89)', () => {
    it.each(CONFIGURATIONS)('[PD89-V03] the PD-89 scenarios are accepted at migration 9 with $label', async (configuration) => {
      const { database } = fresh(MIGRATED_TO_9);
      const s = await seedWithInactiveBranches(database);
      applyPragmas(database, configuration);
      const accepted: string[] = [];
      for (const [label, sql] of inactiveBranchAttacks(s)) {
        database.exec('BEGIN');
        try {
          database.exec(sql);
          accepted.push(label);
        } catch {
          // recusado
        } finally {
          database.exec('ROLLBACK');
        }
      }
      expect(accepted.sort()).toEqual(
        [...INACTIVE_ACCEPTED_AT_9_ALWAYS, ...(configuration.foreignKeys ? [] : INACTIVE_ACCEPTED_AT_9_WITHOUT_FOREIGN_KEYS)].sort(),
      );
    });

    it.each(CONFIGURATIONS)('[PD89-S06] keeps inactive branches, their codes and every sector intact with $label', async (configuration) => {
      const { database } = fresh();
      const s = await seedWithInactiveBranches(database);
      applyPragmas(database, configuration);
      const before = snapshot(database);
      const list = inactiveBranchAttacks(s);
      expect(list).toHaveLength(6);
      for (const [label, sql, refusal] of list) {
        expect(() => database.exec(sql), label).toThrow(refusal);
        expect(snapshot(database), label).toEqual(before);
        expect(database.prepare('PRAGMA foreign_key_check').all(), label).toEqual([]);
      }
      expect(database.inTransaction).toBe(false);
      expect([s.north, s.south, s.east].map((each) => branch(database, each.id))).toEqual([
        { code: 'N', name: 'Farmácia Norte', sector_type: 'PHARMACY', status: 'INACTIVE', updated_at: UPDATED_AT },
        { code: 'S', name: 'Restaurante Sul', sector_type: 'RESTAURANT', status: 'INACTIVE', updated_at: UPDATED_AT },
        { code: 'E', name: 'Loja Este', sector_type: 'SUPERMARKET', status: 'ACTIVE', updated_at: s.east.updatedAt },
      ]);
      expect(database.prepare('SELECT branch_id FROM branch_memberships WHERE id = ?').pluck().get(s.local.id)).toBe(s.north.id);
    });
  });
});
