import { describe, expect, it } from 'vitest';

import {
  assertRoleAssignmentAllowed,
  assertRolePermissionAllowed,
  authorityOfPermissionScope,
  AuthorizationContractError,
  checkPermissionCode,
  createPermission,
  createPermissionCatalog,
  createRole,
  createRoleAssignment,
  createRolePermission,
  deactivateBranchMembership,
  deactivateCompanyMembership,
  deactivateRole,
  deactivateRoleAssignment,
  DomainValidationError,
  extendPermissionCatalog,
  INITIAL_PERMISSION_CATALOG,
  INITIAL_PERMISSION_DEFINITIONS,
  isPermissionCode,
  isRoleActive,
  normalizeRoleCode,
  parsePermissionCode,
  parseRoleAssignmentId,
  parseRoleId,
  PERMISSION_CODE_MAX_LENGTH,
  PERMISSION_SCOPES,
  requireRegisteredPermission,
  ROLE_STATUSES,
  TenantMismatchError,
  type CompanyMembershipId,
  type PermissionCode,
  type PermissionDefinition,
  type RoleAssignmentId,
  type RoleId,
  type UserId,
} from '../packages/shared-types/src/index';
import {
  assignAtBranch,
  assignCompanyWide,
  assignmentInput,
  grantTo,
  newRole,
  roleInput,
  TEST_CATALOG,
  tenantScenario,
} from './support/authorization-fixtures';
import { UPDATED_AT } from './support/fixtures';

/*
 * E1.07-D1 — contratos de autorização (requisitos 1 a 30 da tarefa). Os identificadores Dnn estão
 * mapeados em docs/tasks/E1.07-D1.md.
 */

const captureError = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
};

const expectValidationError = (action: () => unknown, field: string): void => {
  const error = captureError(action);
  expect(error).toBeInstanceOf(DomainValidationError);
  expect(error).toMatchObject({ field });
};

const expectContractError = (action: () => unknown, reason: string): void => {
  const error = captureError(action);
  expect(error).toBeInstanceOf(AuthorizationContractError);
  expect(error).toMatchObject({ reason });
};

const VALID_UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const INVALID_IDENTIFIERS: readonly unknown[] = [
  '',
  'not-a-uuid',
  '00000000-0000-0000-0000-000000000000',
  ` ${VALID_UUID}`,
  '3f2504e0-4f89-01d3-9a0c-0305e82c3301',
  42,
  null,
  undefined,
];

const definition = (overrides: Partial<PermissionDefinition> = {}): PermissionDefinition => ({
  authorityScope: 'COMPANY',
  category: 'ADMINISTRATION',
  code: 'reports.read',
  description: 'Permissão fictícia de teste',
  ...overrides,
});

describe('E1.07-D1 identifiers', () => {
  it('D01 parses RoleId and RoleAssignmentId as canonical UUIDs and rejects anything else', () => {
    expect(parseRoleId(VALID_UUID.toUpperCase())).toBe(VALID_UUID);
    expect(parseRoleAssignmentId(VALID_UUID)).toBe(VALID_UUID);
    for (const value of INVALID_IDENTIFIERS) {
      expectValidationError(() => parseRoleId(value), 'roleId');
      expectValidationError(() => parseRoleAssignmentId(value), 'roleAssignmentId');
    }
  });

  it('D02 keeps RBAC identifiers distinct from identity, session, tenant and membership identifiers', () => {
    const roleId = parseRoleId(VALID_UUID);
    const assignmentId = parseRoleAssignmentId(VALID_UUID);
    const takesRole = (id: RoleId): string => id;
    const takesAssignment = (id: RoleAssignmentId): string => id;
    const takesUser = (id: UserId): string => id;
    const takesMembership = (id: CompanyMembershipId): string => id;
    const takesCode = (code: PermissionCode): string => code;

    // @ts-expect-error -- um RoleId não é um UserId
    takesUser(roleId);
    // @ts-expect-error -- um RoleAssignmentId não é um RoleId
    takesRole(assignmentId);
    // @ts-expect-error -- um RoleAssignmentId não é um CompanyMembershipId
    takesMembership(assignmentId);
    // @ts-expect-error -- um UserId não é um RoleAssignmentId
    takesAssignment(VALID_UUID as UserId);
    // @ts-expect-error -- texto livre não é um PermissionCode
    takesCode('company.read');
    expect(takesCode(parsePermissionCode('company.read'))).toBe('company.read');
  });
});

