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

// E1.07-A (D-086): identidades locais e associações. Só acrescenta objectos; não altera dados nem
// tabelas existentes. O índice único sobre `branches` permite a chave estrangeira composta que
// garante que um estabelecimento associado pertence à mesma empresa e ao mesmo tenant.
const V2_USERS_AND_MEMBERSHIPS = `
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL CHECK (
    length(username) BETWEEN 3 AND 64 AND username = lower(username) AND username NOT GLOB '*[^a-z0-9._-]*'
  ),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  email TEXT CHECK (email IS NULL OR length(trim(email)) > 0),
  phone TEXT CHECK (phone IS NULL OR length(trim(phone)) > 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT users_username_unique UNIQUE (username),
  CONSTRAINT users_chronology CHECK (updated_at >= created_at)
) STRICT;

CREATE UNIQUE INDEX branches_id_tenant_company_unique ON branches (id, tenant_id, company_id);

CREATE TABLE company_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('COMPANY_WIDE', 'BRANCH_RESTRICTED')),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT company_memberships_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES companies (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT company_memberships_user_tenant_unique UNIQUE (user_id, tenant_id),
  CONSTRAINT company_memberships_id_tenant_company_unique UNIQUE (id, tenant_id, company_id),
  CONSTRAINT company_memberships_chronology CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX company_memberships_tenant_company_idx ON company_memberships (tenant_id, company_id);

CREATE TABLE branch_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  company_membership_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT branch_memberships_membership_fk FOREIGN KEY (company_membership_id, tenant_id, company_id)
    REFERENCES company_memberships (id, tenant_id, company_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT branch_memberships_branch_fk FOREIGN KEY (branch_id, tenant_id, company_id)
    REFERENCES branches (id, tenant_id, company_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT branch_memberships_unique UNIQUE (company_membership_id, branch_id),
  CONSTRAINT branch_memberships_chronology CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX branch_memberships_tenant_membership_idx ON branch_memberships (tenant_id, company_membership_id);
`;

// E1.07-B (D-092, D-094, D-095): credenciais, controlo de tentativas e estado de inicialização.
// Só acrescenta tabelas. As credenciais ficam fora de `users`; não existe palavra-passe em texto.
const V3_CREDENTIALS_AND_AUTHENTICATION = `
CREATE TABLE password_credentials (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  algorithm TEXT NOT NULL CHECK (algorithm = 'argon2id'),
  algorithm_version INTEGER NOT NULL CHECK (algorithm_version = 19),
  memory_kib INTEGER NOT NULL CHECK (memory_kib BETWEEN 19456 AND 1048576),
  passes INTEGER NOT NULL CHECK (passes BETWEEN 1 AND 16),
  parallelism INTEGER NOT NULL CHECK (parallelism BETWEEN 1 AND 16),
  salt BLOB NOT NULL CHECK (length(salt) BETWEEN 16 AND 64),
  hash BLOB NOT NULL CHECK (length(hash) BETWEEN 32 AND 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT password_credentials_memory_per_lane CHECK (memory_kib >= 8 * parallelism),
  CONSTRAINT password_credentials_chronology CHECK (updated_at >= created_at)
) STRICT;

CREATE TABLE authentication_throttle (
  throttle_key TEXT PRIMARY KEY NOT NULL CHECK (
    throttle_key = 'instance' OR (throttle_key GLOB 'user:*' AND length(throttle_key) = 69)
  ),
  failures INTEGER NOT NULL CHECK (failures >= 0),
  window_started_at TEXT NOT NULL,
  locked_until TEXT,
  last_attempt_at TEXT NOT NULL
) STRICT;

CREATE INDEX authentication_throttle_last_attempt_idx ON authentication_throttle (last_attempt_at);

CREATE TABLE installation_bootstrap (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  initial_administrator_id TEXT NOT NULL REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  completed_at TEXT NOT NULL
) STRICT;
`;

