import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createSqliteAuthenticationStore,
  createSqliteMembershipPersistence,
  createSqliteTenantPersistence,
  createSqliteUserDirectory,
  findNonPositiveRowids,
  inspectMigrations,
  type InstallationAnchorFault,
  MIGRATIONS,
  migrationChecksum,
  NonPositiveRowidError,
  ROWID_GUARDED_TABLES,
  runMigrations,
  type SqliteDatabase,
} from '../packages/database/src/index';
import {
  createBranch,
  createBranchMembership,
  type Branch,
  type BranchMembership,
  type Company,
  type User,
} from '../packages/shared-types/src/index';
import { InitialAdministratorProtectedError } from '../services/local-api/src/authentication/initial-administrator-protection';
import {
  createTestClock,
  OTHER_TEST_PASSWORD,
  TEST_HASHING_PARAMETERS,
  TEST_PASSWORD,
  type TestClock,
} from './support/authentication-fixtures';
import { companyTarget } from './support/authorization-fixtures';
import { branchInput, contextFor, CREATED_AT, newCompany, newId, UPDATED_AT } from './support/fixtures';
import { newBranchMembership, newCompanyMembership, newUser, uniqueUsername } from './support/identity-fixtures';
import {
  createServiceUnderTest,
  inspectDatabase,
  liveServiceConnection,
  serviceConfig,
  type ServiceUnderTest,
} from './support/local-service-harness';
import { IDENTITY_GATE_DERIVATION } from './support/argon2-test-classification';
import { createTemporaryDatabase, type TemporaryDatabase } from './support/sqlite-harness';
import { createDerivationTracker } from './support/test-derivation';

/*
 * E1.07-D3-G0 — Gate de segurança da administração da instalação (PD-73, PD-75, PD-76).
 * G: identidades persistentes (migração 8), âncora da instalação, protecção do administrador
 * inicial e pré-verificação de `rowid` legados. SQLite real, bases descartáveis, dados fictícios.
 */

const REFUSED = /constraint|FOREIGN KEY|UNIQUE|CHECK|never|immutable|belongs/i;

/** Somas publicadas das migrações 1 a 7 (`main` = `5e60b7f`); a migração 8 não as altera. */
const PUBLISHED_CHECKSUMS_1_TO_7 = [
  'c70164d253bed3637177a1a434282a3fb9e4d16c294134dd2f6ec61dbf734b61',
  'b05636332e82baa7250873473b7c91fd0a571ec07e2b90b7ee2d236fd9bfc2d0',
  '340d886e73aae09527f46db3e3dbecfa9afc7b9fafa126e0267cea9d1d1a1f53',
  '95e09724388a7dce7e6c5588a55f3c35ee98f7a7202356885720dd7d1cdedf6e',
  'd404e58df245f3a42ed9970be395b0ae90cc7b8d0c08cdcb14d5da871823b7a4',
  'f7bf395b5827dfb64a4b2c661416b77e3dfc168c0276d6509315d174f5b3d09f',
  'a6dd64de16b2734d15be2a4714b9e6d7bb0eea9ad66a352b38eecdb758e59f7d',
];

const MIGRATION_8_TRIGGERS = [
  'branch_memberships_never_deleted',
  'users_creation_immutable',
  'users_never_deleted',
  'users_username_never_taken_over',
];

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
};

interface IdentitySeed {
  readonly administrator: User;
  readonly other: User;
  /** Identidade sem credencial, sessões nem associações (sem linhas filhas). */
  readonly bare: User;
  readonly company: Company;
  readonly north: Branch;
  readonly south: Branch;
  readonly local: BranchMembership;
  readonly sessionId: string;
}

const insertCredential = (database: SqliteDatabase, userId: string, at: string): void => {
  createSqliteAuthenticationStore(database).insertCredential({
    algorithm: 'argon2id',
    algorithmVersion: 19,
    createdAt: at as User['createdAt'],
    hash: randomBytes(32),
    memoryKiB: 19456,
    parallelism: 1,
    passes: 2,
    salt: randomBytes(16),
    updatedAt: at as User['createdAt'],
    userId: userId as User['id'],
  });
};

/**
 * Estado típico de uma instalação, escrito pelos repositórios (como a aplicação): administrador
 * inicial com credencial, sessão activa e registo da instalação; outra identidade com associação
 * local; uma identidade sem linhas filhas.
 */
const seedIdentities = async (database: SqliteDatabase): Promise<IdentitySeed> => {
  const store = createSqliteAuthenticationStore(database);
  const administrator = newUser({ username: uniqueUsername('admin') });
  store.transaction(() => {
    store.insertUser(administrator);
    insertCredential(database, administrator.id, administrator.createdAt);
    store.insertBootstrap({ completedAt: administrator.createdAt, initialAdministratorId: administrator.id });
  });
  const users = createSqliteUserDirectory(database);
  const other = newUser();
  const bare = newUser();
  await users.create(other);
  await users.create(bare);
  insertCredential(database, other.id, other.createdAt);
  const sessionId = randomUUID();
  database
    .prepare(
      `INSERT INTO local_sessions (id, user_id, token_digest, security_version, credential_version, service_run_id,
         created_at, last_activity_at, absolute_expires_at) VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?)`,
    )
    .run(sessionId, administrator.id, randomBytes(32), randomBytes(16).toString('hex'), CREATED_AT, CREATED_AT, UPDATED_AT);

  const tenant = createSqliteTenantPersistence(database);
  const memberships = createSqliteMembershipPersistence(database);
  const company = newCompany();
  const context = contextFor(company.tenantId);
  await tenant.companies.create(context, company);
  const north = createBranch(branchInput(company, { code: 'NORTE' }));
  const south = createBranch(branchInput(company, { code: 'SUL' }));
  await tenant.branches.create(context, north);
  await tenant.branches.create(context, south);
  const membership = newCompanyMembership(other, company, { scope: 'BRANCH_RESTRICTED' });
  await memberships.companyMemberships.create(context, membership);
  const local = newBranchMembership(membership, north);
  await memberships.branchMemberships.create(context, local);
  return { administrator, bare, company, local, north, other, sessionId, south };
};

const PROTECTED_TABLES = [
  'users',
  'password_credentials',
  'local_sessions',
  'installation_bootstrap',
  'company_memberships',
  'branch_memberships',
] as const;

const snapshot = (database: SqliteDatabase): Record<string, unknown[]> =>
  Object.fromEntries(
    PROTECTED_TABLES.map((table) => [table, database.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all()]),
  );

const bootstrapTarget = (database: SqliteDatabase): unknown =>
  database
    .prepare(
      `SELECT u.username, u.created_at FROM installation_bootstrap b LEFT JOIN users u ON u.id = b.initial_administrator_id`,
    )
    .get();

/** Tentativas de eliminação, reinserção e substituição por SQL directo (PD-75). */
const identityAttacks = (s: IdentitySeed): Readonly<Record<string, string>> => {
  const userRow = (id: string, username: string, createdAt: string, securityVersion: number): string =>
    `INSERT INTO users (id, username, display_name, status, created_at, updated_at, security_version)
     VALUES ('${id}', '${username}', 'Impostor Fictício', 'ACTIVE', '${createdAt}', '${createdAt}', ${securityVersion})`;
  const localRow = (branchId: string): string =>
    `INSERT INTO branch_memberships (id, company_membership_id, tenant_id, company_id, branch_id, status, created_at, updated_at)
     VALUES ('${s.local.id}', '${s.local.companyMembershipId}', '${s.local.tenantId}', '${s.local.companyId}', '${branchId}',
       'ACTIVE', '${CREATED_AT}', '${CREATED_AT}')`;
  return {
    'DELETE initial administrator': `DELETE FROM users WHERE id = '${s.administrator.id}'`,
    'DELETE + INSERT initial administrator with the same id': `DELETE FROM users WHERE id = '${s.administrator.id}';
      ${userRow(s.administrator.id, 'impostor.ficticio', UPDATED_AT, 9)}`,
    'DELETE childless identity': `DELETE FROM users WHERE id = '${s.bare.id}'`,
    'DELETE + INSERT childless identity with the same id': `DELETE FROM users WHERE id = '${s.bare.id}';
      ${userRow(s.bare.id, 'impostor.ficticio', UPDATED_AT, 1)}`,
    'DELETE every identity': 'DELETE FROM users',
    'UPDATE OR REPLACE username takeover of the initial administrator': `UPDATE OR REPLACE users
      SET username = '${s.administrator.username}' WHERE id = '${s.other.id}'`,
    'UPDATE OR REPLACE username takeover of a childless identity': `UPDATE OR REPLACE users
      SET username = '${s.bare.username}' WHERE id = '${s.other.id}'`,
    'REPLACE INTO initial administrator': `REPLACE INTO users (id, username, display_name, status, created_at, updated_at,
      security_version) VALUES ('${s.administrator.id}', 'impostor.ficticio', 'Impostor', 'ACTIVE', '${UPDATED_AT}', '${UPDATED_AT}', 9)`,
    // Data anterior: só a migração 8 a recusa (uma posterior a `updated_at` já falha `users_chronology`).
    'UPDATE creation of the initial administrator': `UPDATE users SET created_at = '2020-01-01T00:00:00.000Z'
      WHERE id = '${s.administrator.id}'`,
    'DELETE branch membership': `DELETE FROM branch_memberships WHERE id = '${s.local.id}'`,
    'DELETE + INSERT branch membership with the same id at another branch': `DELETE FROM branch_memberships
      WHERE id = '${s.local.id}'; ${localRow(s.south.id)}`,
    'DELETE every branch membership': 'DELETE FROM branch_memberships',
  };
};