describe('E1.07-D1 permission codes', () => {
  it('D03 accepts lowercase dotted ASCII codes with two to four segments', () => {
    const longest = `${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(30)}`;
    expect(longest).toHaveLength(PERMISSION_CODE_MAX_LENGTH);
    for (const code of ['company.read', 'roles.assign', 'accounting.entries.create', 'role_assignments.read', 'a1.b2', 'x.y.z.w', longest]) {
      expect(checkPermissionCode(code)).toBeUndefined();
      expect(isPermissionCode(code)).toBe(true);
      expect(parsePermissionCode(code)).toBe(code);
    }
  });

  it('D04 rejects unsupported formats without normalising them', () => {
    const cases: readonly (readonly [unknown, string])[] = [
      ['Company.read', 'invalid-segment'],
      ['COMPANY.READ', 'invalid-segment'],
      ['1company.read', 'invalid-segment'],
      ['company.read-only', 'invalid-segment'],
      ['company_.read', 'invalid-segment'],
      ['company__x.read', 'invalid-segment'],
      ['_company.read', 'invalid-segment'],
      [' company.read', 'invalid-segment'],
      ['company.read ', 'invalid-segment'],
      ['company .read', 'invalid-segment'],
      ['company.re\tad', 'invalid-segment'],
      ['ｃompany.read', 'invalid-segment'],
      ['company.Keep', 'invalid-segment'],
      ['company', 'segment-count'],
      ['a.b.c.d.e', 'segment-count'],
      [`${'a'.repeat(33)}.read`, 'segment-too-long'],
      [`${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(31)}`, 'too-long'],
      [42, 'not-text'],
      [null, 'not-text'],
      [undefined, 'not-text'],
    ];
    for (const [value, violation] of cases) {
      expect(checkPermissionCode(value), String(value)).toBe(violation);
      expectValidationError(() => parsePermissionCode(value), 'permissionCode');
    }
  });

  it('D05 rejects wildcards and segments that act as semantic wildcards', () => {
    for (const code of ['*', 'company.*', '*.read', 'roles.**', 'company.re?d', '%.read', 'roles.#']) {
      expect(checkPermissionCode(code), code).toBe('wildcard');
      expect(isPermissionCode(code)).toBe(false);
    }
    for (const code of ['company.all', 'any.read', 'roles.all.assign']) {
      expect(checkPermissionCode(code), code).toBe('reserved-segment');
    }
  });

  it('D06 rejects empty codes and empty segments', () => {
    expect(checkPermissionCode('')).toBe('empty');
    for (const code of ['.read', 'company.', 'company..read', '.', '..']) {
      expect(checkPermissionCode(code), code).toBe('empty-segment');
    }
  });

  it('D07 reports the violated rule without echoing the received value', () => {
    const error = captureError(() => parsePermissionCode('segredo.Interno'));
    expect(error).toBeInstanceOf(DomainValidationError);
    expect((error as Error).message).not.toContain('segredo');
    expect((error as Error).message).not.toContain('Interno');
  });
});

