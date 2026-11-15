import { describe, expect, it } from 'vitest';

import {
  changeUserStatus,
  createBranch,
  createBranchMembership,
  createCompanyMembership,
  createUser,
  deactivateBranch,
  deactivateBranchMembership,
  deactivateCompanyMembership,
  DomainValidationError,
  evaluateMembershipScope,
  isUserEligible,
  MEMBERSHIP_SCOPES,
  MEMBERSHIP_STATUSES,
  normalizeUsername,
  parseBranchMembershipId,
  parseCompanyMembershipId,
  parseUserId,
  TenantMismatchError,
  USER_STATUSES,
  type BranchId,
  type BranchMembershipId,
  type CompanyId,
  type CompanyMembershipId,
  type MembershipScopeFacts,
  type TenantId,
  type UserId,
  type UserInput,
} from '../packages/shared-types/src/index';
import { branchInput, CREATED_AT, newCompany, newId, UPDATED_AT } from './support/fixtures';
import {
  branchMembershipInput,
  companyMembershipInput,
  newBranchMembership,
  newCompanyMembership,
  newUser,
  userInput,
} from './support/identity-fixtures';

const invalidIdentifiers: readonly unknown[] = [
  '',
  'not-a-uuid',
  '00000000-0000-0000-0000-000000000000',
  ' 3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  '3f2504e0-4f89-01d3-9a0c-0305e82c3301',
  123,
  null,
  undefined,
];

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

const ALLOWED_USER_KEYS = ['createdAt', 'displayName', 'email', 'id', 'phone', 'status', 'updatedAt', 'username'];
const CREDENTIAL_KEY = /pass|pin|token|secret|hash|credential|otp|salt/i;

/** Empresa com três estabelecimentos (dois activos, um inactivo) e uma identidade associada. */
const scenario = () => {
  const company = newCompany();
  const user = newUser();
  const north = createBranch(branchInput(company, { code: 'NORTE' }));
  const south = createBranch(branchInput(company, { code: 'SUL', sectorType: 'PHARMACY' }));
  const closed = deactivateBranch(createBranch(branchInput(company, { code: 'FECHADO' })), UPDATED_AT);
  return { closed, company, north, south, user };
};