// E1.07-C: versões de segurança e sessões locais. Não destrutiva: só acrescenta colunas com valor
// inicial 1 (identidades e credenciais existentes ficam na versão 1, sem tocar em hashes), uma
// tabela, índices e triggers. Os triggers tornam as versões monotónicas e garantem, na mesma
// instrução SQL, que qualquer alteração de estado da identidade ou da credencial avança a versão
// e revoga as sessões afectadas, seja qual for o caminho de escrita (D-110, D-111).
const V4_SESSIONS_AND_SECURITY_VERSIONS = `
ALTER TABLE users ADD COLUMN security_version INTEGER NOT NULL DEFAULT 1 CHECK (security_version >= 1);

ALTER TABLE password_credentials ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 1 CHECK (credential_version >= 1);

CREATE TABLE local_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  token_digest BLOB NOT NULL CHECK (length(token_digest) = 32),
  security_version INTEGER NOT NULL CHECK (security_version >= 1),
  credential_version INTEGER NOT NULL CHECK (credential_version >= 1),
  service_run_id TEXT NOT NULL CHECK (length(service_run_id) = 32 AND service_run_id NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  absolute_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT CHECK (revocation_reason IS NULL OR revocation_reason IN (
    'logout', 'administrative', 'user-sessions-revoked', 'identity-status-changed', 'credential-replaced',
    'security-version-changed', 'service-restarted', 'idle-timeout', 'absolute-timeout'
  )),
  CONSTRAINT local_sessions_token_digest_unique UNIQUE (token_digest),
  CONSTRAINT local_sessions_revocation_complete CHECK ((revoked_at IS NULL) = (revocation_reason IS NULL)),
  CONSTRAINT local_sessions_lifetime CHECK (absolute_expires_at > created_at),
  CONSTRAINT local_sessions_activity_window CHECK (last_activity_at >= created_at AND last_activity_at <= absolute_expires_at)
) STRICT;

CREATE INDEX local_sessions_active_user_idx ON local_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX local_sessions_active_run_idx ON local_sessions (service_run_id) WHERE revoked_at IS NULL;
CREATE INDEX local_sessions_ended_idx ON local_sessions (revoked_at) WHERE revoked_at IS NOT NULL;

CREATE TRIGGER local_sessions_binding_immutable
BEFORE UPDATE OF id, user_id, token_digest, security_version, credential_version, service_run_id, created_at,
  absolute_expires_at ON local_sessions
BEGIN
  SELECT RAISE(ABORT, 'local_sessions binding is immutable');
END;

CREATE TRIGGER local_sessions_revocation_final
BEFORE UPDATE OF revoked_at, revocation_reason ON local_sessions
WHEN OLD.revoked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'local_sessions revocation is final');
END;

CREATE TRIGGER local_sessions_activity_monotonic
BEFORE UPDATE OF last_activity_at ON local_sessions
WHEN OLD.revoked_at IS NOT NULL OR NEW.last_activity_at < OLD.last_activity_at
BEGIN
  SELECT RAISE(ABORT, 'local_sessions activity cannot move backwards or follow revocation');
END;

CREATE TRIGGER users_security_version_monotonic
BEFORE UPDATE OF security_version ON users
WHEN NEW.security_version < OLD.security_version
BEGIN
  SELECT RAISE(ABORT, 'users security_version cannot decrease');
END;

CREATE TRIGGER users_status_change_revokes_sessions
AFTER UPDATE OF status ON users
WHEN NEW.status IS NOT OLD.status
BEGIN
  UPDATE local_sessions SET revoked_at = NEW.updated_at, revocation_reason = 'identity-status-changed'
    WHERE user_id = NEW.id AND revoked_at IS NULL;
  UPDATE users SET security_version = max(NEW.security_version, OLD.security_version + 1) WHERE id = NEW.id;
END;

CREATE TRIGGER users_security_version_revokes_sessions
AFTER UPDATE OF security_version ON users
WHEN NEW.security_version > OLD.security_version
BEGIN
  UPDATE local_sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    revocation_reason = 'security-version-changed'
    WHERE user_id = NEW.id AND revoked_at IS NULL;
END;

CREATE TRIGGER password_credentials_version_monotonic
BEFORE UPDATE OF credential_version ON password_credentials
WHEN NEW.credential_version < OLD.credential_version
BEGIN
  SELECT RAISE(ABORT, 'password_credentials credential_version cannot decrease');
END;

CREATE TRIGGER password_credentials_change_requires_new_version
BEFORE UPDATE ON password_credentials
WHEN NEW.credential_version <= OLD.credential_version AND (
  NEW.user_id IS NOT OLD.user_id OR NEW.hash IS NOT OLD.hash OR NEW.salt IS NOT OLD.salt
  OR NEW.algorithm IS NOT OLD.algorithm OR NEW.algorithm_version IS NOT OLD.algorithm_version
  OR NEW.memory_kib IS NOT OLD.memory_kib OR NEW.passes IS NOT OLD.passes OR NEW.parallelism IS NOT OLD.parallelism
)
BEGIN
  SELECT RAISE(ABORT, 'password_credentials change requires a new credential_version');
END;

CREATE TRIGGER password_credentials_version_revokes_sessions
AFTER UPDATE OF credential_version ON password_credentials
WHEN NEW.credential_version > OLD.credential_version
BEGIN
  UPDATE local_sessions SET revoked_at = NEW.updated_at, revocation_reason = 'credential-replaced'
    WHERE user_id = NEW.user_id AND revoked_at IS NULL;
END;

CREATE TRIGGER password_credentials_never_deleted
BEFORE DELETE ON password_credentials
BEGIN
  SELECT RAISE(ABORT, 'password_credentials are replaced, never deleted');
END;
`;