const MIGRATED_TO_7 = MIGRATIONS.slice(0, 7);

describe('E1.07-D3-G0 installation authority gate (PD-73, PD-75, PD-76)', () => {
  let temporary: TemporaryDatabase;
  let extra: TemporaryDatabase[];
  let clock: TestClock;
  const running: ServiceUnderTest[] = [];

  const fresh = (migrations = MIGRATIONS): { database: SqliteDatabase; temporary: TemporaryDatabase } => {
    const own = createTemporaryDatabase();
    extra.push(own);
    const database = own.open();
    runMigrations(database, migrations);
    return { database, temporary: own };
  };

  const derivation = createDerivationTracker(IDENTITY_GATE_DERIVATION);

  const startedService = async (filename = temporary.filename): Promise<ServiceUnderTest> => {
    const harness = createServiceUnderTest(serviceConfig(filename), undefined, {
      clock: clock.now,
      passwordHashing: { derive: derivation.derive, parameters: TEST_HASHING_PARAMETERS },
    });
    running.push(harness);
    await harness.service.start();
    return harness;
  };

  const provision = async ({ service }: ServiceUnderTest, password = TEST_PASSWORD): Promise<User> => {
    const user = newUser();
    await service.identityProvisioning.users.create(user);
    await service.identityProvisioning.credentials.create(user.id, password);
    return user;
  };

  const openSession = async ({ service }: ServiceUnderTest, user: User, password = TEST_PASSWORD) => {
    const authenticated = await service.authentication.authenticate(user.username, password);
    if (!authenticated.ok) throw new Error('Autenticação esperada.');
    const created = await service.sessions.create(authenticated.identity);
    if (!created.ok) throw new Error('Sessão esperada.');
    return created.session;
  };

  const inspect = <T>(read: (database: SqliteDatabase) => T): T =>
    inspectDatabase(temporary.filename, () => temporary.open(), read);

  beforeEach(() => {
    temporary = createTemporaryDatabase();
    extra = [];
    clock = createTestClock();
    derivation.reset();
  });

  afterEach(async () => {
    for (const harness of running.splice(0)) await harness.service.stop();
    for (const own of extra) own.dispose();
    temporary.dispose();
    derivation.verifyAndReset(expect.getState().currentTestName ?? '');
  });

  describe('PD-75 reproduction before migration 8 (migration 7, published head)', () => {
    it.each(CONFIGURATIONS)('[G00] identities and local memberships can be deleted or replaced at migration 7 with $label', async (configuration) => {
      const { database } = fresh(MIGRATED_TO_7);
      const s = await seedIdentities(database);
      applyPragmas(database, configuration);
      const accepted: string[] = [];
      for (const [label, sql] of Object.entries(identityAttacks(s))) {
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
      // Sem linhas filhas, as identidades e as associações locais nunca estiveram protegidas.
      const always = [
        'DELETE childless identity',
        'DELETE + INSERT childless identity with the same id',
        'UPDATE OR REPLACE username takeover of a childless identity',
        'UPDATE creation of the initial administrator',
        'DELETE branch membership',
        'DELETE + INSERT branch membership with the same id at another branch',
        'DELETE every branch membership',
      ];
      const withoutForeignKeys = [
        'DELETE initial administrator',
        'DELETE + INSERT initial administrator with the same id',
        'DELETE every identity',
        'UPDATE OR REPLACE username takeover of the initial administrator',
      ];
      expect(accepted.sort()).toEqual((configuration.foreignKeys ? always : [...always, ...withoutForeignKeys]).sort());
      // Só a migração 5 (REPLACE da mesma identidade) e a 7 (registo da instalação) resistiam.
      expect(accepted).not.toContain('REPLACE INTO initial administrator');
    });

    it('[G00b] with foreign_keys OFF the installation record ends up pointing at a missing or different identity (migration 7)', async () => {
      const { database } = fresh(MIGRATED_TO_7);
      const s = await seedIdentities(database);
      applyPragmas(database, CONFIGURATIONS[1]);
      database.exec(`DELETE FROM users WHERE id = '${s.administrator.id}'`);
      expect(bootstrapTarget(database)).toEqual({ created_at: null, username: null });
      database.exec(identityAttacks(s)['DELETE + INSERT initial administrator with the same id']?.split(';')[1] ?? '');
      expect(bootstrapTarget(database)).toEqual({ created_at: UPDATED_AT, username: 'impostor.ficticio' });
      expect(createSqliteAuthenticationStore(database).readBootstrap()?.initialAdministratorId).toBe(s.administrator.id);
    });
  });

  describe.each(CONFIGURATIONS)('migration 8 with $label', (configuration) => {
    it('[G01] refuses every deletion, re-insertion and takeover and leaves the persisted state unchanged', async () => {
      const { database, temporary: own } = fresh();
      const s = await seedIdentities(database);
      applyPragmas(database, configuration);
      const before = snapshot(database);
      for (const [label, sql] of Object.entries(identityAttacks(s))) {
        expect(() => database.exec(sql), label).toThrow(REFUSED);
        expect(snapshot(database), label).toEqual(before);
      }
      // Mesmo com o esquema protegido, o registo da instalação continua a apontar para a identidade gravada.
      expect(createSqliteAuthenticationStore(database).readInstallationAnchor()).toEqual({
        completedAt: s.administrator.createdAt,
        initialAdministratorId: s.administrator.id,
        state: 'intact',
      });
      database.close();
      const reopened = own.open();
      expect(snapshot(reopened)).toEqual(before);
      expect(reopened.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
      expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    });

    it('[G02] refuses implicit deletion inside REPLACE paths and keeps the active session of the identity', async () => {
      const { database } = fresh();
      const s = await seedIdentities(database);
      applyPragmas(database, configuration);
      const before = snapshot(database);
      for (const sql of [
        `INSERT OR REPLACE INTO users (id, username, display_name, status, created_at, updated_at, security_version)
           VALUES ('${newId()}', '${s.bare.username}', 'Outro', 'ACTIVE', '${CREATED_AT}', '${CREATED_AT}', 1)`,
        `UPDATE OR REPLACE users SET id = '${s.bare.id}' WHERE id = '${s.other.id}'`,
        `UPDATE OR REPLACE users SET rowid = (SELECT rowid FROM users WHERE id = '${s.bare.id}') WHERE id = '${s.other.id}'`,
        `UPDATE OR REPLACE branch_memberships SET branch_id = '${s.south.id}' WHERE id = '${s.local.id}'`,
      ]) {
        expect(() => database.exec(sql)).toThrow(REFUSED);
        expect(snapshot(database)).toEqual(before);
      }
      expect(database.prepare('SELECT revoked_at FROM local_sessions WHERE id = ?').pluck().get(s.sessionId)).toBeNull();
    });

    it('[G03] rolls back earlier writes of the same transaction when a protected deletion is refused', async () => {
      const { database } = fresh();
      const s = await seedIdentities(database);
      applyPragmas(database, configuration);
      const before = snapshot(database);
      const newcomer = newUser();
      const store = createSqliteAuthenticationStore(database);
      expect(() =>
        store.transaction(() => {
          store.insertUser(newcomer);
          database.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('Alterado', s.other.id);
          database.prepare('DELETE FROM branch_memberships WHERE id = ?').run(s.local.id);
        }),
      ).toThrow(REFUSED);
      expect(snapshot(database)).toEqual(before);
      expect(store.findUserById(newcomer.id)).toBeUndefined();
    });

    it('[G04] keeps the explicit boundary: a SQL writer on the normal connection can still edit and replace credentials in place', async () => {
      const { database } = fresh();
      const s = await seedIdentities(database);
      applyPragmas(database, configuration);
      // D-201, condição 4: edição no lugar, não substituição da identidade. A identidade, a referência e
      // a ligação `created_at = completed_at` continuam as mesmas; as sessões são revogadas (migração 4).
      database.prepare('UPDATE users SET username = ?, display_name = ? WHERE id = ?').run('renomeado.ficticio', 'Renomeado', s.administrator.id);
      database
        .prepare('UPDATE password_credentials SET hash = ?, credential_version = credential_version + 1, updated_at = ? WHERE user_id = ?')
        .run(randomBytes(32), UPDATED_AT, s.administrator.id);
      expect(database.prepare('SELECT revocation_reason FROM local_sessions WHERE id = ?').pluck().get(s.sessionId)).toBe(
        'credential-replaced',
      );
      expect(createSqliteAuthenticationStore(database).readInstallationAnchor()).toMatchObject({
        initialAdministratorId: s.administrator.id,
        state: 'intact',
      });
    });

    it('[G01b] refuses deleting, re-using or taking over the username of DEACTIVATED identities and local memberships', async () => {
      // E1.07-D3-G0-R1 (PD-81, mutações P02, P03 e P04): “desactivadas, nunca eliminadas” vale para
      // identidades e associações já desactivadas. Os alvos não têm linhas filhas, para que só os
      // triggers da migração 8 possam recusar (nunca uma chave estrangeira por coincidência), e a
      // mensagem confirma o trigger responsável em todas as configurações.
      const { database } = fresh();
      const s = await seedIdentities(database);
      const directory = createSqliteUserDirectory(database);
      const suspended = newUser();
      await directory.create(suspended);
      await directory.changeStatus(s.bare.id, 'INACTIVE', UPDATED_AT);
      await directory.changeStatus(suspended.id, 'SUSPENDED', UPDATED_AT);
      await createSqliteMembershipPersistence(database).branchMemberships.update(
        contextFor(s.company.tenantId),
        createBranchMembership({ ...s.local, status: 'INACTIVE', updatedAt: UPDATED_AT }),
      );
      // Nenhuma linha de nenhuma tabela que referencie estes alvos (lido do próprio esquema).
      const dependents = (parent: string, id: string): number =>
        (
          database
            .prepare(
              `SELECT m.name AS child, f."from" AS col FROM sqlite_schema m, pragma_foreign_key_list(m.name) f
               WHERE m.type = 'table' AND f."table" = ?`,
            )
            .all(parent) as { child: string; col: string }[]
        ).reduce(
          (total, { child, col }) => total + (database.prepare(`SELECT count(*) FROM ${child} WHERE ${col} = ?`).pluck().get(id) as number),
          0,
        );
      for (const id of [s.bare.id, suspended.id]) expect(dependents('users', id)).toBe(0);
      expect(dependents('users', s.other.id)).toBeGreaterThan(0);
      expect(dependents('branch_memberships', s.local.id)).toBe(0);
      applyPragmas(database, configuration);
      const before = snapshot(database);

      const NEVER_DELETED = /users are deactivated, never deleted/;
      const LOCAL_NEVER_DELETED = /branch_memberships are deactivated, never deleted/;
      const USERNAME_TAKEN = /users username belongs to another identity/;
      const attempts: readonly (readonly [string, string, RegExp])[] = [
        ['DELETE inactive identity', `DELETE FROM users WHERE id = '${s.bare.id}'`, NEVER_DELETED],
        ['DELETE suspended identity', `DELETE FROM users WHERE id = '${suspended.id}'`, NEVER_DELETED],
        [
          'DELETE + INSERT inactive identity with the same id',
          `DELETE FROM users WHERE id = '${s.bare.id}';
           INSERT INTO users (id, username, display_name, status, created_at, updated_at, security_version)
           VALUES ('${s.bare.id}', 'impostor.ficticio', 'Impostor', 'ACTIVE', '${UPDATED_AT}', '${UPDATED_AT}', 9)`,
          NEVER_DELETED,
        ],
        [
          'UPDATE OR REPLACE username takeover of an inactive identity',
          `UPDATE OR REPLACE users SET username = '${s.bare.username}' WHERE id = '${s.other.id}'`,
          USERNAME_TAKEN,
        ],
        [
          'UPDATE OR REPLACE username takeover of a suspended identity',
          `UPDATE OR REPLACE users SET username = '${suspended.username}' WHERE id = '${s.other.id}'`,
          USERNAME_TAKEN,
        ],
        ['DELETE inactive branch membership', `DELETE FROM branch_memberships WHERE id = '${s.local.id}'`, LOCAL_NEVER_DELETED],
        [
          'DELETE + INSERT inactive branch membership with the same id at another branch',
          `DELETE FROM branch_memberships WHERE id = '${s.local.id}';
           INSERT INTO branch_memberships (id, company_membership_id, tenant_id, company_id, branch_id, status, created_at, updated_at)
           VALUES ('${s.local.id}', '${s.local.companyMembershipId}', '${s.local.tenantId}', '${s.local.companyId}', '${s.south.id}',
             'ACTIVE', '${CREATED_AT}', '${CREATED_AT}')`,
          LOCAL_NEVER_DELETED,
        ],
      ];
      for (const [label, sql, refusal] of attempts) {
        expect(() => database.exec(sql), label).toThrow(refusal);
        expect(snapshot(database), label).toEqual(before);
      }
      expect(database.prepare('SELECT status FROM users WHERE id IN (?, ?) ORDER BY status').pluck().all(s.bare.id, suspended.id)).toEqual([
        'INACTIVE',
        'SUSPENDED',
      ]);
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    });
  });

  describe('legitimate repository operations under migration 8', () => {
    it('[G05] deactivates (never deletes) ordinary identities and local memberships, preserving credentials and history', async () => {
      const harness = await startedService();
      const user = await provision(harness);
      const session = await openSession(harness, user);
      const credentialBefore = inspect((database) =>
        database.prepare('SELECT hash, credential_version FROM password_credentials WHERE user_id = ?').get(user.id),
      );

      await harness.service.identityProvisioning.users.changeStatus(user.id, 'INACTIVE', clock.now().toISOString());
      await expect(harness.service.sessions.validate(session.token)).resolves.toMatchObject({ ok: false });
      await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: false });
      const persisted = inspect((database) => ({
        credential: database.prepare('SELECT hash, credential_version FROM password_credentials WHERE user_id = ?').get(user.id),
        user: database.prepare('SELECT status FROM users WHERE id = ?').get(user.id),
      }));
      expect(persisted).toEqual({ credential: credentialBefore, user: { status: 'INACTIVE' } });
      // O identificador continua ocupado: não pode ser reutilizado por outra identidade.
      await expect(harness.service.identityProvisioning.users.create(newUser({ id: user.id }))).rejects.toThrow();
      await harness.service.identityProvisioning.users.changeStatus(user.id, 'ACTIVE', clock.now().toISOString());
      await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });

      // Associação local: desactivada pelo repositório, a linha permanece.
      const company = newCompany();
      const context = contextFor(company.tenantId);
      await harness.service.companies.create(context, company);
      const branch = createBranch(branchInput(company));
      await harness.service.branches.create(context, branch);
      const membership = newCompanyMembership(user, company, { scope: 'BRANCH_RESTRICTED' });
      await harness.service.companyMemberships.create(context, membership);
      const local = newBranchMembership(membership, branch);
      await harness.service.branchMemberships.create(context, local);
      await harness.service.branchMemberships.update(
        context,
        createBranchMembership({ ...local, status: 'INACTIVE', updatedAt: UPDATED_AT }),
      );
      await expect(harness.service.branchMemberships.findById(context, local.id)).resolves.toMatchObject({ status: 'INACTIVE' });
    });
  });

  describe('initial administrator protection (D-201, condition 3)', () => {
    it('[G06] refuses changing the status or replacing the credential of the initial administrator, with no state change', async () => {
      const harness = await startedService();
      const input = { displayName: 'Administrador Fictício', id: newId(), username: uniqueUsername('admin') };
      const { initialAdministratorId } = await harness.service.identityProvisioning.installation.initialise(input, TEST_PASSWORD);
      const administrator = await harness.service.identityProvisioning.users.findById(initialAdministratorId);
      if (administrator === undefined) throw new Error('Administrador esperado.');
      const session = await openSession(harness, administrator);
      const state = () =>
        inspect((database) => ({
          credential: database.prepare('SELECT * FROM password_credentials WHERE user_id = ?').get(initialAdministratorId),
          sessions: database.prepare('SELECT id, revoked_at FROM local_sessions WHERE user_id = ? ORDER BY id').all(initialAdministratorId),
          user: database.prepare('SELECT * FROM users WHERE id = ?').get(initialAdministratorId),
        }));
      const before = state();

      for (const status of ['SUSPENDED', 'INACTIVE', 'ACTIVE'] as const) {
        await expect(
          harness.service.identityProvisioning.users.changeStatus(initialAdministratorId, status, clock.now().toISOString()),
        ).rejects.toBeInstanceOf(InitialAdministratorProtectedError);
        expect(state()).toEqual(before);
      }
      await expect(
        harness.service.identityProvisioning.credentials.replace(initialAdministratorId, OTHER_TEST_PASSWORD),
      ).rejects.toMatchObject({ reason: 'initial-administrator-protected' });
      expect(state()).toEqual(before);
      await expect(harness.service.sessions.validate(session.token)).resolves.toMatchObject({ ok: true });
      await expect(harness.service.authentication.authenticate(administrator.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });
      await expect(harness.service.authentication.authenticate(administrator.username, OTHER_TEST_PASSWORD)).resolves.toMatchObject({ ok: false });

      // Outras identidades continuam administráveis pelo provisionamento interno.
      const ordinary = await provision(harness);
      await harness.service.identityProvisioning.credentials.replace(ordinary.id, OTHER_TEST_PASSWORD);
      await harness.service.identityProvisioning.users.changeStatus(ordinary.id, 'SUSPENDED', clock.now().toISOString());
    });
  });

  describe('initial administrator credential provisioning (PD-80, E1.07-D3-G0-R1)', () => {
    const initialised = async (options: { readonly session?: boolean } = {}) => {
      const harness = await startedService();
      const input = { displayName: 'Administrador Fictício', id: newId(), username: uniqueUsername('admin') };
      const { initialAdministratorId } = await harness.service.identityProvisioning.installation.initialise(input, TEST_PASSWORD);
      const administrator = await harness.service.identityProvisioning.users.findById(initialAdministratorId);
      if (administrator === undefined) throw new Error('Administrador esperado.');
      const session = options.session === true ? await openSession(harness, administrator) : undefined;
      return { administrator, harness, session };
    };

    /**
     * Fora da fronteira D-209 (actor F): só quem controla o esquema elimina uma credencial, retirando
     * o trigger da migração 4, que é reposto com o SQL original. Corre na ligação do serviço em `READY`.
     */
    const removeCredentialOutsideTheBoundary = (userId: string): void =>
      inspect((database) => {
        const trigger = database
          .prepare("SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = 'password_credentials_never_deleted'")
          .pluck()
          .get() as string;
        database.exec('DROP TRIGGER password_credentials_never_deleted');
        expect(database.prepare('DELETE FROM password_credentials WHERE user_id = ?').run(userId).changes).toBe(1);
        database.exec(trigger);
      });

    const anchorOf = ({ service }: ServiceUnderTest) => service.identityProvisioning.installation.verifyAnchor();

    /** Todas as operações comuns de credencial recusadas pela protecção, sem efeito persistido. */
    const expectEveryCredentialOperationRefused = async (harness: ServiceUnderTest, administrator: User): Promise<void> => {
      const { credentials } = harness.service.identityProvisioning;
      const before = inspect(snapshot);
      const anchorBefore = await anchorOf(harness);
      const attempts: readonly (readonly [string, () => Promise<void>])[] = [
        ['create', () => credentials.create(administrator.id, OTHER_TEST_PASSWORD)],
        ['replace', () => credentials.replace(administrator.id, OTHER_TEST_PASSWORD)],
        // A protecção vem antes de qualquer outra validação: a política de palavras-passe nem é avaliada.
        ['create with a password the policy refuses', () => credentials.create(administrator.id, '')],
        ['replace with a password the policy refuses', () => credentials.replace(administrator.id, '')],
      ];
      for (const [label, attempt] of attempts) {
        await expect(attempt(), label).rejects.toBeInstanceOf(InitialAdministratorProtectedError);
        expect(inspect(snapshot), label).toEqual(before);
        await expect(anchorOf(harness), label).resolves.toEqual(anchorBefore);
      }
      await expect(harness.service.authentication.authenticate(administrator.username, OTHER_TEST_PASSWORD)).resolves.toMatchObject({
        ok: false,
      });
    };

    it('[G16] keeps the legitimate first installation and refuses a second one, also when the anchor is broken', async () => {
      const harness = await startedService();
      const { installation, credentials } = harness.service.identityProvisioning;
      await expect(anchorOf(harness)).resolves.toEqual({ state: 'uninitialised' });
      // Antes da inicialização, o provisionamento comum de credenciais funciona como sempre.
      const earlier = await provision(harness);
      const input = { displayName: 'Administrador Fictício', id: newId(), username: uniqueUsername('admin') };
      const { initialAdministratorId } = await installation.initialise(input, TEST_PASSWORD);
      expect(initialAdministratorId).toBe(input.id);
      await expect(anchorOf(harness)).resolves.toMatchObject({ initialAdministratorId, state: 'intact' });
      await expect(harness.service.authentication.authenticate(input.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });
      expect(
        inspect((database) => database.prepare('SELECT credential_version FROM password_credentials WHERE user_id = ?').pluck().get(input.id)),
      ).toBe(1);

      const second = { displayName: 'Segundo Fictício', id: newId(), username: uniqueUsername('admin') };
      const before = inspect(snapshot);
      await expect(installation.initialise(second, TEST_PASSWORD)).rejects.toMatchObject({ reason: 'already-initialised' });
      await expect(installation.initialise({ ...second, id: earlier.id, username: earlier.username }, TEST_PASSWORD)).rejects.toThrow();
      expect(inspect(snapshot)).toEqual(before);

      removeCredentialOutsideTheBoundary(initialAdministratorId);
      await expect(anchorOf(harness)).resolves.toEqual({ fault: 'administrator-credential-missing', state: 'broken' });
      const broken = inspect(snapshot);
      await expect(installation.initialise(second, TEST_PASSWORD)).rejects.toMatchObject({ reason: 'already-initialised' });
      await expect(credentials.create(initialAdministratorId, TEST_PASSWORD)).rejects.toBeInstanceOf(InitialAdministratorProtectedError);
      expect(inspect(snapshot)).toEqual(broken);
      await expect(anchorOf(harness)).resolves.toEqual({ fault: 'administrator-credential-missing', state: 'broken' });
    });

    it('[G17] refuses every credential operation on an initial administrator with a valid credential and an active session', async () => {
      const { administrator, harness, session } = await initialised({ session: true });
      await expectEveryCredentialOperationRefused(harness, administrator);
      await expect(harness.service.sessions.validate(session?.token ?? '')).resolves.toMatchObject({ ok: true });
      await expect(harness.service.authentication.authenticate(administrator.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });
      await expect(anchorOf(harness)).resolves.toMatchObject({ initialAdministratorId: administrator.id, state: 'intact' });
    });

    it.each([
      { label: 'without any session (the migration-5 version guard cannot refuse)', session: false },
      { label: 'with an earlier session', session: true },
    ])('[G18] refuses provisioning a credential for an initial administrator whose credential is missing, $label', async ({ session }) => {
      const { administrator, harness } = await initialised({ session });
      removeCredentialOutsideTheBoundary(administrator.id);
      const sessions = inspect((database) =>
        database.prepare('SELECT count(*) FROM local_sessions WHERE user_id = ?').pluck().get(administrator.id),
      );
      expect(sessions).toBe(session ? 1 : 0);
      await expect(anchorOf(harness)).resolves.toEqual({ fault: 'administrator-credential-missing', state: 'broken' });

      await expectEveryCredentialOperationRefused(harness, administrator);
      for (const password of [TEST_PASSWORD, OTHER_TEST_PASSWORD]) {
        await expect(harness.service.authentication.authenticate(administrator.username, password)).resolves.toMatchObject({ ok: false });
      }
      const persisted = inspect(snapshot);
      await harness.service.stop();

      // Persistido: a base reaberta continua sem credencial e a âncora continua fechada noutro arranque.
      const reopened = temporary.open();
      expect(snapshot(reopened)).toEqual(persisted);
      expect(reopened.prepare('SELECT count(*) FROM password_credentials WHERE user_id = ?').pluck().get(administrator.id)).toBe(0);
      expect(reopened.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
      expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      reopened.close();
      const restarted = await startedService();
      await expect(anchorOf(restarted)).resolves.toEqual({ fault: 'administrator-credential-missing', state: 'broken' });
      await expectEveryCredentialOperationRefused(restarted, administrator);
    });

    it('[G19] refuses it also for a deactivated initial administrator without credential (status changed by SQL, D-209)', async () => {
      const { administrator, harness } = await initialised();
      inspect((database) => database.prepare("UPDATE users SET status = 'INACTIVE' WHERE id = ?").run(administrator.id));
      removeCredentialOutsideTheBoundary(administrator.id);
      await expectEveryCredentialOperationRefused(harness, administrator);
      await expect(
        harness.service.identityProvisioning.users.changeStatus(administrator.id, 'ACTIVE', clock.now().toISOString()),
      ).rejects.toBeInstanceOf(InitialAdministratorProtectedError);
      expect(inspect((database) => database.prepare('SELECT status FROM users WHERE id = ?').pluck().get(administrator.id))).toBe('INACTIVE');
    });

    it('[G20] offers no other credential path: no removal or re-creation operation, SQL deletion refused, identifier is no authority', async () => {
      const { administrator, harness } = await initialised();
      const provisioning = harness.service.identityProvisioning;
      expect(Object.keys(provisioning).sort()).toEqual(['credentials', 'installation', 'sessions', 'users']);
      expect(Object.keys(provisioning.credentials).sort()).toEqual(['create', 'replace']);
      expect(Object.keys(provisioning.installation).sort()).toEqual(['initialise', 'status', 'verifyAnchor']);
      expect(Object.keys(provisioning.users).sort()).toEqual(['changeStatus', 'create', 'findById']);
      const before = inspect(snapshot);

      // Remoção pela ligação normal: recusada pelo trigger da migração 4, com qualquer configuração de FK.
      for (const configuration of CONFIGURATIONS) {
        inspect((database) => {
          applyPragmas(database, configuration);
          expect(() => database.prepare('DELETE FROM password_credentials WHERE user_id = ?').run(administrator.id), configuration.label).toThrow(
            /password_credentials are replaced, never deleted/,
          );
        });
        expect(inspect(snapshot), configuration.label).toEqual(before);
      }
      // Conhecer o identificador ou o username não dá nenhuma autoridade sobre a identidade. Desde
      // E1.07-D3-G0-R3 (PD-82, D-227), o identificador do administrador é recusado pela protecção antes
      // da verificação `duplicate-id`, exista ou não a linha (antes: `duplicate-id`).
      await expect(provisioning.users.create(newUser({ id: administrator.id }))).rejects.toBeInstanceOf(
        InitialAdministratorProtectedError,
      );
      await expect(provisioning.users.create(newUser({ username: administrator.username }))).rejects.toMatchObject({
        reason: 'duplicate-username',
      });
      expect(inspect(snapshot)).toEqual(before);
      await expect(anchorOf(harness)).resolves.toMatchObject({ initialAdministratorId: administrator.id, state: 'intact' });
    });

    it('[G21] keeps ordinary identities administrable, including a deactivated one without credential', async () => {
      derivation.useDeterministic();
      const { administrator, harness } = await initialised();
      const { credentials, users } = harness.service.identityProvisioning;
      const administratorCredential = () =>
        inspect((database) => database.prepare('SELECT * FROM password_credentials WHERE user_id = ?').get(administrator.id));
      const adminBefore = administratorCredential();

      const ordinary = newUser();
      await users.create(ordinary);
      await credentials.create(ordinary.id, TEST_PASSWORD);
      await expect(harness.service.authentication.authenticate(ordinary.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });
      await expect(credentials.create(ordinary.id, OTHER_TEST_PASSWORD)).rejects.toMatchObject({ reason: 'duplicate-credential' });
      await credentials.replace(ordinary.id, OTHER_TEST_PASSWORD);
      await expect(harness.service.authentication.authenticate(ordinary.username, OTHER_TEST_PASSWORD)).resolves.toMatchObject({ ok: true });

      // Comportamento comum inalterado: a credencial de uma identidade desactivada pode ser criada,
      // mas não autentica enquanto a identidade não estiver activa.
      const inactive = newUser();
      await users.create(inactive);
      await users.changeStatus(inactive.id, 'INACTIVE', clock.now().toISOString());
      await credentials.create(inactive.id, TEST_PASSWORD);
      await expect(harness.service.authentication.authenticate(inactive.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: false });

      expect(administratorCredential()).toEqual(adminBefore);
      await expect(anchorOf(harness)).resolves.toMatchObject({ initialAdministratorId: administrator.id, state: 'intact' });
    });

    describe('initial administrator identity re-provisioning (PD-82, E1.07-D3-G0-R3)', () => {
      /**
       * Fora da fronteira D-209 (actor F): com a migração 8, só quem controla o esquema elimina uma
       * identidade — `foreign_keys` desligado, `users_never_deleted` retirado e reposto com o SQL
       * original. Corre na ligação do serviço em `READY` (os pragmas são repostos por `inspect`).
       */
      const removeIdentityOutsideTheBoundary = (userId: string): void =>
        inspect((database) => {
          const trigger = database
            .prepare("SELECT sql FROM sqlite_schema WHERE type = 'trigger' AND name = 'users_never_deleted'")
            .pluck()
            .get() as string;
          database.pragma('foreign_keys = OFF');
          database.exec('DROP TRIGGER users_never_deleted');
          expect(database.prepare('DELETE FROM users WHERE id = ?').run(userId).changes).toBe(1);
          database.exec(trigger);
        });

      const completedAtOf = async ({ service }: ServiceUnderTest): Promise<string> => {
        const status = await service.identityProvisioning.installation.status();
        if (!status.initialised || status.completedAt === undefined) throw new Error('Instalação inicializada esperada.');
        return status.completedAt;
      };

      /** Candidatos que recriariam o administrador inicial; nenhum pode ser aceite. */
      const recreations = (administrator: User, completedAt: string, ordinary: User) => {
        const impostor = uniqueUsername('impostor');
        const same = { createdAt: completedAt, displayName: 'Impostor Fictício', id: administrator.id, status: 'ACTIVE', username: impostor };
        return {
          impostor,
          attempts: [
            ['same id and creation instant (would repair the anchor)', same],
            ['same id, another creation instant', { ...same, createdAt: UPDATED_AT }],
            ['same id, deactivated', { ...same, status: 'INACTIVE' }],
            ['same id written in upper case (normalised by parseUserId)', { ...same, id: administrator.id.toUpperCase() }],
            ['same id and the original username', { ...same, username: administrator.username }],
            // A protecção vem antes da validação do candidato e da verificação de conflitos.
            ['same id with an invalid username', { ...same, username: '' }],
            ['same id with the username of another identity', { ...same, username: ordinary.username }],
          ] as const,
        };
      };

      const expectNoRecreation = async (harness: ServiceUnderTest, administrator: User, anchor: unknown): Promise<void> => {
        const { users } = harness.service.identityProvisioning;
        const ordinary = await provision(harness);
        const { attempts, impostor } = recreations(administrator, await completedAtOf(harness), ordinary);
        const before = inspect(snapshot);
        for (const [label, candidate] of attempts) {
          await expect(users.create(candidate as unknown as User), label).rejects.toBeInstanceOf(InitialAdministratorProtectedError);
          expect(inspect(snapshot), label).toEqual(before);
          await expect(anchorOf(harness), label).resolves.toEqual(anchor);
        }
        await expect(users.findById(administrator.id)).resolves.toBeUndefined();
        for (const username of [impostor, administrator.username]) {
          for (const password of [TEST_PASSWORD, OTHER_TEST_PASSWORD]) {
            await expect(harness.service.authentication.authenticate(username, password)).resolves.toMatchObject({ ok: false });
          }
        }
      };

      it.each([
        { credential: true, label: 'credential kept, without any session (the migration-5 guard cannot refuse)', session: false },
        { credential: true, label: 'credential kept, with an earlier session', session: true },
        { credential: false, label: 'credential missing, without any session', session: false },
        { credential: false, label: 'credential missing, with an earlier session', session: true },
      ])('[G22] refuses re-creating a missing initial administrator through users.create, $label', async ({ credential, session }) => {
        derivation.useDeterministic();
        const { administrator, harness } = await initialised({ session });
        if (!credential) removeCredentialOutsideTheBoundary(administrator.id);
        removeIdentityOutsideTheBoundary(administrator.id);
        const remaining = inspect((database) => ({
          credentials: database.prepare('SELECT count(*) FROM password_credentials WHERE user_id = ?').pluck().get(administrator.id),
          sessions: database.prepare('SELECT count(*) FROM local_sessions WHERE user_id = ?').pluck().get(administrator.id),
        }));
        expect(remaining).toEqual({ credentials: credential ? 1 : 0, sessions: session ? 1 : 0 });
        const anchor = { fault: 'administrator-missing', state: 'broken' };
        await expect(anchorOf(harness)).resolves.toEqual(anchor);

        await expectNoRecreation(harness, administrator, anchor);
        // Também a credencial continua fora do provisionamento comum (PD-80).
        await expect(harness.service.identityProvisioning.credentials.create(administrator.id, OTHER_TEST_PASSWORD)).rejects.toBeInstanceOf(
          InitialAdministratorProtectedError,
        );
        const persisted = inspect(snapshot);
        await harness.service.stop();

        // Persistido: a base reaberta continua sem a identidade e a âncora continua fechada noutro arranque.
        const reopened = temporary.open();
        expect(snapshot(reopened)).toEqual(persisted);
        expect(reopened.prepare('SELECT count(*) FROM users WHERE id = ?').pluck().get(administrator.id)).toBe(0);
        expect(reopened.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
        reopened.close();
        const restarted = await startedService();
        await expect(anchorOf(restarted)).resolves.toEqual(anchor);
        await expectNoRecreation(restarted, administrator, anchor);
      });

      it('[G23] refuses it on a legacy database tampered before migration 8 with foreign keys off only, in the four SQLite configurations', async () => {
        // Base anterior à 8 escrita pelos repositórios; a remoção só exige `foreign_keys` desligado na
        // ligação normal (sem controlo do esquema). Sem sessões do administrador.
        const { database, temporary: own } = fresh(MIGRATED_TO_7);
        const s = await seedIdentities(database);
        applyPragmas(database, CONFIGURATIONS[1]);
        database.prepare('DELETE FROM local_sessions WHERE user_id = ?').run(s.administrator.id);
        database.exec(`DELETE FROM users WHERE id = '${s.administrator.id}'`);
        database.close();

        const harness = await startedService(own.filename);
        expect(harness.service.startupReport).toMatchObject({ appliedMigrations: [8, 9], schemaVersion: 9 });
        const anchor = { fault: 'administrator-missing', state: 'broken' };
        const { installation, users } = harness.service.identityProvisioning;
        await expect(installation.verifyAnchor()).resolves.toEqual(anchor);
        const completedAt = await completedAtOf(harness);
        const live = liveServiceConnection(own.filename);
        if (live === undefined) throw new Error('Ligação do serviço esperada.');
        const before = inspectDatabase(own.filename, () => own.open(), snapshot);

        for (const configuration of CONFIGURATIONS) {
          applyPragmas(live, configuration);
          try {
            for (const [label, candidate] of recreations(s.administrator, completedAt, s.other).attempts) {
              await expect(users.create(candidate as unknown as User), `${configuration.label}: ${label}`).rejects.toBeInstanceOf(
                InitialAdministratorProtectedError,
              );
            }
          } finally {
            applyPragmas(live, CONFIGURATIONS[0]);
          }
          expect(inspectDatabase(own.filename, () => own.open(), snapshot), configuration.label).toEqual(before);
          await expect(installation.verifyAnchor(), configuration.label).resolves.toEqual(anchor);
        }
        await expect(users.findById(s.administrator.id)).resolves.toBeUndefined();
        await harness.service.stop();
      });

      it.each([
        { label: 'identity absent', remove: true },
        // Presente: sem a verificação na transacção, ou com ela depois dos conflitos, responderia `duplicate-id`.
        { label: 'identity present, before the conflict checks', remove: false },
      ])('[G24] re-checks the validated identity inside the transaction, not only the value read before it, $label', async ({ remove }) => {
        const { administrator, harness } = await initialised();
        if (remove) removeIdentityOutsideTheBoundary(administrator.id);
        const completedAt = await completedAtOf(harness);
        const anchor = await anchorOf(harness);
        const before = inspect(snapshot);
        // O identificador é lido uma vez pela verificação prévia e outra pela validação do candidato:
        // só a verificação na transacção vê o valor que seria escrito.
        let reads = 0;
        const shifting = {
          createdAt: completedAt,
          displayName: 'Impostor Fictício',
          get id(): string {
            reads += 1;
            return reads === 1 ? newId() : administrator.id;
          },
          status: 'ACTIVE',
          username: uniqueUsername('impostor'),
        };
        await expect(harness.service.identityProvisioning.users.create(shifting as unknown as User)).rejects.toBeInstanceOf(
          InitialAdministratorProtectedError,
        );
        expect(reads).toBe(2);
        expect(inspect(snapshot)).toEqual(before);
        await expect(anchorOf(harness)).resolves.toEqual(anchor);
      });

      it.each([
        { label: 'identity absent', remove: true },
        { label: 'identity present', remove: false },
      ])('[G24b] the prior check reads the identifier once: administrator first, ordinary afterwards is refused (RV-R4-01), $label', async ({ remove }) => {
        const { administrator, harness } = await initialised();
        if (remove) removeIdentityOutsideTheBoundary(administrator.id);
        const completedAt = await completedAtOf(harness);
        const anchor = await anchorOf(harness);
        const before = inspect(snapshot);
        // Com a verificação prévia a ler `id` duas vezes (mutação R4e), veria o administrador e depois um
        // identificador comum e deixaria passar a criação de uma identidade comum.
        let reads = 0;
        const shifting = {
          createdAt: completedAt,
          displayName: 'Impostor Fictício',
          get id(): string {
            reads += 1;
            return reads === 1 ? administrator.id : newId();
          },
          status: 'ACTIVE',
          username: uniqueUsername('impostor'),
        };
        await expect(harness.service.identityProvisioning.users.create(shifting as unknown as User)).rejects.toBeInstanceOf(
          InitialAdministratorProtectedError,
        );
        expect(reads).toBe(1);
        expect(inspect(snapshot)).toEqual(before);
        await expect(anchorOf(harness)).resolves.toEqual(anchor);
      });

      it('[G25] refuses the identifier before validation and conflicts with the identity present, deactivated or absent', async () => {
        const { administrator, harness } = await initialised({ session: true });
        const { users } = harness.service.identityProvisioning;
        const invalid = { ...administrator, username: '' } as unknown as User;
        // A verificação prévia normaliza o identificador como `parseUserId`: também em maiúsculas vem primeiro.
        const invalidUpperCase = { ...administrator, id: administrator.id.toUpperCase(), username: '' } as unknown as User;
        const states: readonly (readonly [string, () => void])[] = [
          ['present', () => undefined],
          ['deactivated (status changed by SQL, D-209)', () => inspect((database) => database.prepare("UPDATE users SET status = 'INACTIVE' WHERE id = ?").run(administrator.id))],
          ['absent', () => removeIdentityOutsideTheBoundary(administrator.id)],
        ];
        for (const [label, reach] of states) {
          reach();
          const before = inspect(snapshot);
          const anchor = await anchorOf(harness);
          // Sem a protecção prévia, `duplicate-id` (presente) ou a validação do candidato responderiam primeiro.
          await expect(users.create(newUser({ id: administrator.id })), label).rejects.toBeInstanceOf(InitialAdministratorProtectedError);
          await expect(users.create(invalid), label).rejects.toBeInstanceOf(InitialAdministratorProtectedError);
          await expect(users.create(invalidUpperCase), label).rejects.toBeInstanceOf(InitialAdministratorProtectedError);
          await expect(users.changeStatus(administrator.id, 'ACTIVE', clock.now().toISOString()), label).rejects.toBeInstanceOf(
            InitialAdministratorProtectedError,
          );
          expect(inspect(snapshot), label).toEqual(before);
          await expect(anchorOf(harness), label).resolves.toEqual(anchor);
        }
      });

      it('[G26] keeps the legitimate bootstrap and ordinary identity and company provisioning unchanged', async () => {
        const harness = await startedService();
        const { installation, users } = harness.service.identityProvisioning;
        // Antes da inicialização: criação comum e erros comuns, como sempre.
        const earlier = await provision(harness);
        await expect(users.create(newUser({ id: earlier.id }))).rejects.toMatchObject({ reason: 'duplicate-id' });
        await expect(users.create(newUser({ username: earlier.username }))).rejects.toMatchObject({ reason: 'duplicate-username' });
        await expect(users.create({ ...newUser(), username: '' })).rejects.toMatchObject({ name: 'DomainValidationError' });

        const input = { displayName: 'Administrador Fictício', id: newId(), username: uniqueUsername('admin') };
        const { initialAdministratorId } = await installation.initialise(input, TEST_PASSWORD);
        await expect(anchorOf(harness)).resolves.toMatchObject({ initialAdministratorId, state: 'intact' });
        await expect(harness.service.authentication.authenticate(input.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });
        await expect(installation.initialise({ ...input, id: newId(), username: uniqueUsername('admin') }, TEST_PASSWORD)).rejects.toMatchObject({
          reason: 'already-initialised',
        });

        // Depois: identidades comuns e os seus erros inalterados; o username do administrador continua ocupado.
        const ordinary = await provision(harness);
        await expect(harness.service.authentication.authenticate(ordinary.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });
        await expect(users.create(newUser({ id: ordinary.id }))).rejects.toMatchObject({ reason: 'duplicate-id' });
        await expect(users.create(newUser({ username: ordinary.username }))).rejects.toMatchObject({ reason: 'duplicate-username' });
        await expect(users.create(newUser({ username: input.username }))).rejects.toMatchObject({ reason: 'duplicate-username' });
        await users.changeStatus(ordinary.id, 'SUSPENDED', clock.now().toISOString());

        // Identidades empresariais: empresa, estabelecimento e associações para uma identidade comum.
        const company = newCompany();
        const context = contextFor(company.tenantId);
        await harness.service.companies.create(context, company);
        const branch = createBranch(branchInput(company));
        await harness.service.branches.create(context, branch);
        const membership = newCompanyMembership(ordinary, company, { scope: 'BRANCH_RESTRICTED' });
        await harness.service.companyMemberships.create(context, membership);
        await harness.service.branchMemberships.create(context, newBranchMembership(membership, branch));
        await expect(harness.service.companyMemberships.findById(context, membership.id)).resolves.toMatchObject({ userId: ordinary.id });
        await expect(anchorOf(harness)).resolves.toMatchObject({ initialAdministratorId, state: 'intact' });
      });

      it('[G27] does not reconstruct the protected identity through another identifier (boundary)', async () => {
        const { administrator, harness } = await initialised();
        removeIdentityOutsideTheBoundary(administrator.id);
        const anchor = { fault: 'administrator-missing', state: 'broken' };
        // Com a linha ausente, o username fica livre; uma identidade NOVA (outro identificador) é uma
        // identidade comum: não herda a credencial órfã nem repara a âncora.
        const successor = newUser({ username: administrator.username });
        await harness.service.identityProvisioning.users.create(successor);
        await expect(anchorOf(harness)).resolves.toEqual(anchor);
        await expect(harness.service.authentication.authenticate(administrator.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: false });
        expect(
          inspect((database) => database.prepare('SELECT count(*) FROM password_credentials WHERE user_id = ?').pluck().get(successor.id)),
        ).toBe(0);
        await expect(
          harness.service.identityProvisioning.users.create(newUser({ id: administrator.id, username: uniqueUsername('impostor') })),
        ).rejects.toBeInstanceOf(InitialAdministratorProtectedError);
        await expect(anchorOf(harness)).resolves.toEqual(anchor);
      });
    });
  });

  describe('installation anchor (fail-closed reference)', () => {
    it('[G07] reports uninitialised, then intact for the identity created by the bootstrap only', async () => {
      const harness = await startedService();
      await expect(harness.service.identityProvisioning.installation.verifyAnchor()).resolves.toEqual({ state: 'uninitialised' });
      const existing = await provision(harness);
      const input = { displayName: 'Administrador Fictício', id: newId(), username: uniqueUsername('admin') };
      await harness.service.identityProvisioning.installation.initialise(input, TEST_PASSWORD);
      const anchor = await harness.service.identityProvisioning.installation.verifyAnchor();
      expect(anchor).toEqual({ completedAt: clock.now().toISOString(), initialAdministratorId: input.id, state: 'intact' });
      expect(anchor).not.toMatchObject({ initialAdministratorId: existing.id });
      expect(Object.isFrozen(anchor)).toBe(true);
    });

    it('[G08] fails closed on a legacy database where the initial administrator was deleted, replaced or lost its credential', async () => {
      const scenario = async (tamper: (database: SqliteDatabase, s: IdentitySeed) => void) => {
        const { database } = fresh(MIGRATED_TO_7);
        const s = await seedIdentities(database);
        applyPragmas(database, CONFIGURATIONS[1]);
        tamper(database, s);
        applyPragmas(database, CONFIGURATIONS[0]);
        expect(runMigrations(database)).toEqual({ applied: [8, 9], currentVersion: 9 });
        const store = createSqliteAuthenticationStore(database);
        // O registo descritivo continua a mostrar o identificador; só a âncora o recusa.
        expect(store.readBootstrap()?.initialAdministratorId).toBe(s.administrator.id);
        return store.readInstallationAnchor();
      };

      await expect(
        scenario((database, s) => database.exec(`DELETE FROM users WHERE id = '${s.administrator.id}'`)),
      ).resolves.toEqual({ fault: 'administrator-missing', state: 'broken' });
      await expect(
        scenario((database, s) => database.exec(identityAttacks(s)['DELETE + INSERT initial administrator with the same id'] ?? '')),
      ).resolves.toEqual({ fault: 'administrator-mismatch', state: 'broken' });
      await expect(
        scenario((database, s) =>
          database.exec(`DROP TRIGGER password_credentials_never_deleted;
            DELETE FROM password_credentials WHERE user_id = '${s.administrator.id}'`),
        ),
      ).resolves.toEqual({ fault: 'administrator-credential-missing', state: 'broken' });
    });

    it('[G08b] the service verifyAnchor() fails closed on the same legacy databases and refuses credential provisioning for them', async () => {
      // E1.07-D3-G0-R1 (PD-81, mutação K06): a âncora é verificada pelo SERVIÇO em `READY`, depois de
      // ele próprio aplicar a migração 8, e não só directamente no armazenamento.
      const tampers: readonly (readonly [InstallationAnchorFault, (database: SqliteDatabase, s: IdentitySeed) => void])[] = [
        ['administrator-missing', (database, s) => database.exec(`DELETE FROM users WHERE id = '${s.administrator.id}'`)],
        [
          'administrator-mismatch',
          (database, s) => database.exec(identityAttacks(s)['DELETE + INSERT initial administrator with the same id'] ?? ''),
        ],
        [
          'administrator-credential-missing',
          (database, s) =>
            database.exec(`DROP TRIGGER password_credentials_never_deleted;
              DELETE FROM password_credentials WHERE user_id = '${s.administrator.id}'`),
        ],
      ];
      for (const [fault, tamper] of tampers) {
        const { database, temporary: own } = fresh(MIGRATED_TO_7);
        const s = await seedIdentities(database);
        applyPragmas(database, CONFIGURATIONS[1]);
        tamper(database, s);
        database.close();

        const harness = await startedService(own.filename);
        expect(harness.service.startupReport, fault).toMatchObject({ appliedMigrations: [8, 9], schemaVersion: 9 });
        const { installation, credentials } = harness.service.identityProvisioning;
        await expect(installation.verifyAnchor(), fault).resolves.toEqual({ fault, state: 'broken' });
        // O registo descritivo continua a mostrar o identificador; não é prova de nada.
        await expect(installation.status(), fault).resolves.toMatchObject({ initialAdministratorId: s.administrator.id, initialised: true });
        const before = inspectDatabase(own.filename, () => own.open(), snapshot);
        await expect(credentials.create(s.administrator.id, OTHER_TEST_PASSWORD), fault).rejects.toBeInstanceOf(
          InitialAdministratorProtectedError,
        );
        await expect(credentials.replace(s.administrator.id, OTHER_TEST_PASSWORD), fault).rejects.toBeInstanceOf(
          InitialAdministratorProtectedError,
        );
        expect(inspectDatabase(own.filename, () => own.open(), snapshot), fault).toEqual(before);
        await expect(installation.verifyAnchor(), fault).resolves.toEqual({ fault, state: 'broken' });
        await harness.service.stop();
      }
    });

    it('[G09] grants no installation or company authority to the initial administrator, even with an intact anchor', async () => {
      const harness = await startedService();
      const company = newCompany();
      const context = contextFor(company.tenantId);
      await harness.service.companies.create(context, company);
      const input = { displayName: 'Administrador Fictício', id: newId(), username: uniqueUsername('admin') };
      const { initialAdministratorId } = await harness.service.identityProvisioning.installation.initialise(input, TEST_PASSWORD);
      await expect(harness.service.identityProvisioning.installation.verifyAnchor()).resolves.toMatchObject({ state: 'intact' });

      const { domainEvaluator } = harness.service.internalAuthorization;
      const evaluate = (input: Parameters<typeof domainEvaluator.evaluate>[0]) => domainEvaluator.evaluate(input);
      for (const permissionCode of ['installation.users.provision', 'installation.companies.provision', 'installation.authorities.grant']) {
        await expect(
          evaluate({ permissionCode, scope: { kind: 'INSTALLATION' }, userId: initialAdministratorId }),
        ).resolves.toMatchObject({ outcome: 'DENIED', reason: 'no-installation-authority' });
      }
      for (const permissionCode of ['company.read', 'roles.manage', 'memberships.manage']) {
        await expect(
          evaluate({ permissionCode, scope: companyTarget(company), userId: initialAdministratorId }),
        ).resolves.toMatchObject({ outcome: 'DENIED' });
      }
      expect(
        inspect((database) =>
          ['company_memberships', 'branch_memberships', 'roles', 'role_permissions', 'role_assignments'].map(
            (table) => database.prepare(`SELECT count(*) FROM ${table}`).pluck().get(),
          ),
        ),
      ).toEqual([0, 0, 0, 0, 0]);
    });
  });

  describe('migration 8', () => {
    it('[G10] upgrades a migration-7 database with valid data without changing rows, sessions, credentials or checksums 1-7', async () => {
      const { database } = fresh(MIGRATED_TO_7);
      const s = await seedIdentities(database);
      const triggers = () => database.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name").pluck().all();
      const before = { rows: snapshot(database), triggers: triggers() };

      expect(inspectMigrations(database)).toMatchObject({ appliedVersions: [1, 2, 3, 4, 5, 6, 7], pendingVersions: [8, 9] });
      // Só a migração 8 (E1.07-D3-R1 acrescenta a 9, verificada à parte em installation-recovery.test.ts).
      expect(runMigrations(database, MIGRATIONS.slice(0, 8))).toEqual({ applied: [8], currentVersion: 8 });
      expect(snapshot(database)).toEqual(before.rows);
      expect(triggers()).toEqual([...before.triggers, ...MIGRATION_8_TRIGGERS].sort());
      expect(runMigrations(database)).toEqual({ applied: [9], currentVersion: 9 });
      expect(snapshot(database)).toEqual(before.rows);
      expect(database.prepare('SELECT checksum FROM schema_migrations WHERE version <= 7 ORDER BY version').pluck().all()).toEqual(
        PUBLISHED_CHECKSUMS_1_TO_7,
      );
      expect(MIGRATIONS.slice(0, 7).map(migrationChecksum)).toEqual(PUBLISHED_CHECKSUMS_1_TO_7);
      expect(MIGRATIONS[7]).toMatchObject({ name: 'protect_persistent_identities', version: 8 });
      expect(database.prepare('SELECT revoked_at FROM local_sessions WHERE id = ?').pluck().get(s.sessionId)).toBeNull();
      expect(database.prepare('PRAGMA integrity_check').pluck().get()).toBe('ok');
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(runMigrations(database)).toEqual({ applied: [], currentVersion: 9 });
      // A migração 8 só acrescenta triggers; não cria tabelas, colunas nem dados.
      expect(MIGRATIONS[7]?.sql.replace(/--.*$/gm, '')).not.toMatch(/\b(CREATE TABLE|ALTER TABLE|INSERT INTO|DROP)\b/i);
    });

    it('[G11] rolls back a failing migration 8 atomically and refuses migration 8 altered after it is applied', async () => {
      const { database } = fresh(MIGRATED_TO_7);
      await seedIdentities(database);
      const triggers = () => database.prepare("SELECT name FROM sqlite_schema WHERE type = 'trigger' ORDER BY name").pluck().all();
      const before = { rows: snapshot(database), triggers: triggers() };
      const latest = MIGRATIONS[7] as (typeof MIGRATIONS)[number];
      expect(() => runMigrations(database, [...MIGRATED_TO_7, { ...latest, sql: `${latest.sql}\nSELECT * FROM missing_table;` }])).toThrow(
        /missing_table/,
      );
      expect(inspectMigrations(database)).toMatchObject({ appliedVersions: [1, 2, 3, 4, 5, 6, 7], pendingVersions: [8, 9] });
      expect(triggers()).toEqual(before.triggers);
      expect(snapshot(database)).toEqual(before.rows);
      expect(runMigrations(database)).toEqual({ applied: [8, 9], currentVersion: 9 });
      expect(() => inspectMigrations(database, [...MIGRATED_TO_7, { ...latest, sql: `${latest.sql}\n` }])).toThrow(
        /migration-checksum-mismatch/,
      );
    });
  });

  describe('PD-76 pre-validation of legacy non-positive rowids', () => {
    const legacyDatabase = async (migrations: typeof MIGRATIONS) => {
      const connection = temporary.open();
      runMigrations(connection, migrations);
      const s = await seedIdentities(connection);
      const legacyUser = newUser();
      // Linhas com rowid não positivo só podem vir de SQL directo anterior à migração 7.
      if (migrations.length < 7) {
        connection
          .prepare(`INSERT INTO users (rowid, id, username, display_name, status, created_at, updated_at) VALUES (-1, ?, ?, 'Legado', 'ACTIVE', ?, ?)`)
          .run(legacyUser.id, legacyUser.username, CREATED_AT, CREATED_AT);
        connection
          .prepare(`INSERT INTO branch_memberships (rowid, id, company_membership_id, tenant_id, company_id, branch_id, status, created_at, updated_at)
            SELECT 0, ?, company_membership_id, tenant_id, company_id, ?, 'ACTIVE', created_at, updated_at FROM branch_memberships WHERE id = ?`)
          .run(randomUUID(), s.south.id, s.local.id);
      }
      return { connection, legacyUser, s };
    };

    it('[G12] lists the ten guarded tables and finds nothing in databases created by the application', async () => {
      expect(ROWID_GUARDED_TABLES).toEqual([
        'companies', 'branches', 'users', 'password_credentials', 'local_sessions',
        'company_memberships', 'branch_memberships', 'roles', 'role_permissions', 'role_assignments',
      ]);
      expect(Object.isFrozen(ROWID_GUARDED_TABLES)).toBe(true);
      const { database } = fresh();
      await seedIdentities(database);
      expect(findNonPositiveRowids(database)).toEqual([]);
      const { database: legacyV2 } = fresh(MIGRATIONS.slice(0, 2));
      expect(findNonPositiveRowids(legacyV2)).toEqual([]);
    });

    it('[G13] the local service refuses to migrate a database with legacy non-positive rowids, without renumbering or changing the file', async () => {
      const { connection, legacyUser } = await legacyDatabase(MIGRATIONS.slice(0, 6));
      expect(findNonPositiveRowids(connection)).toEqual([
        { rows: 1, table: 'users' },
        { rows: 1, table: 'branch_memberships' },
      ]);
      connection.close();
      const hashBefore = createHash('sha256').update(readFileSync(temporary.filename)).digest('hex');

      const harness = createServiceUnderTest(serviceConfig(temporary.filename), undefined, {
        clock: clock.now,
        passwordHashing: { parameters: TEST_HASHING_PARAMETERS },
      });
      running.push(harness);
      const failure: unknown = await harness.service.start().catch((error: unknown) => error);
      expect(failure).toMatchObject({ reason: 'legacy-rowid-incompatible' });
      expect((failure as { cause?: unknown }).cause).toBeInstanceOf(NonPositiveRowidError);
      expect(harness.service.state).toBe('FAILED');
      const refused = harness.records().find((record) => record['event'] === 'service.migration_preflight_refused');
      expect(refused).toMatchObject({ 'nonPositiveRowids.branch_memberships': 1, 'nonPositiveRowids.users': 1 });
      expect(harness.lines.join('\n')).not.toContain(legacyUser.id);
      expect(harness.lines.join('\n')).not.toContain(legacyUser.username);
      await harness.service.stop();

      expect(createHash('sha256').update(readFileSync(temporary.filename)).digest('hex')).toBe(hashBefore);
      const reopened = temporary.open();
      expect(inspectMigrations(reopened)).toMatchObject({ appliedVersions: [1, 2, 3, 4, 5, 6], pendingVersions: [7, 8, 9] });
      expect(reopened.prepare('SELECT id FROM users WHERE rowid = -1').pluck().get()).toBe(legacyUser.id);
      reopened.close();
    });

    it('[G14] also refuses migration 8 on a migration-7 database that kept legacy rows, and ranks the strict policy first', async () => {
      const connection = temporary.open();
      runMigrations(connection, MIGRATIONS.slice(0, 6));
      const legacyUser = newUser();
      connection
        .prepare(`INSERT INTO users (rowid, id, username, display_name, status, created_at, updated_at) VALUES (-5, ?, ?, 'Legado', 'ACTIVE', ?, ?)`)
        .run(legacyUser.id, legacyUser.username, CREATED_AT, CREATED_AT);
      runMigrations(connection, MIGRATED_TO_7);
      connection.close();

      const strict = createServiceUnderTest(
        serviceConfig(temporary.filename, { startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'fail' } }),
      );
      running.push(strict);
      await expect(strict.service.start()).rejects.toMatchObject({ reason: 'pending-migrations' });
      const applying = createServiceUnderTest(serviceConfig(temporary.filename));
      running.push(applying);
      await expect(applying.service.start()).rejects.toMatchObject({ reason: 'legacy-rowid-incompatible' });
      await applying.service.stop();
      const reopened = temporary.open();
      expect(inspectMigrations(reopened)).toMatchObject({ pendingVersions: [8, 9] });
      reopened.close();
    });

    it('[G15] starts normally and migrates a clean database created by the application', async () => {
      const connection = temporary.open();
      runMigrations(connection, MIGRATED_TO_7);
      await seedIdentities(connection);
      connection.close();
      const harness = await startedService();
      expect(harness.service.startupReport).toMatchObject({ appliedMigrations: [8, 9], schemaVersion: 9 });
      expect(harness.records().some((record) => record['event'] === 'service.migration_preflight_refused')).toBe(false);
    });
  });
});
