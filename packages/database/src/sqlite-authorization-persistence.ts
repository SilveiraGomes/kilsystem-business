import type Database from 'better-sqlite3';

import {
  assertRoleAssignmentAllowed,
  assertRolePermissionAllowed,
  assertSameTenant,
  assertTenantContext,
  authorityOfPermissionScope,
  createRole,
  createRoleAssignment,
  createRolePermission,
  normalizeRoleCode,
  OFFICIAL_PERMISSION_CATALOG,
  parsePermissionCode,
  RecordConflictError,
  RecordNotFoundError,
  requireOfficialPermissionCatalog,
  requireRecognizedPermissionCatalog,
  type Branch,
  type CompanyAuthorizationFacts,
  type CompanyId,
  type CompanyMembershipId,
  type PermissionCatalog,
  type PermissionCode,
  type Role,
  type RoleAssignment,
  type RoleAssignmentId,
  type RoleAssignmentRepository,
  type RoleId,
  type RolePermission,
  type RolePermissionRepository,
  type RoleRepository,
  type TenantContext,
  type UserId,
} from '@kil-business/shared-types';

import type { SqliteDatabase } from './connection.js';
import { PersistenceError } from './errors.js';
import {
  BRANCH_COLUMNS,
  BRANCH_MEMBERSHIP_COLUMNS,
  COMPANY_COLUMNS,
  COMPANY_MEMBERSHIP_COLUMNS,
  ROLE_ASSIGNMENT_COLUMNS,
  ROLE_COLUMNS,
  ROLE_PERMISSION_COLUMNS,
  toBranch,
  toBranchMembership,
  toCompany,
  toCompanyMembership,
  toRole,
  toRoleAssignment,
  toStoredRolePermission,
  toUser,
  USER_COLUMNS,
  type StoredRolePermission,
} from './sqlite-rows.js';
import { isPromiseLike, prepareAll, settle, translated } from './sqlite-support.js';

/*
 * Persistência RBAC sobre SQLite (E1.07-D2, migração 6). Implementa as interfaces de E1.07-D1
 * (`RoleRepository`, `RolePermissionRepository`, `RoleAssignmentRepository`) com a semântica de
 * isolamento de D-020, e fornece a leitura consistente dos factos de autorização de uma empresa.
 *
 * NÃO é autorização operacional: o `TenantContext` continua a ser construído pelo chamador (PD-27)
 * e não prova autoridade; estas operações não verificam a autoridade do actor (delegação, E1.07-D3)
 * e nada aqui está exposto por HTTP, IPC ou interface. O catálogo é sempre o oficial, fixado neste
 * módulo; nenhuma operação recebe catálogos, concessões ou decisões do consumidor (D-163 a D-167).
 */

/**
 * Catálogo do caminho operacional da persistência: só o oficial. Recusa catálogos desconhecidos
 * (`untrusted-catalog`) e experimentais (`catalog-not-official`) antes de qualquer consulta.
 */
export const requireOperationalPermissionCatalog = (value: unknown): PermissionCatalog =>
  requireOfficialPermissionCatalog(value);

/**
 * Situação de uma concessão persistida perante um catálogo reconhecido (D-162, PD-61):
 * - `RECOGNIZED`: permissão registada, disponível e empresarial, de uma versão conhecida;
 * - `UNREGISTERED`: código que o catálogo não regista (removido ou nunca existente);
 * - `WITHDRAWN`: registada mas retirada;
 * - `AUTHORITY_INCOMPATIBLE`: permissão da instalação (a base já a recusa; defensivo);
 * - `NEWER_CATALOG`: concedida numa versão do catálogo superior à do software em execução; o
 *   significado do código não é verificável por esta versão.
 * Só `RECOGNIZED` pode contribuir para uma decisão; as restantes nunca concedem nada, não são
 * convertidas por aproximação nem eliminadas, e permanecem identificáveis.
 */
export const ROLE_PERMISSION_CATALOG_STATUSES = Object.freeze([
  'RECOGNIZED',
  'UNREGISTERED',
  'WITHDRAWN',
  'AUTHORITY_INCOMPATIBLE',
  'NEWER_CATALOG',
] as const);