// E1.07-C-R1 (PD-46, D-126): integridade das versões de segurança contra reinserções. A eliminação
// implícita de `INSERT OR REPLACE`/`REPLACE` só activa triggers DELETE com `recursive_triggers`
// ligado, e a de `users` só é travada pelas chaves estrangeiras quando `foreign_keys` está ligado.
// Os triggers BEFORE INSERT correm antes da resolução de conflitos, em qualquer configuração:
// - uma identidade, credencial ou sessão existente nunca é reinserida (REPLACE, UPSERT ou INSERT
//   repetido), pelo que nenhuma versão é reposta e nenhuma revogação é anulada;
// - uma linha reinserida depois de uma eliminação nunca reutiliza uma versão já ligada a sessões
//   da identidade, e qualquer sessão ainda activa dessa identidade é revogada;
// - as chaves das identidades e das credenciais são imutáveis.
// As recusas de reinserção antecipam as falhas UNIQUE/PRIMARY KEY e, como elas, indicam uma falha de
// restrição (`SQLITE_CONSTRAINT_TRIGGER`, `PersistenceError('constraint')`).
// Só acrescenta triggers: não altera tabelas, dados nem as migrações 1 a 4. Não protege contra quem
// controle o esquema (eliminar triggers, `writable_schema`) ou escreva sessões directamente.
const V5_SECURITY_VERSION_REINSERTION = `
CREATE TRIGGER users_insert_requires_new_identity
BEFORE INSERT ON users
WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.id OR username = NEW.username)
  OR NEW.security_version <= (SELECT max(security_version) FROM local_sessions WHERE user_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: users are never re-inserted and never reuse a security_version');
END;

CREATE TRIGGER users_insert_revokes_sessions
AFTER INSERT ON users
BEGIN
  UPDATE local_sessions SET revoked_at = NEW.updated_at, revocation_reason = 'security-version-changed'
    WHERE user_id = NEW.id AND revoked_at IS NULL;
END;

CREATE TRIGGER users_id_immutable
BEFORE UPDATE OF id ON users
WHEN NEW.id IS NOT OLD.id
BEGIN
  SELECT RAISE(ABORT, 'users id is immutable');
END;

CREATE TRIGGER password_credentials_insert_requires_new_credential
BEFORE INSERT ON password_credentials
WHEN EXISTS (SELECT 1 FROM password_credentials WHERE user_id = NEW.user_id)
  OR NEW.credential_version <= (SELECT max(credential_version) FROM local_sessions WHERE user_id = NEW.user_id)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: password_credentials are never re-inserted and never reuse a credential_version');
END;

CREATE TRIGGER password_credentials_insert_revokes_sessions
AFTER INSERT ON password_credentials
BEGIN
  UPDATE local_sessions SET revoked_at = NEW.updated_at, revocation_reason = 'credential-replaced'
    WHERE user_id = NEW.user_id AND revoked_at IS NULL;
END;

CREATE TRIGGER password_credentials_user_immutable
BEFORE UPDATE OF user_id ON password_credentials
WHEN NEW.user_id IS NOT OLD.user_id
BEGIN
  SELECT RAISE(ABORT, 'password_credentials user_id is immutable');
END;

CREATE TRIGGER local_sessions_insert_requires_new_session
BEFORE INSERT ON local_sessions
WHEN EXISTS (SELECT 1 FROM local_sessions WHERE id = NEW.id OR token_digest = NEW.token_digest)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: local_sessions are never re-inserted');
END;
`;