describe('Identity domain contracts (E1.07-A)', () => {
  describe('users', () => {
    it('creates an immutable user with normalised fields', () => {
      const user = createUser(userInput({ displayName: '  Ana Teste  ', username: '  Ana.Teste_01 ' }));

      expect(user).toMatchObject({
        displayName: 'Ana Teste',
        email: 'utilizador.teste@kil-business.test',
        phone: '+000 900 000 000',
        status: 'ACTIVE',
        username: 'ana.teste_01',
      });
      expect(user.createdAt).toBe(CREATED_AT);
      expect(user.updatedAt).toBe(CREATED_AT);
      expect(Object.isFrozen(user)).toBe(true);
    });

    it('treats email and phone as optional attributes', () => {
      const user = createUser(userInput({ email: undefined, phone: undefined }));

      expect(user).not.toHaveProperty('email');
      expect(user).not.toHaveProperty('phone');
    });

    it.each(invalidIdentifiers)('rejects %j as a user or membership identifier', (value) => {
      expect(() => parseUserId(value)).toThrow(DomainValidationError);
      expect(() => parseCompanyMembershipId(value)).toThrow(DomainValidationError);
      expect(() => parseBranchMembershipId(value)).toThrow(DomainValidationError);
      expectValidationError(() => createUser(userInput({ id: value as string })), 'id');
    });

    it('keeps UserId distinct from the other identifiers at compile time', () => {
      const userId: UserId = parseUserId(newId());
      const membershipId: CompanyMembershipId = parseCompanyMembershipId(newId());
      const branchMembershipId: BranchMembershipId = parseBranchMembershipId(newId());

      // @ts-expect-error: um UserId não pode ser usado onde se espera um TenantId.
      const asTenant: TenantId = userId;
      // @ts-expect-error: um UserId não pode ser usado onde se espera um CompanyId.
      const asCompany: CompanyId = userId;
      // @ts-expect-error: um UserId não pode ser usado onde se espera um BranchId.
      const asBranch: BranchId = userId;
      // @ts-expect-error: uma associação empresarial não é uma associação local.
      const asBranchMembership: BranchMembershipId = membershipId;
      // @ts-expect-error: uma associação local não identifica um utilizador.
      const asUser: UserId = branchMembershipId;
      // @ts-expect-error: texto não validado não é um UserId.
      const unvalidated: UserId = newId();

      expect([asTenant, asCompany, asBranch, asBranchMembership, asUser, unvalidated]).toHaveLength(6);
    });

    it('keeps the user identity independent from company and tenant identifiers (D-080)', () => {
      const company = newCompany();
      const user = newUser();

      expect([company.id, company.tenantId]).not.toContain(user.id);
      expect(user).not.toHaveProperty('tenantId');
      expect(user).not.toHaveProperty('companyId');
    });
  });

  describe('username normalisation (D-085)', () => {
    it.each([
      ['  Ana.Silva  ', 'ana.silva'],
      ['JOAO_1', 'joao_1'],
      ['caixa-01', 'caixa-01'],
      ['abc', 'abc'],
      ['A'.repeat(64), 'a'.repeat(64)],
    ])('normalises %j to %j', (value, expected) => {
      expect(normalizeUsername(value)).toBe(expected);
    });

    it.each([
      ['too short', 'ab'],
      ['too long', 'a'.repeat(65)],
      ['inner space', 'ana silva'],
      ['at sign', 'ana@kil'],
      ['accented letter', 'joão'],
      ['Kelvin sign that lowercases to ASCII', 'Kelvin'],
      ['slash', 'ana/silva'],
      ['empty', ''],
      ['blank', '   '],
      ['number', 123],
      ['null', null],
    ])('rejects a username with %s', (_label, value) => {
      expectValidationError(() => normalizeUsername(value), 'username');
      expectValidationError(() => createUser(userInput({ username: value as string })), 'username');
    });

    it('makes usernames that differ only by case or surrounding spaces equal', () => {
      expect(newUser({ username: ' Gestor.Loja ' }).username).toBe(newUser({ username: 'GESTOR.loja' }).username);
    });
  });

  describe('field validation', () => {
    it.each([
      ['displayName', { displayName: '   ' }],
      ['displayName', { displayName: 'x'.repeat(256) }],
      ['email', { email: 'sem-arroba' }],
      ['email', { email: 'a@semponto' }],
      ['email', { email: 'nome com espaco@kil-business.test' }],
      ['email', { email: `${'a'.repeat(250)}@x.test` }],
      ['phone', { phone: 'telefone' }],
      ['phone', { phone: '12' }],
      ['phone', { phone: '+' }],
      ['phone', { phone: '9'.repeat(33) }],
      ['createdAt', { createdAt: 'ontem' }],
      ['updatedAt', { updatedAt: '2026-11-12T00:00:00.000Z' }],
    ] as const)('rejects an invalid %s', (field, overrides: Partial<UserInput>) => {
      expectValidationError(() => createUser(userInput(overrides)), field);
    });

    it('does not echo personal data in error messages', () => {
      const email = 'pessoa.privada@kil-business.test x';
      const username = 'Nome Privado';
      const errors = [
        captureError(() => createUser(userInput({ email }))),
        captureError(() => createUser(userInput({ username }))),
        captureError(() => createUser(userInput({ phone: 'privado-123' }))),
      ];

      for (const error of errors) {
        expect(error).toBeInstanceOf(DomainValidationError);
        const message = (error as Error).message;
        expect(message).not.toContain('pessoa.privada');
        expect(message).not.toContain('Nome Privado');
        expect(message).not.toContain('privado-123');
      }
    });
  });

  describe('user statuses', () => {
    it('supports exactly ACTIVE, SUSPENDED and INACTIVE', () => {
      expect(USER_STATUSES).toEqual(['ACTIVE', 'SUSPENDED', 'INACTIVE']);
    });

    it.each(['active', 'DELETED', 'LOCKED', '', null])('rejects status %j', (status) => {
      expectValidationError(() => createUser(userInput({ status: status as string })), 'status');
    });

    it('changes the status in a controlled way, keeping the identity', () => {
      const user = newUser();
      const suspended = changeUserStatus(user, 'SUSPENDED', UPDATED_AT);

      expect(suspended).toEqual({ ...user, status: 'SUSPENDED', updatedAt: UPDATED_AT });
      expect(() => changeUserStatus(user, 'SUSPENDED', '2026-11-12T00:00:00.000Z')).toThrow(DomainValidationError);
    });

    it('considers only ACTIVE identities eligible for future authentication', () => {
      const user = newUser();

      expect(isUserEligible(user)).toBe(true);
      expect(isUserEligible(changeUserStatus(user, 'SUSPENDED', UPDATED_AT))).toBe(false);
      expect(isUserEligible(changeUserStatus(user, 'INACTIVE', UPDATED_AT))).toBe(false);
    });
  });

  describe('absence of credentials', () => {
    it('never carries passwords, hashes, PINs, tokens or secrets', () => {
      const hostile = {
        ...userInput(),
        password: 'segredo-de-teste',
        passwordHash: 'hash-de-teste',
        pin: '0000',
        secret: 'segredo',
        token: 'token-de-teste',
      } as UserInput;

      const user = createUser(hostile);

      expect(Object.keys(user).sort()).toEqual(ALLOWED_USER_KEYS);
      expect(Object.keys(user).some((key) => CREDENTIAL_KEY.test(key))).toBe(false);
      expect(JSON.stringify(user)).not.toContain('segredo');
    });
  });

  describe('memberships', () => {
    it('creates a company membership bound to one tenant and company', () => {
      const company = newCompany();
      const user = newUser();
      const membership = createCompanyMembership(companyMembershipInput(user, company));

      expect(membership).toMatchObject({
        companyId: company.id,
        scope: 'COMPANY_WIDE',
        status: 'ACTIVE',
        tenantId: company.tenantId,
        userId: user.id,
      });
      expect(Object.isFrozen(membership)).toBe(true);
    });

    it('supports exactly the documented scopes and statuses', () => {
      expect(MEMBERSHIP_SCOPES).toEqual(['COMPANY_WIDE', 'BRANCH_RESTRICTED']);
      expect(MEMBERSHIP_STATUSES).toEqual(['ACTIVE', 'INACTIVE']);
    });

    it('rejects a membership whose company and tenant identifiers coincide', () => {
      const company = newCompany();
      const user = newUser();

      expectValidationError(
        () => createCompanyMembership(companyMembershipInput(user, company, { tenantId: company.id })),
        'tenantId',
      );
    });

    it.each([
      ['scope', { scope: 'GLOBAL' }],
      ['scope', { scope: 'company_wide' }],
      ['status', { status: 'SUSPENDED' }],
      ['userId', { userId: 'not-a-uuid' }],
      ['companyId', { companyId: '' }],
    ] as const)('rejects an invalid %s', (field, overrides) => {
      expectValidationError(() => createCompanyMembership(companyMembershipInput(newUser(), newCompany(), overrides)), field);
    });

    it('creates and deactivates branch memberships logically', () => {
      const { company, north, user } = scenario();
      const membership = newCompanyMembership(user, company, { scope: 'BRANCH_RESTRICTED' });
      const local = createBranchMembership(branchMembershipInput(membership, north));

      expect(local).toMatchObject({ branchId: north.id, companyId: company.id, companyMembershipId: membership.id });
      expect(deactivateBranchMembership(local, UPDATED_AT)).toEqual({ ...local, status: 'INACTIVE', updatedAt: UPDATED_AT });
      expect(deactivateCompanyMembership(membership, UPDATED_AT)).toEqual({
        ...membership,
        status: 'INACTIVE',
        updatedAt: UPDATED_AT,
      });
    });
  });

  describe('membership scope evaluation (D-082, D-088)', () => {
    /** Factos completos de uma associação `COMPANY_WIDE` activa. */
    const baseFacts = () => {
      const { closed, company, north, south, user } = scenario();
      const membership = newCompanyMembership(user, company);
      const facts: MembershipScopeFacts = {
        branchMemberships: [],
        branches: [north, south, closed],
        company,
        membership,
        user,
      };
      return { closed, company, facts, membership, north, south, user };
    };

    it('reports no membership for a user without association', () => {
      const { facts } = baseFacts();

      expect(evaluateMembershipScope({ ...facts, membership: undefined })).toEqual({
        eligible: false,
        reason: 'no-membership',
      });
    });

    it('covers every active branch with COMPANY_WIDE, excluding inactive branches', () => {
      const { company, facts, north, south, user } = baseFacts();

      expect(evaluateMembershipScope(facts)).toEqual({
        branchIds: [north.id, south.id].sort(),
        companyId: company.id,
        companyOperational: true,
        eligible: true,
        scope: 'COMPANY_WIDE',
        tenantId: company.tenantId,
        userId: user.id,
      });
    });

    it('covers only explicitly associated active branches with BRANCH_RESTRICTED', () => {
      const { closed, company, facts, north, south, user } = baseFacts();
      const membership = newCompanyMembership(user, company, { scope: 'BRANCH_RESTRICTED' });

      const result = evaluateMembershipScope({
        ...facts,
        branchMemberships: [
          newBranchMembership(membership, north),
          deactivateBranchMembership(newBranchMembership(membership, south), UPDATED_AT),
          newBranchMembership(membership, closed),
        ],
        membership,
      });

      expect(result).toMatchObject({ branchIds: [north.id], eligible: true, scope: 'BRANCH_RESTRICTED' });
    });

    it('covers several branches of the same company', () => {
      const { company, facts, north, south, user } = baseFacts();
      const membership = newCompanyMembership(user, company, { scope: 'BRANCH_RESTRICTED' });

      const result = evaluateMembershipScope({
        ...facts,
        branchMemberships: [newBranchMembership(membership, north), newBranchMembership(membership, south)],
        membership,
      });

      expect(result).toMatchObject({ branchIds: [north.id, south.id].sort(), eligible: true });
    });

    it('grants no branch to BRANCH_RESTRICTED without branch memberships', () => {
      const { company, facts, user } = baseFacts();
      const membership = newCompanyMembership(user, company, { scope: 'BRANCH_RESTRICTED' });

      expect(evaluateMembershipScope({ ...facts, membership })).toMatchObject({
        branchIds: [],
        eligible: true,
        scope: 'BRANCH_RESTRICTED',
      });
    });

    it.each(['SUSPENDED', 'INACTIVE'] as const)('makes a %s identity ineligible', (status) => {
      const { facts, user } = baseFacts();

      expect(evaluateMembershipScope({ ...facts, user: changeUserStatus(user, status, UPDATED_AT) })).toEqual({
        eligible: false,
        reason: 'user-not-active',
      });
    });

    it('gives no effective scope through an inactive company membership', () => {
      const { facts, membership } = baseFacts();

      expect(
        evaluateMembershipScope({ ...facts, membership: deactivateCompanyMembership(membership, UPDATED_AT) }),
      ).toEqual({ eligible: false, reason: 'membership-inactive' });
    });

    it.each(['DRAFT', 'SUSPENDED', 'INACTIVE'] as const)(
      'flags a %s company as not operational without hiding the scope',
      (status) => {
        const { company, facts } = baseFacts();
        const inactiveCompany = newCompany({ ...company, nif: undefined, status });

        expect(evaluateMembershipScope({ ...facts, company: inactiveCompany })).toMatchObject({
          companyOperational: false,
          eligible: true,
        });
      },
    );

    it('refuses facts that belong to another tenant, company or user', () => {
      const { facts, membership } = baseFacts();
      const foreignCompany = newCompany();
      const foreignBranch = createBranch(branchInput(foreignCompany));
      const foreignMembership = newCompanyMembership(newUser(), foreignCompany, { scope: 'BRANCH_RESTRICTED' });

      expect(() => evaluateMembershipScope({ ...facts, membership: foreignMembership })).toThrow(TenantMismatchError);
      expect(() => evaluateMembershipScope({ ...facts, branches: [foreignBranch] })).toThrow(TenantMismatchError);
      expect(() =>
        evaluateMembershipScope({
          ...facts,
          branchMemberships: [newBranchMembership(foreignMembership, foreignBranch)],
          membership,
        }),
      ).toThrow(TenantMismatchError);
      expect(() => evaluateMembershipScope({ ...facts, user: newUser() })).toThrow(TenantMismatchError);
    });

    it('does not turn eligibility into a functional permission', () => {
      const result = evaluateMembershipScope(baseFacts().facts);

      expect(Object.keys(result).sort()).toEqual([
        'branchIds',
        'companyId',
        'companyOperational',
        'eligible',
        'scope',
        'tenantId',
        'userId',
      ]);
    });
  });
});