export type RolePermissionCatalogStatus = (typeof ROLE_PERMISSION_CATALOG_STATUSES)[number];

/** Classificação pura de uma concessão persistida perante um catálogo reconhecido. */
export const classifyStoredRolePermission = (
  catalog: PermissionCatalog,
  permissionCode: PermissionCode,
  catalogVersion: number,
): RolePermissionCatalogStatus => {
  const recognized = requireRecognizedPermissionCatalog(catalog);
  if (catalogVersion > recognized.version) return 'NEWER_CATALOG';
  const permission = recognized.find(permissionCode);
  if (permission === undefined) return 'UNREGISTERED';
  if (permission.status !== 'AVAILABLE') return 'WITHDRAWN';
  if (authorityOfPermissionScope(permission.authorityScope) !== 'COMPANY') return 'AUTHORITY_INCOMPATIBLE';
  return 'RECOGNIZED';
};

/** Concessão persistida que não é reconhecida pelo catálogo oficial vigente (diagnóstico, PD-61). */
export interface UnrecognizedRolePermission {
  readonly roleId: RoleId;
  readonly permissionCode: PermissionCode;
  /** Versão do catálogo oficial em que a concessão foi feita. */
  readonly catalogVersion: number;
  readonly status: Exclude<RolePermissionCatalogStatus, 'RECOGNIZED'>;
}

/**
 * Diagnóstico interno das concessões persistidas (PD-61). Só lê; não converte, não elimina e não
 * concede. Isolado por tenant como os repositórios.
 */
export interface RolePermissionDiagnostics {
  /** Versão do catálogo oficial do software em execução. */
  readonly catalogVersion: number;
  /** Concessões do tenant que o catálogo oficial vigente não reconhece, ordenadas por perfil e código. */
  listUnrecognized(context: TenantContext): Promise<readonly UnrecognizedRolePermission[]>;
}

/** Versões síncronas dos repositórios RBAC, disponíveis apenas dentro de `transaction`. */
export interface RoleStore {
  findById(context: TenantContext, id: RoleId): Role | undefined;
  findByCode(context: TenantContext, code: string): Role | undefined;
  listByCompany(context: TenantContext, companyId: CompanyId): readonly Role[];
  create(context: TenantContext, role: Role): void;
  update(context: TenantContext, role: Role): void;
}

export interface RolePermissionStore {
  listByRole(context: TenantContext, roleId: RoleId): readonly RolePermission[];
  add(context: TenantContext, rolePermission: RolePermission): void;
  remove(context: TenantContext, roleId: RoleId, permissionCode: PermissionCode): void;
}

export interface RoleAssignmentStore {
  findById(context: TenantContext, id: RoleAssignmentId): RoleAssignment | undefined;
  listByCompanyMembership(context: TenantContext, companyMembershipId: CompanyMembershipId): readonly RoleAssignment[];
  listByRole(context: TenantContext, roleId: RoleId): readonly RoleAssignment[];
  create(context: TenantContext, assignment: RoleAssignment): void;
  update(context: TenantContext, assignment: RoleAssignment): void;
}

export interface AuthorizationStores {
  readonly roles: RoleStore;
  readonly rolePermissions: RolePermissionStore;
  readonly roleAssignments: RoleAssignmentStore;
}

export interface SqliteAuthorizationPersistence {
  readonly roles: RoleRepository;
  readonly rolePermissions: RolePermissionRepository;
  readonly roleAssignments: RoleAssignmentRepository;
  readonly diagnostics: RolePermissionDiagnostics;
  /**
   * Factos da autoridade empresarial de `userId` na empresa `companyId` do tenant do contexto,
   * lidos numa única transacção de leitura e só desse tenant: empresa, estabelecimentos, identidade
   * e associações do utilizador, atribuições dessa associação, perfis atribuídos e as respectivas
   * concessões (sem as de uma versão do catálogo superior, D-181). `undefined` quando a empresa não
   * existe no tenant. Os factos não são uma decisão nem uma autorização.
   */
  readonly readCompanyAuthorizationFacts: (
    context: TenantContext,
    userId: UserId,
    companyId: CompanyId,
  ) => Promise<CompanyAuthorizationFacts | undefined>;
  /**
   * Alterações relacionadas numa única transacção: qualquer excepção reverte todas. `work` tem de
   * ser síncrono; os `stores` deixam de funcionar quando a transacção termina.
   */
  readonly transaction: <T>(work: (stores: AuthorizationStores) => T) => T;
}