// E1.07-D2 (D-179 a D-183): perfis, concessões e atribuições RBAC por tenant. Só acrescenta tabelas,
// índices e triggers; não altera tabelas, dados nem as migrações 1 a 5, e não cria perfis, concessões
// nem atribuições (nenhum privilégio implícito).
// - Chaves estrangeiras compostas com `tenant_id` (e `company_id`) impedem relações entre tenants,
//   sempre `ON DELETE RESTRICT`, sem cascatas.
// - O catálogo de permissões continua em código (D-149): não há tabela de permissões. A base só
//   impõe a gramática básica do código e recusa os prefixos da instalação e da plataforma; a
//   admissibilidade no catálogo oficial é verificada pela aplicação. `catalog_version` regista a
//   versão do catálogo oficial em que a concessão foi feita (D-181).
// - A unicidade das atribuições usa dois índices únicos parciais: com `branch_id` nulo, um UNIQUE
//   convencional admitiria duplicados `COMPANY_WIDE`. Não depende do estado (reactivar, não duplicar).
// - Os triggers BEFORE INSERT correm antes da resolução de conflitos e da verificação das chaves
//   estrangeiras, em qualquer configuração de `foreign_keys`/`recursive_triggers`: recusam
//   reinserções (REPLACE, UPSERT) e referências inexistentes, contraditórias ou de outro tenant, e
//   exigem, na criação e na reactivação de uma atribuição, perfil, associação e estabelecimento activos
//   e um âmbito contido no da associação.
// Fronteira de confiança (como D-126): protege contra defeitos da aplicação e escritas SQL pela
// ligação normal; não protege contra quem controle o esquema ou o ficheiro.
const V6_RBAC_ROLES_PERMISSIONS_ASSIGNMENTS = `
CREATE TABLE roles (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK (
    length(code) BETWEEN 2 AND 64 AND code = upper(code) AND code GLOB '[A-Z]*' AND code NOT GLOB '*[^A-Z0-9_-]*'
  ),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT CHECK (description IS NULL OR length(trim(description)) > 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT roles_company_fk FOREIGN KEY (company_id, tenant_id)
    REFERENCES companies (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT roles_code_unique_per_tenant UNIQUE (tenant_id, code),
  CONSTRAINT roles_id_tenant_unique UNIQUE (id, tenant_id),
  CONSTRAINT roles_id_tenant_company_unique UNIQUE (id, tenant_id, company_id),
  CONSTRAINT roles_chronology CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX roles_tenant_company_idx ON roles (tenant_id, company_id);

CREATE TABLE role_permissions (
  tenant_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  permission_code TEXT NOT NULL CHECK (
    length(permission_code) BETWEEN 3 AND 96
    AND permission_code NOT GLOB '*[^a-z0-9._]*'
    AND length(permission_code) - length(replace(permission_code, '.', '')) BETWEEN 1 AND 3
    AND ('.' || permission_code) NOT GLOB '*.[^a-z]*'
    AND (permission_code || '.') NOT GLOB '*[._].*'
    AND permission_code NOT GLOB '*.'
    AND permission_code NOT GLOB '*__*'
    AND ('.' || permission_code || '.') NOT GLOB '*.all.*'
    AND ('.' || permission_code || '.') NOT GLOB '*.any.*'
    AND permission_code NOT GLOB 'installation.*'
    AND permission_code NOT GLOB 'platform.*'
  ),
  catalog_version INTEGER NOT NULL CHECK (catalog_version >= 1),
  created_at TEXT NOT NULL,
  CONSTRAINT role_permissions_pk PRIMARY KEY (tenant_id, role_id, permission_code),
  CONSTRAINT role_permissions_role_fk FOREIGN KEY (role_id, tenant_id)
    REFERENCES roles (id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE INDEX role_permissions_role_idx ON role_permissions (role_id, tenant_id);

CREATE TABLE role_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  company_membership_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('COMPANY_WIDE', 'BRANCH')),
  branch_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT role_assignments_role_fk FOREIGN KEY (role_id, tenant_id, company_id)
    REFERENCES roles (id, tenant_id, company_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT role_assignments_membership_fk FOREIGN KEY (company_membership_id, tenant_id, company_id)
    REFERENCES company_memberships (id, tenant_id, company_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT role_assignments_branch_fk FOREIGN KEY (branch_id, tenant_id, company_id)
    REFERENCES branches (id, tenant_id, company_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT role_assignments_scope_branch CHECK (
    (scope = 'COMPANY_WIDE' AND branch_id IS NULL) OR (scope = 'BRANCH' AND branch_id IS NOT NULL)
  ),
  CONSTRAINT role_assignments_chronology CHECK (updated_at >= created_at)
) STRICT;

CREATE UNIQUE INDEX role_assignments_company_wide_unique
  ON role_assignments (tenant_id, company_membership_id, role_id) WHERE scope = 'COMPANY_WIDE';
CREATE UNIQUE INDEX role_assignments_branch_unique
  ON role_assignments (tenant_id, company_membership_id, role_id, branch_id) WHERE scope = 'BRANCH';
CREATE INDEX role_assignments_membership_idx ON role_assignments (tenant_id, company_membership_id);
CREATE INDEX role_assignments_role_idx ON role_assignments (tenant_id, role_id);

CREATE TRIGGER roles_insert_requires_new_role_in_company
BEFORE INSERT ON roles
WHEN EXISTS (SELECT 1 FROM roles WHERE id = NEW.id OR (tenant_id = NEW.tenant_id AND code = NEW.code))
  OR NOT EXISTS (SELECT 1 FROM companies WHERE id = NEW.company_id AND tenant_id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: roles are never re-inserted and belong to a company of the same tenant');
END;

CREATE TRIGGER roles_identity_immutable
BEFORE UPDATE OF id, tenant_id, company_id, code, created_at ON roles
WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.company_id IS NOT OLD.company_id
  OR NEW.code IS NOT OLD.code OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: roles id, tenant, company, code and creation are immutable');
END;

CREATE TRIGGER roles_never_deleted
BEFORE DELETE ON roles
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: roles are deactivated, never deleted');
END;

CREATE TRIGGER role_permissions_insert_requires_new_grant_on_tenant_role
BEFORE INSERT ON role_permissions
WHEN EXISTS (
    SELECT 1 FROM role_permissions
    WHERE tenant_id = NEW.tenant_id AND role_id = NEW.role_id AND permission_code = NEW.permission_code
  )
  OR NOT EXISTS (SELECT 1 FROM roles WHERE id = NEW.role_id AND tenant_id = NEW.tenant_id)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: role_permissions are never re-inserted and require a role of the same tenant');
END;

CREATE TRIGGER role_permissions_immutable
BEFORE UPDATE ON role_permissions
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: role_permissions are immutable; revoke and grant instead');
END;

CREATE TRIGGER role_assignments_insert_requires_new_eligible_assignment
BEFORE INSERT ON role_assignments
WHEN EXISTS (
    SELECT 1 FROM role_assignments
    WHERE id = NEW.id OR (
      tenant_id = NEW.tenant_id AND company_membership_id = NEW.company_membership_id AND role_id = NEW.role_id
      AND scope = NEW.scope AND branch_id IS NEW.branch_id
    )
  )
  OR NOT (
    EXISTS (
      SELECT 1 FROM roles
      WHERE id = NEW.role_id AND tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND status = 'ACTIVE'
    )
    AND EXISTS (
      SELECT 1 FROM company_memberships AS m
      WHERE m.id = NEW.company_membership_id AND m.tenant_id = NEW.tenant_id AND m.company_id = NEW.company_id
        AND m.status = 'ACTIVE'
        AND (
          (NEW.scope = 'COMPANY_WIDE' AND NEW.branch_id IS NULL AND m.scope = 'COMPANY_WIDE')
          OR (
            NEW.scope = 'BRANCH' AND EXISTS (
              SELECT 1 FROM branches AS b
              WHERE b.id = NEW.branch_id AND b.tenant_id = NEW.tenant_id AND b.company_id = NEW.company_id
                AND b.status = 'ACTIVE'
            )
            AND (
              m.scope = 'COMPANY_WIDE' OR EXISTS (
                SELECT 1 FROM branch_memberships AS l
                WHERE l.company_membership_id = m.id AND l.tenant_id = NEW.tenant_id AND l.company_id = NEW.company_id
                  AND l.branch_id = NEW.branch_id AND l.status = 'ACTIVE'
              )
            )
          )
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: role_assignments are never re-inserted and require active, same-tenant references within the membership scope');
END;

CREATE TRIGGER role_assignments_binding_immutable
BEFORE UPDATE OF id, tenant_id, company_id, role_id, company_membership_id, scope, branch_id, created_at
  ON role_assignments
WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.company_id IS NOT OLD.company_id
  OR NEW.role_id IS NOT OLD.role_id OR NEW.company_membership_id IS NOT OLD.company_membership_id
  OR NEW.scope IS NOT OLD.scope OR NEW.branch_id IS NOT OLD.branch_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: role_assignments references are immutable');
END;

CREATE TRIGGER role_assignments_reactivation_requires_eligibility
BEFORE UPDATE OF status ON role_assignments
WHEN NEW.status = 'ACTIVE' AND OLD.status <> 'ACTIVE' AND NOT (
  EXISTS (
    SELECT 1 FROM roles
    WHERE id = OLD.role_id AND tenant_id = OLD.tenant_id AND company_id = OLD.company_id AND status = 'ACTIVE'
  )
  AND EXISTS (
    SELECT 1 FROM company_memberships AS m
    WHERE m.id = OLD.company_membership_id AND m.tenant_id = OLD.tenant_id AND m.company_id = OLD.company_id
      AND m.status = 'ACTIVE'
      AND (
        (OLD.scope = 'COMPANY_WIDE' AND m.scope = 'COMPANY_WIDE')
        OR (
          OLD.scope = 'BRANCH' AND EXISTS (
            SELECT 1 FROM branches AS b
            WHERE b.id = OLD.branch_id AND b.tenant_id = OLD.tenant_id AND b.company_id = OLD.company_id
              AND b.status = 'ACTIVE'
          )
          AND (
            m.scope = 'COMPANY_WIDE' OR EXISTS (
              SELECT 1 FROM branch_memberships AS l
              WHERE l.company_membership_id = m.id AND l.tenant_id = OLD.tenant_id AND l.company_id = OLD.company_id
                AND l.branch_id = OLD.branch_id AND l.status = 'ACTIVE'
            )
          )
        )
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: role_assignments reactivation requires active, same-tenant references within the membership scope');
END;

CREATE TRIGGER role_assignments_never_deleted
BEFORE DELETE ON role_assignments
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: role_assignments are deactivated, never deleted');
END;
`;