describe('E1.07-D1 permission catalog', () => {
  it('D08 provides a versioned, frozen, unique initial catalog limited to administration', () => {
    const catalog = INITIAL_PERMISSION_CATALOG;
    const codes = catalog.permissions.map((permission) => permission.code);
    expect(catalog.version).toBe(1);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.permissions)).toBe(true);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual([...codes].sort((left, right) => left.localeCompare(right)));
    expect(codes).toHaveLength(INITIAL_PERMISSION_DEFINITIONS.length);
    for (const required of [
      'company.read', 'company.update', 'branches.read', 'branches.create', 'branches.update',
      'memberships.read', 'memberships.create', 'memberships.update', 'permissions.read',
      'roles.read', 'roles.create', 'roles.update', 'roles.deactivate',
      'roles.permissions.grant', 'roles.permissions.revoke',
      'roles.assignments.read', 'roles.assign', 'roles.unassign',
      'installation.authorities.read', 'installation.authorities.grant',
    ]) {
      expect(codes, required).toContain(required);
    }
    for (const permission of catalog.permissions) {
      expect(isPermissionCode(permission.code)).toBe(true);
      expect(permission.category).toBe('ADMINISTRATION');
      expect(permission.status).toBe('AVAILABLE');
      expect(Object.isFrozen(permission)).toBe(true);
    }
    expect(codes.filter((code) => /^(sales|purchases|pos|stock|accounting|invoices|fiscal)\./.test(code))).toEqual([]);
    expect(codes.some((code) => code.startsWith('platform.'))).toBe(false);
  });

  it('D09 rejects duplicated codes when creating or extending a catalog', () => {
    expectContractError(() => createPermissionCatalog(1, [definition(), definition()]), 'duplicate-permission');
    expectContractError(
      () => extendPermissionCatalog(INITIAL_PERMISSION_CATALOG, 2, [definition({ code: 'company.read' })]),
      'duplicate-permission',
    );
  });

  it('D10 distinguishes a valid code from a registered, available permission', () => {
    const unregistered = parsePermissionCode('reports.export');
    expect(INITIAL_PERMISSION_CATALOG.find(unregistered)).toBeUndefined();
    expect(INITIAL_PERMISSION_CATALOG.isRegistered(unregistered)).toBe(false);
    expectContractError(() => requireRegisteredPermission(INITIAL_PERMISSION_CATALOG, unregistered), 'unknown-permission');
    const withdrawn = createPermissionCatalog(1, [definition({ status: 'WITHDRAWN' })]);
    expectContractError(() => requireRegisteredPermission(withdrawn, parsePermissionCode('reports.read')), 'permission-unavailable');
    expect(requireRegisteredPermission(INITIAL_PERMISSION_CATALOG, parsePermissionCode('roles.read')).code).toBe('roles.read');
  });

  it('D11 extends the catalog in a higher version without changing the base', () => {
    const before = INITIAL_PERMISSION_CATALOG.permissions.length;
    const extended = extendPermissionCatalog(INITIAL_PERMISSION_CATALOG, 2, [definition()]);
    expect(extended.version).toBe(2);
    expect(extended.permissions).toHaveLength(before + 1);
    expect(INITIAL_PERMISSION_CATALOG.permissions).toHaveLength(before);
    expect(INITIAL_PERMISSION_CATALOG.isRegistered(parsePermissionCode('reports.read'))).toBe(false);
    for (const version of [1, 0, -1, 1.5, Number.NaN]) {
      expectContractError(() => extendPermissionCatalog(INITIAL_PERMISSION_CATALOG, version, [definition()]), 'invalid-catalog-version');
    }
    expectContractError(() => createPermissionCatalog(0, []), 'invalid-catalog-version');
  });

  it('D12 binds each permission to one authority and keeps the installation free of commercial operations', () => {
    expect(PERMISSION_SCOPES.map(authorityOfPermissionScope)).toEqual(['INSTALLATION', 'COMPANY', 'COMPANY']);
    expectValidationError(() => createPermission(definition({ code: 'installation.settings.read' })), 'code');
    expectValidationError(() => createPermission(definition({ authorityScope: 'INSTALLATION' })), 'code');
    expectValidationError(() => createPermission(definition({ code: 'platform.licences.read' })), 'code');
    expectValidationError(
      () => createPermission(definition({ authorityScope: 'INSTALLATION', category: 'OPERATION', code: 'installation.sales.create' })),
      'category',
    );
    expectValidationError(() => createPermission(definition({ authorityScope: 'GLOBAL' })), 'authorityScope');
    expectValidationError(() => createPermission(definition({ status: 'DENIED' })), 'status');
    for (const permission of INITIAL_PERMISSION_CATALOG.permissions) {
      expect(permission.code.startsWith('installation.')).toBe(permission.authorityScope === 'INSTALLATION');
    }
  });

  it('D13 derives resource and action from the code and records the required scope', () => {
    const permission = createPermission(definition({ code: 'roles.permissions.grant' }));
    expect(permission).toMatchObject({ resource: 'roles.permissions', action: 'grant', authorityScope: 'COMPANY' });
    const find = (code: string) => INITIAL_PERMISSION_CATALOG.find(parsePermissionCode(code));
    expect(find('branches.read')?.authorityScope).toBe('BRANCH');
    expect(find('company.update')?.authorityScope).toBe('COMPANY');
    expect(find('branches.update')?.authorityScope).toBe('COMPANY');
    expect(find('installation.users.provision')?.authorityScope).toBe('INSTALLATION');
  });
});