// Todas as consultas filtram por `tenant_id`. São globais apenas as verificações de chave primária
// (UUID globais, sem devolver dados) e a leitura da identidade de uma associação já obtida no tenant.
const SQL = {
  companyInTenant: 'SELECT 1 FROM companies WHERE tenant_id = @tenantId AND id = @companyId',
  companyById: `SELECT ${COMPANY_COLUMNS} FROM companies WHERE tenant_id = @tenantId AND id = @companyId`,
  branchById: `SELECT ${BRANCH_COLUMNS} FROM branches
    WHERE tenant_id = @tenantId AND company_id = @companyId AND id = @branchId`,
  branchesByCompany: `SELECT ${BRANCH_COLUMNS} FROM branches
    WHERE tenant_id = @tenantId AND company_id = @companyId ORDER BY code`,
  membershipById: `SELECT ${COMPANY_MEMBERSHIP_COLUMNS} FROM company_memberships
    WHERE tenant_id = @tenantId AND id = @id`,
  membershipByUser: `SELECT ${COMPANY_MEMBERSHIP_COLUMNS} FROM company_memberships
    WHERE tenant_id = @tenantId AND user_id = @userId`,
  branchMembershipsOf: `SELECT ${BRANCH_MEMBERSHIP_COLUMNS} FROM branch_memberships
    WHERE tenant_id = @tenantId AND company_membership_id = @companyMembershipId ORDER BY created_at, id`,
  memberUser: `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
  roleById: `SELECT ${ROLE_COLUMNS} FROM roles WHERE tenant_id = @tenantId AND id = @id`,
  roleByCode: `SELECT ${ROLE_COLUMNS} FROM roles WHERE tenant_id = @tenantId AND code = @code`,
  rolesByCompany: `SELECT ${ROLE_COLUMNS} FROM roles
    WHERE tenant_id = @tenantId AND company_id = @companyId ORDER BY code`,
  roleIdExists: 'SELECT 1 FROM roles WHERE id = ?',
  insertRole: `INSERT INTO roles (id, tenant_id, company_id, code, name, description, status, created_at, updated_at)
    VALUES (@id, @tenantId, @companyId, @code, @name, @description, @status, @createdAt, @updatedAt)`,
  updateRole: `UPDATE roles SET name = @name, description = @description, status = @status, updated_at = @updatedAt
    WHERE tenant_id = @tenantId AND id = @id`,
  permissionsByRole: `SELECT ${ROLE_PERMISSION_COLUMNS} FROM role_permissions
    WHERE tenant_id = @tenantId AND role_id = @roleId ORDER BY permission_code`,
  permissionTaken: `SELECT 1 FROM role_permissions
    WHERE tenant_id = @tenantId AND role_id = @roleId AND permission_code = @permissionCode`,
  insertPermission: `INSERT INTO role_permissions (tenant_id, role_id, permission_code, catalog_version, created_at)
    VALUES (@tenantId, @roleId, @permissionCode, @catalogVersion, @createdAt)`,
  deletePermission: `DELETE FROM role_permissions
    WHERE tenant_id = @tenantId AND role_id = @roleId AND permission_code = @permissionCode`,
  permissionsOfTenant: `SELECT ${ROLE_PERMISSION_COLUMNS} FROM role_permissions
    WHERE tenant_id = @tenantId ORDER BY role_id, permission_code`,
  assignmentById: `SELECT ${ROLE_ASSIGNMENT_COLUMNS} FROM role_assignments WHERE tenant_id = @tenantId AND id = @id`,
  assignmentsByMembership: `SELECT ${ROLE_ASSIGNMENT_COLUMNS} FROM role_assignments
    WHERE tenant_id = @tenantId AND company_membership_id = @companyMembershipId ORDER BY created_at, id`,
  assignmentsByRole: `SELECT ${ROLE_ASSIGNMENT_COLUMNS} FROM role_assignments
    WHERE tenant_id = @tenantId AND role_id = @roleId ORDER BY created_at, id`,
  assignmentIdExists: 'SELECT 1 FROM role_assignments WHERE id = ?',
  assignmentTaken: `SELECT 1 FROM role_assignments
    WHERE tenant_id = @tenantId AND company_membership_id = @companyMembershipId AND role_id = @roleId
      AND scope = @scope AND branch_id IS @branchId`,
  insertAssignment: `INSERT INTO role_assignments
    (id, tenant_id, company_id, role_id, company_membership_id, scope, branch_id, status, created_at, updated_at)
    VALUES (@id, @tenantId, @companyId, @roleId, @companyMembershipId, @scope, @branchId, @status, @createdAt, @updatedAt)`,
  updateAssignment: `UPDATE role_assignments SET status = @status, updated_at = @updatedAt
    WHERE tenant_id = @tenantId AND id = @id`,
  rolesAssignedTo: `SELECT ${ROLE_COLUMNS} FROM roles
    WHERE tenant_id = @tenantId AND id IN (
      SELECT role_id FROM role_assignments WHERE tenant_id = @tenantId AND company_membership_id = @companyMembershipId
    ) ORDER BY code`,
  permissionsAssignedTo: `SELECT ${ROLE_PERMISSION_COLUMNS} FROM role_permissions
    WHERE tenant_id = @tenantId AND role_id IN (
      SELECT role_id FROM role_assignments WHERE tenant_id = @tenantId AND company_membership_id = @companyMembershipId
    ) ORDER BY role_id, permission_code`,
} as const;

const roleParameters = (role: Role): Record<string, string | null> => ({
  code: role.code,
  companyId: role.companyId,
  createdAt: role.createdAt,
  description: role.description ?? null,
  id: role.id,
  name: role.name,
  status: role.status,
  tenantId: role.tenantId,
  updatedAt: role.updatedAt,
});

const assignmentParameters = (assignment: RoleAssignment): Record<string, string | null> => ({
  branchId: assignment.branchId ?? null,
  companyId: assignment.companyId,
  companyMembershipId: assignment.companyMembershipId,
  createdAt: assignment.createdAt,
  id: assignment.id,
  roleId: assignment.roleId,
  scope: assignment.scope,
  status: assignment.status,
  tenantId: assignment.tenantId,
  updatedAt: assignment.updatedAt,
});

const frozenList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

/** Perfis, concessões e atribuições RBAC sobre SQLite (E1.07-D2), isolados por tenant (D-020). */
export const createSqliteAuthorizationPersistence = (database: SqliteDatabase): SqliteAuthorizationPersistence => {
  // O catálogo é verificado uma vez, na composição; nenhuma operação o recebe de fora.
  const catalog = requireOperationalPermissionCatalog(OFFICIAL_PERMISSION_CATALOG);
  const statements: Record<keyof typeof SQL, Database.Statement> = prepareAll(database, SQL);

  const roleInTenant = (context: TenantContext, id: RoleId): Role | undefined => {
    const row: unknown = statements.roleById.get({ id, tenantId: context.tenantId });
    return row === undefined ? undefined : toRole(row);
  };

  const assignmentInTenant = (context: TenantContext, id: RoleAssignmentId): RoleAssignment | undefined => {
    const row: unknown = statements.assignmentById.get({ id, tenantId: context.tenantId });
    return row === undefined ? undefined : toRoleAssignment(row);
  };

  /** Factos correntes de uma atribuição (D-152), lidos só do tenant do contexto. */
  const assignmentFacts = (context: TenantContext, assignment: RoleAssignment) => {
    const role = roleInTenant(context, assignment.roleId);
    if (role === undefined) throw new RecordNotFoundError('Role');
    const membershipRow: unknown = statements.membershipById.get({
      id: assignment.companyMembershipId,
      tenantId: context.tenantId,
    });
    if (membershipRow === undefined) throw new RecordNotFoundError('CompanyMembership');
    const membership = toCompanyMembership(membershipRow);
    let branch: Branch | undefined;
    if (assignment.branchId !== undefined) {
      const branchRow: unknown = statements.branchById.get({
        branchId: assignment.branchId,
        companyId: assignment.companyId,
        tenantId: context.tenantId,
      });
      if (branchRow === undefined) throw new RecordNotFoundError('Branch');
      branch = toBranch(branchRow);
    }
    const branchMemberships = statements.branchMembershipsOf
      .all({ companyMembershipId: membership.id, tenantId: context.tenantId })
      .map((row) => toBranchMembership(row));
    return { branch, branchMemberships, membership, role };
  };

  const createStores = (assertOpen: () => void): AuthorizationStores => {
    const guard = (context: TenantContext): void => {
      assertOpen();
      assertTenantContext(context);
    };

    const roles: RoleStore = {
      findById: (context, id) => {
        guard(context);
        return roleInTenant(context, id);
      },
      findByCode: (context, code) => {
        guard(context);
        const row: unknown = statements.roleByCode.get({ code: normalizeRoleCode(code), tenantId: context.tenantId });
        return row === undefined ? undefined : toRole(row);
      },
      listByCompany: (context, companyId) => {
        guard(context);
        return frozenList(
          statements.rolesByCompany.all({ companyId, tenantId: context.tenantId }).map((row) => toRole(row)),
        );
      },
      create: (context, candidate) => {
        guard(context);
        const role = createRole(candidate);
        assertSameTenant(context, role);
        if (statements.companyInTenant.get({ companyId: role.companyId, tenantId: context.tenantId }) === undefined) {
          throw new RecordNotFoundError('Company');
        }
        if (statements.roleIdExists.get(role.id) !== undefined) throw new RecordConflictError('duplicate-id');
        if (statements.roleByCode.get({ code: role.code, tenantId: context.tenantId }) !== undefined) {
          throw new RecordConflictError('duplicate-role-code');
        }
        statements.insertRole.run(roleParameters(role));
      },
      update: (context, candidate) => {
        guard(context);
        const role = createRole(candidate);
        assertSameTenant(context, role);
        const current = roleInTenant(context, role.id);
        if (current === undefined) throw new RecordNotFoundError('Role');
        if (
          current.code !== role.code ||
          current.companyId !== role.companyId ||
          current.createdAt !== role.createdAt
        ) {
          throw new RecordConflictError('immutable-field');
        }
        const result = statements.updateRole.run(roleParameters(role));
        if (result.changes !== 1) throw new RecordNotFoundError('Role');
      },
    };

    const rolePermissions: RolePermissionStore = {
      listByRole: (context, roleId) => {
        guard(context);
        return frozenList(
          statements.permissionsByRole
            .all({ roleId, tenantId: context.tenantId })
            .map((row) => toStoredRolePermission(row).grant),
        );
      },
      add: (context, candidate) => {
        guard(context);
        const grant = createRolePermission(candidate);
        assertSameTenant(context, grant);
        const role = roleInTenant(context, grant.roleId);
        if (role === undefined) throw new RecordNotFoundError('Role');
        // Só o catálogo oficial: códigos desconhecidos, retirados ou da instalação são recusados.
        assertRolePermissionAllowed(role, grant, catalog);
        const key = { permissionCode: grant.permissionCode, roleId: grant.roleId, tenantId: context.tenantId };
        if (statements.permissionTaken.get(key) !== undefined) throw new RecordConflictError('duplicate-role-permission');
        statements.insertPermission.run({ ...key, catalogVersion: catalog.version, createdAt: grant.createdAt });
      },
      remove: (context, roleId, permissionCode) => {
        guard(context);
        // A retirada explícita aceita qualquer código gramaticalmente válido, incluindo códigos fora do
        // catálogo vigente: é a forma controlada (não silenciosa) de limpar concessões obsoletas.
        const code = parsePermissionCode(permissionCode);
        if (roleInTenant(context, roleId) === undefined) throw new RecordNotFoundError('Role');
        const result = statements.deletePermission.run({ permissionCode: code, roleId, tenantId: context.tenantId });
        if (result.changes !== 1) throw new RecordNotFoundError('Role');
      },
    };

    const roleAssignments: RoleAssignmentStore = {
      findById: (context, id) => {
        guard(context);
        return assignmentInTenant(context, id);
      },
      listByCompanyMembership: (context, companyMembershipId) => {
        guard(context);
        return frozenList(
          statements.assignmentsByMembership
            .all({ companyMembershipId, tenantId: context.tenantId })
            .map((row) => toRoleAssignment(row)),
        );
      },
      listByRole: (context, roleId) => {
        guard(context);
        return frozenList(
          statements.assignmentsByRole.all({ roleId, tenantId: context.tenantId }).map((row) => toRoleAssignment(row)),
        );
      },
      create: (context, candidate) => {
        guard(context);
        const assignment = createRoleAssignment(candidate);
        assertSameTenant(context, assignment);
        assertRoleAssignmentAllowed(assignment, assignmentFacts(context, assignment));
        if (statements.assignmentIdExists.get(assignment.id) !== undefined) {
          throw new RecordConflictError('duplicate-id');
        }
        const taken = statements.assignmentTaken.get({
          branchId: assignment.branchId ?? null,
          companyMembershipId: assignment.companyMembershipId,
          roleId: assignment.roleId,
          scope: assignment.scope,
          tenantId: context.tenantId,
        });
        if (taken !== undefined) throw new RecordConflictError('duplicate-role-assignment');
        statements.insertAssignment.run(assignmentParameters(assignment));
      },
      update: (context, candidate) => {
        guard(context);
        const assignment = createRoleAssignment(candidate);
        assertSameTenant(context, assignment);
        const current = assignmentInTenant(context, assignment.id);
        if (current === undefined) throw new RecordNotFoundError('RoleAssignment');
        if (
          current.companyId !== assignment.companyId ||
          current.roleId !== assignment.roleId ||
          current.companyMembershipId !== assignment.companyMembershipId ||
          current.scope !== assignment.scope ||
          current.branchId !== assignment.branchId ||
          current.createdAt !== assignment.createdAt
        ) {
          throw new RecordConflictError('immutable-field');
        }
        // A reactivação revalida perfil, associação, estabelecimento e associação local no estado
        // corrente, como uma atribuição nova.
        if (current.status !== 'ACTIVE' && assignment.status === 'ACTIVE') {
          assertRoleAssignmentAllowed(assignment, assignmentFacts(context, assignment));
        }
        const result = statements.updateAssignment.run(assignmentParameters(assignment));
        if (result.changes !== 1) throw new RecordNotFoundError('RoleAssignment');
      },
    };

    return { roleAssignments, rolePermissions, roles };
  };

  // Leitura consistente: todos os factos vêm da mesma transacção e só do tenant do contexto.
  const readCompanyFacts = (
    context: TenantContext,
    userId: UserId,
    companyId: CompanyId,
  ): CompanyAuthorizationFacts | undefined => {
    assertTenantContext(context);
    return database.transaction((): CompanyAuthorizationFacts | undefined => {
      const tenantId = context.tenantId;
      const companyRow: unknown = statements.companyById.get({ companyId, tenantId });
      if (companyRow === undefined) return undefined;
      const company = toCompany(companyRow);
      const branches = frozenList(statements.branchesByCompany.all({ companyId, tenantId }).map((row) => toBranch(row)));
      const membershipRow: unknown = statements.membershipByUser.get({ tenantId, userId });
      if (membershipRow === undefined) {
        return Object.freeze({
          assignments: frozenList([]),
          membership: Object.freeze({ branchMemberships: frozenList([]), branches, company, membership: undefined, user: undefined }),
          rolePermissions: frozenList([]),
          roles: frozenList([]),
        });
      }
      const membership = toCompanyMembership(membershipRow);
      const userRow: unknown = statements.memberUser.get(membership.userId);
      // A integridade referencial garante a identidade; a ausência indica uma base corrompida.
      if (userRow === undefined) throw new PersistenceError('invalid-stored-record');
      const scope = { companyMembershipId: membership.id, tenantId };
      const stored: readonly StoredRolePermission[] = statements.permissionsAssignedTo
        .all(scope)
        .map((row) => toStoredRolePermission(row));
      return Object.freeze({
        assignments: frozenList(statements.assignmentsByMembership.all(scope).map((row) => toRoleAssignment(row))),
        membership: Object.freeze({
          branchMemberships: frozenList(statements.branchMembershipsOf.all(scope).map((row) => toBranchMembership(row))),
          branches,
          company,
          membership,
          user: toUser(userRow),
        }),
        // Concessões de uma versão superior do catálogo não são avaliáveis por este software (D-181).
        // As restantes seguem para as regras puras, que só aplicam permissões registadas e disponíveis.
        rolePermissions: frozenList(
          stored.filter((entry) => entry.catalogVersion <= catalog.version).map((entry) => entry.grant),
        ),
        roles: frozenList(statements.rolesAssignedTo.all(scope).map((row) => toRole(row))),
      });
    })();
  };

  const listUnrecognized = (context: TenantContext): readonly UnrecognizedRolePermission[] => {
    assertTenantContext(context);
    const entries: UnrecognizedRolePermission[] = [];
    for (const row of statements.permissionsOfTenant.all({ tenantId: context.tenantId })) {
      const { catalogVersion, grant } = toStoredRolePermission(row);
      const status = classifyStoredRolePermission(catalog, grant.permissionCode, catalogVersion);
      if (status === 'RECOGNIZED') continue;
      entries.push(Object.freeze({ catalogVersion, permissionCode: grant.permissionCode, roleId: grant.roleId, status }));
    }
    return frozenList(entries);
  };

  const alwaysOpen = (): void => undefined;
  const shared = createStores(alwaysOpen);
  const immediate = <T>(operation: () => T): Promise<T> =>
    settle(() => database.transaction(operation).immediate());

  const roles: RoleRepository = {
    findById: (context, id) => settle(() => shared.roles.findById(context, id)),
    findByCode: (context, code) => settle(() => shared.roles.findByCode(context, code)),
    listByCompany: (context, companyId) => settle(() => shared.roles.listByCompany(context, companyId)),
    create: (context, role) => immediate(() => shared.roles.create(context, role)),
    update: (context, role) => immediate(() => shared.roles.update(context, role)),
  };

  const rolePermissions: RolePermissionRepository = {
    listByRole: (context, roleId) => settle(() => shared.rolePermissions.listByRole(context, roleId)),
    add: (context, rolePermission) => immediate(() => shared.rolePermissions.add(context, rolePermission)),
    remove: (context, roleId, permissionCode) =>
      immediate(() => shared.rolePermissions.remove(context, roleId, permissionCode)),
  };

  const roleAssignments: RoleAssignmentRepository = {
    findById: (context, id) => settle(() => shared.roleAssignments.findById(context, id)),
    listByCompanyMembership: (context, companyMembershipId) =>
      settle(() => shared.roleAssignments.listByCompanyMembership(context, companyMembershipId)),
    listByRole: (context, roleId) => settle(() => shared.roleAssignments.listByRole(context, roleId)),
    create: (context, assignment) => immediate(() => shared.roleAssignments.create(context, assignment)),
    update: (context, assignment) => immediate(() => shared.roleAssignments.update(context, assignment)),
  };

  const diagnostics: RolePermissionDiagnostics = Object.freeze({
    catalogVersion: catalog.version,
    listUnrecognized: (context: TenantContext) => settle(() => listUnrecognized(context)),
  });

  const transaction = <T>(work: (stores: AuthorizationStores) => T): T => {
    let open = true;
    const stores = createStores(() => {
      if (!open) throw new PersistenceError('transaction-closed');
    });
    try {
      return translated(() =>
        database
          .transaction(() => {
            const result = work(stores);
            if (isPromiseLike(result)) throw new PersistenceError('async-transaction');
            return result;
          })
          .immediate(),
      );
    } finally {
      open = false;
    }
  };

  return {
    diagnostics,
    readCompanyAuthorizationFacts: (context, userId, companyId) =>
      settle(() => readCompanyFacts(context, userId, companyId)),
    roleAssignments,
    rolePermissions,
    roles,
    transaction,
  };
};