// E1.07-D2-R1 (PD-69, PD-70): fecha os caminhos de substituicao por `rowid` e leva para o esquema
// as identidades imutaveis que os repositorios ja aplicam. `REPLACE` pode eliminar implicitamente
// a linha que colide por `rowid` sem executar triggers DELETE quando `recursive_triggers` esta
// desligado; por isso as guardas correm antes do INSERT/UPDATE e nao dependem de foreign_keys nem
// de recursive_triggers. As associacoes empresariais e locais tambem recusam reinsercao e mudanca
// de titular/ligacoes, impedindo que atribuicoes existentes sejam transferidas para outra identidade,
// empresa ou filial por SQL directo. So acrescenta triggers; nao altera dados nem as migracoes 1-6.
// A fronteira de confianca mantem-se: quem controla o esquema ou o ficheiro pode remover triggers.
// E1.07-D2-R3 (PD-70, PD-72; migracao 7 ainda nao integrada, corrigida no proprio ficheiro):
// - as associacoes empresariais sao desactivadas, nunca eliminadas: com foreign_keys desligado,
//   DELETE seguido de INSERT com o mesmo id e outro titular transferia as atribuicoes;
// - num BEFORE INSERT sem rowid explicito, NEW.rowid e indefinido (-1 no SQLite 3.53.2) e igual ao
//   de um rowid -1 explicito. As guardas por rowid so comparam rowids positivos, e o AFTER INSERT,
//   onde NEW.rowid e o valor real, recusa rowids nao positivos. Assim um rowid explicito ocupado e
//   sempre recusado, e uma linha com rowid -1 nao bloqueia as insercoes normais.
const V7_HARDEN_RBAC_REPLACEMENT_AND_PARENT_BINDINGS = `
CREATE TRIGGER companies_insert_requires_new_company
BEFORE INSERT ON companies
WHEN EXISTS (
  SELECT 1 FROM companies WHERE (NEW.rowid > 0 AND rowid = NEW.rowid) OR id = NEW.id OR tenant_id = NEW.tenant_id
)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: companies are never re-inserted');
END;

CREATE TRIGGER companies_identity_immutable
BEFORE UPDATE ON companies
WHEN NEW.rowid IS NOT OLD.rowid OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: companies rowid, id, tenant and creation are immutable');
END;

CREATE TRIGGER branches_insert_requires_new_branch
BEFORE INSERT ON branches
WHEN EXISTS (
  SELECT 1 FROM branches
  WHERE (NEW.rowid > 0 AND rowid = NEW.rowid) OR id = NEW.id OR (company_id = NEW.company_id AND code = NEW.code)
)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: branches are never re-inserted');
END;

CREATE TRIGGER branches_identity_immutable
BEFORE UPDATE ON branches
WHEN NEW.rowid IS NOT OLD.rowid OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id
  OR NEW.company_id IS NOT OLD.company_id OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: branches rowid, id, tenant, company and creation are immutable');
END;

CREATE TRIGGER users_rowid_insert_requires_new_identity
BEFORE INSERT ON users
WHEN NEW.rowid > 0 AND EXISTS (SELECT 1 FROM users WHERE rowid = NEW.rowid)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: users rowid is never re-used');
END;

CREATE TRIGGER users_rowid_immutable
BEFORE UPDATE ON users
WHEN NEW.rowid IS NOT OLD.rowid
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: users rowid is immutable');
END;

CREATE TRIGGER password_credentials_rowid_insert_requires_new_credential
BEFORE INSERT ON password_credentials
WHEN NEW.rowid > 0 AND EXISTS (SELECT 1 FROM password_credentials WHERE rowid = NEW.rowid)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: password_credentials rowid is never re-used');
END;

CREATE TRIGGER password_credentials_rowid_immutable
BEFORE UPDATE ON password_credentials
WHEN NEW.rowid IS NOT OLD.rowid
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: password_credentials rowid is immutable');
END;

CREATE TRIGGER local_sessions_rowid_insert_requires_new_session
BEFORE INSERT ON local_sessions
WHEN NEW.rowid > 0 AND EXISTS (SELECT 1 FROM local_sessions WHERE rowid = NEW.rowid)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: local_sessions rowid is never re-used');
END;

CREATE TRIGGER local_sessions_rowid_immutable
BEFORE UPDATE ON local_sessions
WHEN NEW.rowid IS NOT OLD.rowid
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: local_sessions rowid is immutable');
END;

CREATE TRIGGER company_memberships_insert_requires_new_membership
BEFORE INSERT ON company_memberships
WHEN EXISTS (
  SELECT 1 FROM company_memberships
  WHERE (NEW.rowid > 0 AND rowid = NEW.rowid) OR id = NEW.id OR (user_id = NEW.user_id AND tenant_id = NEW.tenant_id)
)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: company_memberships are never re-inserted');
END;

CREATE TRIGGER company_memberships_binding_immutable
BEFORE UPDATE ON company_memberships
WHEN NEW.rowid IS NOT OLD.rowid OR NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id
  OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.company_id IS NOT OLD.company_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: company_memberships owner and references are immutable');
END;

CREATE TRIGGER company_memberships_never_deleted
BEFORE DELETE ON company_memberships
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: company_memberships are deactivated, never deleted');
END;

CREATE TRIGGER branch_memberships_insert_requires_new_membership
BEFORE INSERT ON branch_memberships
WHEN EXISTS (
  SELECT 1 FROM branch_memberships
  WHERE (NEW.rowid > 0 AND rowid = NEW.rowid) OR id = NEW.id
    OR (company_membership_id = NEW.company_membership_id AND branch_id = NEW.branch_id)
)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: branch_memberships are never re-inserted');
END;

CREATE TRIGGER branch_memberships_binding_immutable
BEFORE UPDATE ON branch_memberships
WHEN NEW.rowid IS NOT OLD.rowid OR NEW.id IS NOT OLD.id
  OR NEW.company_membership_id IS NOT OLD.company_membership_id OR NEW.tenant_id IS NOT OLD.tenant_id
  OR NEW.company_id IS NOT OLD.company_id OR NEW.branch_id IS NOT OLD.branch_id
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: branch_memberships references are immutable');
END;

CREATE TRIGGER roles_rowid_insert_requires_new_role
BEFORE INSERT ON roles
WHEN NEW.rowid > 0 AND EXISTS (SELECT 1 FROM roles WHERE rowid = NEW.rowid)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: roles rowid is never re-used');
END;

CREATE TRIGGER roles_rowid_immutable
BEFORE UPDATE ON roles
WHEN NEW.rowid IS NOT OLD.rowid
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: roles rowid is immutable');
END;

CREATE TRIGGER role_permissions_rowid_insert_requires_new_grant
BEFORE INSERT ON role_permissions
WHEN NEW.rowid > 0 AND EXISTS (SELECT 1 FROM role_permissions WHERE rowid = NEW.rowid)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: role_permissions rowid is never re-used');
END;

CREATE TRIGGER role_permissions_rowid_immutable
BEFORE UPDATE ON role_permissions
WHEN NEW.rowid IS NOT OLD.rowid
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: role_permissions rowid is immutable');
END;

CREATE TRIGGER role_assignments_rowid_insert_requires_new_assignment
BEFORE INSERT ON role_assignments
WHEN NEW.rowid > 0 AND EXISTS (SELECT 1 FROM role_assignments WHERE rowid = NEW.rowid)
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: role_assignments rowid is never re-used');
END;

CREATE TRIGGER role_assignments_rowid_immutable
BEFORE UPDATE ON role_assignments
WHEN NEW.rowid IS NOT OLD.rowid
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: role_assignments rowid is immutable');
END;

CREATE TRIGGER companies_rowid_positive AFTER INSERT ON companies WHEN NEW.rowid <= 0
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: companies rowid must be positive');
END;

CREATE TRIGGER branches_rowid_positive AFTER INSERT ON branches WHEN NEW.rowid <= 0
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: branches rowid must be positive');
END;

CREATE TRIGGER users_rowid_positive AFTER INSERT ON users WHEN NEW.rowid <= 0
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: users rowid must be positive');
END;

CREATE TRIGGER password_credentials_rowid_positive AFTER INSERT ON password_credentials WHEN NEW.rowid <= 0
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: password_credentials rowid must be positive');
END;

CREATE TRIGGER local_sessions_rowid_positive AFTER INSERT ON local_sessions WHEN NEW.rowid <= 0
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: local_sessions rowid must be positive');
END;

CREATE TRIGGER company_memberships_rowid_positive AFTER INSERT ON company_memberships WHEN NEW.rowid <= 0
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: company_memberships rowid must be positive');
END;

CREATE TRIGGER branch_memberships_rowid_positive AFTER INSERT ON branch_memberships WHEN NEW.rowid <= 0
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: branch_memberships rowid must be positive');
END;

CREATE TRIGGER roles_rowid_positive AFTER INSERT ON roles WHEN NEW.rowid <= 0
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: roles rowid must be positive');
END;

CREATE TRIGGER role_permissions_rowid_positive AFTER INSERT ON role_permissions WHEN NEW.rowid <= 0
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: role_permissions rowid must be positive');
END;

CREATE TRIGGER role_assignments_rowid_positive AFTER INSERT ON role_assignments WHEN NEW.rowid <= 0
BEGIN
  SELECT RAISE(ABORT, 'constraint failed: role_assignments rowid must be positive');
END;
`;

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  Object.freeze({ name: 'create_companies_and_branches', sql: V1_COMPANIES_AND_BRANCHES, version: 1 }),
  Object.freeze({ name: 'create_users_and_memberships', sql: V2_USERS_AND_MEMBERSHIPS, version: 2 }),
  Object.freeze({ name: 'create_credentials_and_authentication', sql: V3_CREDENTIALS_AND_AUTHENTICATION, version: 3 }),
  Object.freeze({ name: 'create_sessions_and_security_versions', sql: V4_SESSIONS_AND_SECURITY_VERSIONS, version: 4 }),
  Object.freeze({ name: 'protect_security_versions_against_reinsertion', sql: V5_SECURITY_VERSION_REINSERTION, version: 5 }),
  Object.freeze({ name: 'create_rbac_roles_permissions_assignments', sql: V6_RBAC_ROLES_PERMISSIONS_ASSIGNMENTS, version: 6 }),
  Object.freeze({
    name: 'harden_rbac_replacement_and_parent_bindings',
    sql: V7_HARDEN_RBAC_REPLACEMENT_AND_PARENT_BINDINGS,
    version: 7,
  }),
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