describe('E1.07-D1 roles', () => {
  it('D14 creates a valid company role with only the contract fields', () => {
    const { company } = tenantScenario();
    const role = createRole({ ...roleInput(company, { description: ' Perfil fictício ' }), permissions: ['*'] } as never);
    expect(role).toMatchObject({ tenantId: company.tenantId, companyId: company.id, code: 'OPERADOR', status: 'ACTIVE', description: 'Perfil fictício' });
    expect(Object.keys(role).sort()).toEqual(['code', 'companyId', 'createdAt', 'description', 'id', 'name', 'status', 'tenantId', 'updatedAt']);
    expect(Object.isFrozen(role)).toBe(true);
    expect('description' in newRole(company)).toBe(false);
  });

  it('D15 rejects roles with an invalid tenant', () => {
    const { company } = tenantScenario();
    for (const tenantId of INVALID_IDENTIFIERS) {
      expectValidationError(() => createRole(roleInput(company, { tenantId: tenantId as string })), 'tenantId');
    }
    expectValidationError(() => createRole(roleInput(company, { tenantId: company.id })), 'tenantId');
  });

  it('D16 accepts valid role codes', () => {
    for (const [code, normalized] of [['CAIXA', 'CAIXA'], ['ADMIN_EMPRESA', 'ADMIN_EMPRESA'], ['gerente-loja-1', 'GERENTE-LOJA-1'], ['Ab', 'AB']]) {
      expect(normalizeRoleCode(code)).toBe(normalized);
    }
    expect(normalizeRoleCode(`R${'x'.repeat(63)}`)).toHaveLength(64);
  });

  it('D17 normalises role codes and rejects ambiguous or non-ASCII codes', () => {
    expect(normalizeRoleCode('  gerente_loja  ')).toBe('GERENTE_LOJA');
    for (const code of ['A', '1CAIXA', '_CAIXA', 'CAIXA LOJA', 'ÇAIXA', 'KIOSK', 'CAIXA.LOJA', `R${'x'.repeat(64)}`, '', 7]) {
      expectValidationError(() => normalizeRoleCode(code), 'code');
    }
  });

  it('D18 rejects invalid statuses and chronology', () => {
    const { company } = tenantScenario();
    expect(ROLE_STATUSES).toEqual(['ACTIVE', 'INACTIVE']);
    for (const status of ['SUSPENDED', 'active', '', 'DELETED']) {
      expectValidationError(() => createRole(roleInput(company, { status })), 'status');
    }
    expectValidationError(() => createRole(roleInput(company, { createdAt: UPDATED_AT, updatedAt: '2026-11-13T10:00:00.000Z' })), 'updatedAt');
    expectValidationError(() => createRole(roleInput(company, { name: '   ' })), 'name');
  });

  it('D19 deactivates roles logically; an inactive role cannot be assigned', () => {
    const { company, membership } = tenantScenario();
    const role = newRole(company);
    const inactive = deactivateRole(role, UPDATED_AT);
    expect(inactive).toMatchObject({ id: role.id, code: role.code, status: 'INACTIVE', updatedAt: UPDATED_AT });
    expect(isRoleActive(role)).toBe(true);
    expect(isRoleActive(inactive)).toBe(false);
    const assignment = assignCompanyWide(inactive, membership);
    expectContractError(() => assertRoleAssignmentAllowed(assignment, { role: inactive, membership, branchMemberships: [] }), 'role-inactive');
  });

  it('D20 allows the same role code in different companies', () => {
    const first = tenantScenario();
    const second = tenantScenario();
    const roleA = newRole(first.company, { code: 'gerente' });
    const roleB = newRole(second.company, { code: 'GERENTE' });
    expect(roleA.code).toBe(roleB.code);
    expect(roleA.tenantId).not.toBe(roleB.tenantId);
    expect(roleA.id).not.toBe(roleB.id);
  });

  it('D21 isolates roles conceptually by tenant', () => {
    const first = tenantScenario();
    const second = tenantScenario();
    const role = newRole(first.company);
    const foreignGrant = createRolePermission({ tenantId: second.company.tenantId, roleId: role.id, permissionCode: 'roles.read', createdAt: UPDATED_AT });
    expect(captureError(() => assertRolePermissionAllowed(role, foreignGrant, TEST_CATALOG))).toBeInstanceOf(TenantMismatchError);
    const crossAssignment = createRoleAssignment(assignmentInput(role, second.membership));
    expect(
      captureError(() => assertRoleAssignmentAllowed(crossAssignment, { role, membership: second.membership, branchMemberships: [] })),
    ).toBeInstanceOf(TenantMismatchError);
  });

  it('D22 accepts explicit grants of registered company and branch permissions', () => {
    const { company } = tenantScenario();
    const role = newRole(company);
    for (const code of ['roles.read', 'roles.assign', 'branches.read', 'company.update']) {
      const grant = grantTo(role, code);
      expect(() => assertRolePermissionAllowed(role, grant, TEST_CATALOG)).not.toThrow();
      expect(grant).toMatchObject({ tenantId: company.tenantId, roleId: role.id, permissionCode: code });
      expect(Object.isFrozen(grant)).toBe(true);
    }
  });

  it('D23 rejects installation, unknown, withdrawn, wildcard and mismatched grants', () => {
    const { company } = tenantScenario();
    const role = newRole(company);
    for (const code of ['installation.settings.update', 'installation.authorities.grant', 'installation.users.provision']) {
      expectContractError(() => assertRolePermissionAllowed(role, grantTo(role, code), TEST_CATALOG), 'permission-authority-incompatible');
    }
    expectContractError(() => assertRolePermissionAllowed(role, grantTo(role, 'reports.export'), TEST_CATALOG), 'unknown-permission');
    const withdrawn = extendPermissionCatalog(TEST_CATALOG, 3, [definition({ status: 'WITHDRAWN' })]);
    expectContractError(() => assertRolePermissionAllowed(role, grantTo(role, 'reports.read'), withdrawn), 'permission-unavailable');
    expectValidationError(() => grantTo(role, 'roles.*'), 'permissionCode');
    expectValidationError(() => assertRolePermissionAllowed(newRole(company), grantTo(role, 'roles.read'), TEST_CATALOG), 'roleId');
  });
});

describe('E1.07-D1 role assignments', () => {
  it('D24 assigns a role company-wide through a valid company membership', () => {
    const { company, membership } = tenantScenario();
    const role = newRole(company);
    const assignment = assignCompanyWide(role, membership);
    expect(() => assertRoleAssignmentAllowed(assignment, { role, membership, branchMemberships: [] })).not.toThrow();
    expect(assignment).toMatchObject({ scope: 'COMPANY_WIDE', companyMembershipId: membership.id, roleId: role.id, status: 'ACTIVE' });
    expect('branchId' in assignment).toBe(false);
    expect(Object.isFrozen(assignment)).toBe(true);
  });

  it('D25 rejects a role from another tenant', () => {
    const own = tenantScenario();
    const other = tenantScenario();
    const foreignRole = newRole(other.company);
    const assignment = createRoleAssignment(assignmentInput(foreignRole, own.membership));
    expect(
      captureError(() => assertRoleAssignmentAllowed(assignment, { role: foreignRole, membership: own.membership, branchMemberships: [] })),
    ).toBeInstanceOf(TenantMismatchError);
  });

  it('D26 rejects a company membership from another tenant', () => {
    const own = tenantScenario();
    const other = tenantScenario();
    const role = newRole(own.company);
    const assignment = createRoleAssignment(assignmentInput(role, own.membership));
    expect(
      captureError(() => assertRoleAssignmentAllowed(assignment, { role, membership: other.membership, branchMemberships: [] })),
    ).toBeInstanceOf(TenantMismatchError);
  });

  it('D27 restricts assignments to one branch, with the branch required only in that scope', () => {
    const wide = tenantScenario();
    const role = newRole(wide.company);
    const assignment = assignAtBranch(role, wide.membership, wide.branchA);
    expect(assignment).toMatchObject({ scope: 'BRANCH', branchId: wide.branchA.id });
    expect(() => assertRoleAssignmentAllowed(assignment, { role, membership: wide.membership, branch: wide.branchA, branchMemberships: [] })).not.toThrow();

    const restricted = tenantScenario({ restrictedTo: ['A'] });
    const restrictedRole = newRole(restricted.company);
    const local = assignAtBranch(restrictedRole, restricted.membership, restricted.branchA);
    expect(() =>
      assertRoleAssignmentAllowed(local, { role: restrictedRole, membership: restricted.membership, branch: restricted.branchA, branchMemberships: restricted.branchMemberships }),
    ).not.toThrow();

    expectValidationError(() => createRoleAssignment(assignmentInput(role, wide.membership, { scope: 'BRANCH' })), 'branchId');
    expectValidationError(() => createRoleAssignment(assignmentInput(role, wide.membership, { branchId: wide.branchA.id })), 'branchId');
    expectValidationError(() => createRoleAssignment(assignmentInput(role, wide.membership, { scope: 'TENANT' })), 'scope');
    expectValidationError(() => assertRoleAssignmentAllowed(assignment, { role, membership: wide.membership, branchMemberships: [] }), 'branchId');
  });

  it('D28 rejects a branch from another tenant or a different branch than the one assigned', () => {
    const own = tenantScenario();
    const other = tenantScenario();
    const role = newRole(own.company);
    const foreignBranchAssignment = createRoleAssignment(assignmentInput(role, own.membership, { scope: 'BRANCH', branchId: other.branchA.id }));
    expect(
      captureError(() =>
        assertRoleAssignmentAllowed(foreignBranchAssignment, { role, membership: own.membership, branch: other.branchA, branchMemberships: [] }),
      ),
    ).toBeInstanceOf(TenantMismatchError);
    const assignment = assignAtBranch(role, own.membership, own.branchA);
    expectValidationError(
      () => assertRoleAssignmentAllowed(assignment, { role, membership: own.membership, branch: own.branchB, branchMemberships: [] }),
      'branchId',
    );
  });

  it('D29 never lets an assignment scope exceed the company membership scope', () => {
    const restricted = tenantScenario({ restrictedTo: ['A'] });
    const role = newRole(restricted.company);
    const facts = { role, membership: restricted.membership, branchMemberships: restricted.branchMemberships };
    expectContractError(() => assertRoleAssignmentAllowed(assignCompanyWide(role, restricted.membership), facts), 'assignment-scope-exceeds-membership');
    expectContractError(
      () => assertRoleAssignmentAllowed(assignAtBranch(role, restricted.membership, restricted.branchB), { ...facts, branch: restricted.branchB }),
      'assignment-scope-exceeds-membership',
    );
    const inactiveLocal = restricted.branchMemberships.map((local) => deactivateBranchMembership(local, UPDATED_AT));
    expectContractError(
      () =>
        assertRoleAssignmentAllowed(assignAtBranch(role, restricted.membership, restricted.branchA), {
          ...facts,
          branch: restricted.branchA,
          branchMemberships: inactiveLocal,
        }),
      'assignment-scope-exceeds-membership',
    );
  });

  it('D30 deactivates assignments logically, keeping identity and scope', () => {
    const { branchA, company, membership } = tenantScenario();
    const assignment = assignAtBranch(newRole(company), membership, branchA);
    const inactive = deactivateRoleAssignment(assignment, UPDATED_AT);
    expect(inactive).toMatchObject({ id: assignment.id, scope: 'BRANCH', branchId: branchA.id, status: 'INACTIVE', updatedAt: UPDATED_AT });
    expectValidationError(() => createRoleAssignment({ ...assignment, status: 'REVOKED' }), 'status');
  });

  it('D31 rejects assignments through an inactive company membership', () => {
    const { company, membership } = tenantScenario();
    const role = newRole(company);
    const inactive = deactivateCompanyMembership(membership, UPDATED_AT);
    expectContractError(
      () => assertRoleAssignmentAllowed(assignCompanyWide(role, inactive), { role, membership: inactive, branchMemberships: [] }),
      'membership-inactive',
    );
  });

  it('D32 rejects assignments to an inactive branch', () => {
    const { branchC, company, membership } = tenantScenario();
    const role = newRole(company);
    expectContractError(
      () => assertRoleAssignmentAllowed(assignAtBranch(role, membership, branchC), { role, membership, branch: branchC, branchMemberships: [] }),
      'branch-inactive',
    );
  });

  it('D33 rejects facts that do not match the assignment references', () => {
    const { company, membership } = tenantScenario();
    const role = newRole(company);
    const assignment = assignCompanyWide(role, membership);
    expectValidationError(() => assertRoleAssignmentAllowed(assignment, { role: newRole(company), membership, branchMemberships: [] }), 'roleId');
    const otherMembership = { ...membership, id: VALID_UUID as CompanyMembershipId };
    expectValidationError(
      () => assertRoleAssignmentAllowed(assignment, { role, membership: otherMembership, branchMemberships: [] }),
      'companyMembershipId',
    );
  });
});
