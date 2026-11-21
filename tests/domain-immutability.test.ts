import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, expectTypeOf, it } from 'vitest';

import { DATABASE_FILE_EXTENSIONS, MIGRATIONS, resolveDatabaseLocation } from '../packages/database/src/index';
import {
  BRANCH_STATUSES,
  changeUserStatus,
  COMPANY_STATUSES,
  createBranch,
  createBranchMembership,
  createCompany,
  createCompanyMembership,
  createTaxIdPolicy,
  createUser,
  deactivateBranch,
  deactivateBranchMembership,
  deactivateCompany,
  deactivateCompanyMembership,
  DEFAULT_SESSION_POLICY,
  DomainValidationError,
  EMPTY_COMMON_PASSWORD_LIST,
  EMPTY_TAX_ID_POLICY,
  isSectorType,
  MEMBERSHIP_SCOPES,
  MEMBERSHIP_STATUSES,
  parseJurisdiction,
  parseOneOf,
  parseSectorType,
  parseSessionPolicy,
  restoreCompany,
  SECTOR_LABELS,
  SECTOR_TYPES,
  SESSION_POLICY_LIMITS,
  SESSION_REVOCATION_REASONS,
  USER_STATUSES,
  type BranchStatus,
  type CompanyStatus,
  type MembershipScope,
  type MembershipStatus,
  type SectorType,
  type SessionRevocationReason,
  type TaxIdPolicy,
  type TaxIdRule,
  type UserStatus,
} from '../packages/shared-types/src/index';
import {
  assertHashingParameters,
  assertStoredHash,
  MINIMUM_PASSWORD_HASHING_PARAMETERS,
  PASSWORD_HASHING_PARAMETERS,
  PasswordHashingError,
  STORED_PARAMETER_BOUNDS,
  type PasswordHash,
} from '../services/local-api/src/authentication/password-hashing';
import { AUTHENTICATION_THROTTLE_POLICY } from '../services/local-api/src/authentication/throttle-policy';
import { LOCAL_SERVICE_EXIT_CODES } from '../services/local-api/src/cli';
import {
  LOCAL_SERVICE_ENV,
  LOCAL_SERVICE_ENVIRONMENTS,
  LOG_LEVELS,
  loadLocalServiceConfigFromEnv,
  LocalServiceConfigError,
  MISSING_DATABASE_POLICIES,
  parseLocalServiceConfig,
  PENDING_MIGRATION_POLICIES,
  type LocalServiceEnvironment,
  type LogLevel,
  type MissingDatabasePolicy,
  type PendingMigrationPolicy,
} from '../services/local-api/src/config';
import { LOCAL_SERVICE_TRANSITIONS, type LocalServiceState } from '../services/local-api/src/local-service';
import { createJsonLogger } from '../services/local-api/src/logger';
import { branchInput, companyInput, CREATED_AT, newCompany, newId, TEST_TAX_ID_POLICY } from './support/fixtures';
import { companyMembershipInput, newUser, userInput } from './support/identity-fixtures';
import { createServiceUnderTest, PROTECTED_DIRECTORIES, serviceConfig } from './support/local-service-harness';
import { createTemporaryDatabase } from './support/sqlite-harness';

/*
 * E1.07-D1-H (PD-64): imutabilidade em execução das estruturas de domínio inventariadas.
 *
 * Cada estrutura é comparada com um oráculo literal escrito aqui (nunca derivado da própria
 * estrutura), depois de tentativas reais de alteração; os validadores que a consultam são exercidos
 * com valores legítimos e com o valor que a mutação tentou introduzir. Dados fictícios.
 */

const LATER = '2026-11-14T09:00:00.000Z';

type Mutation = readonly [name: string, mutate: (target: string[]) => unknown];

/** Operações que alteram um array: acrescentar, remover, substituir, reordenar, comprimento e protótipo. */
const arrayMutations = (intruder: string): readonly Mutation[] => [
  ['push', (list) => list.push(intruder)],
  ['unshift', (list) => list.unshift(intruder)],
  ['pop', (list) => list.pop()],
  ['shift', (list) => list.shift()],
  ['splice (remove)', (list) => list.splice(0, 1)],
  ['splice (replace)', (list) => list.splice(0, 1, intruder)],
  ['index assignment', (list) => {
    list[0] = intruder;
  }],
  ['append by index', (list) => {
    list[list.length] = intruder;
  }],
  ['length truncation', (list) => {
    list.length = 1;
  }],
  ['length extension', (list) => {
    list.length += 1;
  }],
  ['reverse', (list) => list.reverse()],
  ['sort', (list) => list.sort((left, right) => (left < right ? 1 : -1))],
  ['fill', (list) => list.fill(intruder)],
  ['copyWithin', (list) => list.copyWithin(0, 1)],
  ['delete', (list) => {
    // eslint-disable-next-line @typescript-eslint/no-array-delete -- tentativa deliberada de remover um elemento
    delete list[0];
  }],
  ['defineProperty (element)', (list) => Object.defineProperty(list, 0, { value: intruder })],
  ['defineProperty (own includes)', (list) => Object.defineProperty(list, 'includes', { value: () => true })],
  ['defineProperty (own find)', (list) => Object.defineProperty(list, 'find', { value: () => intruder })],
  ['setPrototypeOf', (list) => {
    Object.setPrototypeOf(list, { find: () => intruder, includes: () => true });
  }],
];

/** A operação alteraria uma cópia mutável do oráculo? (Em listas de um elemento, `reverse` é um no-op.) */
const isEffective = (mutate: Mutation[1], oracle: readonly string[]): boolean => {
  const probe = [...oracle];
  mutate(probe);
  return (
    Object.getPrototypeOf(probe) !== Array.prototype ||
    Object.getOwnPropertyNames(probe).length !== oracle.length + 1 ||
    probe.length !== oracle.length ||
    probe.some((value, index) => value !== oracle[index])
  );
};

/**
 * Cada tentativa que alteraria a lista tem de falhar com `TypeError` (módulos ES correm em modo
 * estrito); qualquer tentativa tem de deixar a lista exactamente igual ao oráculo, com o protótipo e
 * as propriedades próprias originais.
 */
const expectLockedList = (list: readonly string[], oracle: readonly string[], intruder: string): void => {
  const target = list as unknown as string[];
  for (const [name, mutate] of arrayMutations(intruder)) {
    if (isEffective(mutate, oracle)) {
      expect(() => mutate(target), name).toThrow(TypeError);
    } else {
      try {
        mutate(target);
      } catch (error) {
        expect(error, name).toBeInstanceOf(TypeError);
      }
    }
    expect([...list], name).toEqual(oracle);
  }
  expect(Object.getPrototypeOf(list)).toBe(Array.prototype);
  expect(Object.getOwnPropertyNames(list)).toEqual([...oracle.keys()].map(String).concat('length'));
  expect(Object.isFrozen(list)).toBe(true);
};

type Bounds = { min: number; max: number };

/** Tentativas sobre um registo plano de valores primitivos (limites, políticas, nomes). */
const expectLockedRecord = (record: object, oracle: Readonly<Record<string, unknown>>): void => {
  const target = record as Record<string, unknown>;
  const attempts: readonly (readonly [string, () => unknown])[] = [
    ...Object.keys(oracle).map((key) => [`assign ${key}`, () => {
      target[key] = 'ALTERADO';
    }] as const),
    ...Object.keys(oracle).map((key) => [`delete ${key}`, () => {
      delete target[key];
    }] as const),
    ['add property', () => {
      target['injected'] = 1;
    }],
    ['defineProperty', () => Object.defineProperty(target, Object.keys(oracle)[0] ?? 'x', { value: 'ALTERADO' })],
    ['setPrototypeOf', () => {
      Object.setPrototypeOf(target, { injected: true });
    }],
  ];
  for (const [name, attempt] of attempts) {
    expect(attempt, name).toThrow(TypeError);
    expect({ ...target }, name).toEqual(oracle);
  }
  expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  expect(Object.isFrozen(record)).toBe(true);
};

const expectRejected = (action: () => unknown): void => {
  expect(action).toThrow(DomainValidationError);
};

describe('Domain contract immutability (E1.07-D1-H, PD-64)', () => {
  describe('value lists in shared-types', () => {
    it('H01 keeps the literal types of the frozen lists for consumers', () => {
      expectTypeOf<MembershipScope>().toEqualTypeOf<'COMPANY_WIDE' | 'BRANCH_RESTRICTED'>();
      expectTypeOf<MembershipStatus>().toEqualTypeOf<'ACTIVE' | 'INACTIVE'>();
      expectTypeOf<UserStatus>().toEqualTypeOf<'ACTIVE' | 'SUSPENDED' | 'INACTIVE'>();
      expectTypeOf<CompanyStatus>().toEqualTypeOf<'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE'>();
      expectTypeOf<BranchStatus>().toEqualTypeOf<'ACTIVE' | 'INACTIVE'>();
      expectTypeOf<SectorType>().toEqualTypeOf<'PHARMACY' | 'SUPERMARKET' | 'FUEL_STATION' | 'RESTAURANT'>();
      expectTypeOf<SessionRevocationReason>().toEqualTypeOf<
        | 'logout'
        | 'administrative'
        | 'user-sessions-revoked'
        | 'identity-status-changed'
        | 'credential-replaced'
        | 'security-version-changed'
        | 'service-restarted'
        | 'idle-timeout'
        | 'absolute-timeout'
      >();
      expectTypeOf(SECTOR_TYPES).toEqualTypeOf<readonly ['PHARMACY', 'SUPERMARKET', 'FUEL_STATION', 'RESTAURANT']>();
    });

    it('H02 MEMBERSHIP_SCOPES: no mutation succeeds and an injected scope stays rejected', () => {
      const oracle = ['COMPANY_WIDE', 'BRANCH_RESTRICTED'];
      expectLockedList(MEMBERSHIP_SCOPES, oracle, 'GLOBAL');

      const user = newUser();
      const company = newCompany();
      for (const scope of oracle) {
        expect(createCompanyMembership(companyMembershipInput(user, company, { scope })).scope).toBe(scope);
      }
      expectRejected(() => createCompanyMembership(companyMembershipInput(user, company, { scope: 'GLOBAL' })));
    });

    it('H03 MEMBERSHIP_STATUSES: company and branch memberships keep the original statuses', () => {
      const oracle = ['ACTIVE', 'INACTIVE'];
      expectLockedList(MEMBERSHIP_STATUSES, oracle, 'PENDING');

      const user = newUser();
      const company = newCompany();
      const branch = createBranch(branchInput(company));
      for (const status of oracle) {
        const membership = createCompanyMembership(
          companyMembershipInput(user, company, { scope: 'BRANCH_RESTRICTED', status }),
        );
        expect(membership.status).toBe(status);
        const local = createBranchMembership({
          id: newId(),
          companyMembershipId: membership.id,
          tenantId: company.tenantId,
          companyId: company.id,
          branchId: branch.id,
          status,
          createdAt: CREATED_AT,
        });
        expect(local.status).toBe(status);
      }
      expectRejected(() => createCompanyMembership(companyMembershipInput(user, company, { status: 'PENDING' })));
    });

    it('H04 USER_STATUSES: replacing or removing statuses fails; identities keep the original lifecycle', () => {
      const oracle = ['ACTIVE', 'SUSPENDED', 'INACTIVE'];
      expectLockedList(USER_STATUSES, oracle, 'ROOT');

      for (const status of oracle) expect(createUser(userInput({ status })).status).toBe(status);
      expectRejected(() => createUser(userInput({ status: 'ROOT' })));
    });

    it('H05 COMPANY_STATUSES: DRAFT cannot be removed nor ARCHIVED introduced', () => {
      const oracle = ['DRAFT', 'ACTIVE', 'SUSPENDED', 'INACTIVE'];
      expectLockedList(COMPANY_STATUSES, oracle, 'ARCHIVED');

      for (const status of oracle) expect(restoreCompany(companyInput({ status })).status).toBe(status);
      expectRejected(() => restoreCompany(companyInput({ status: 'ARCHIVED' })));
      expectRejected(() => createCompany(companyInput({ status: 'ARCHIVED' }), TEST_TAX_ID_POLICY));
    });

    it('H06 BRANCH_STATUSES: truncation fails and INACTIVE branches remain reconstructible', () => {
      const oracle = ['ACTIVE', 'INACTIVE'];
      expectLockedList(BRANCH_STATUSES, oracle, 'CLOSED');

      const company = newCompany();
      for (const status of oracle) expect(createBranch(branchInput(company, { status })).status).toBe(status);
      expectRejected(() => createBranch(branchInput(company, { status: 'CLOSED' })));
    });

    it('H07 SECTOR_TYPES: sector classifications cannot be added, removed or reordered', () => {
      const oracle = ['PHARMACY', 'SUPERMARKET', 'FUEL_STATION', 'RESTAURANT'];
      expectLockedList(SECTOR_TYPES, oracle, 'CASINO');

      const company = newCompany();
      for (const sector of oracle) {
        expect(isSectorType(sector)).toBe(true);
        expect(parseSectorType(sector)).toBe(sector);
        expect(createBranch(branchInput(company, { sectorType: sector })).sectorType).toBe(sector);
        expect(SECTOR_LABELS[sector as SectorType].length).toBeGreaterThan(0);
      }
      expect(isSectorType('CASINO')).toBe(false);
      expectRejected(() => parseSectorType('CASINO'));
      expectRejected(() => createBranch(branchInput(company, { sectorType: 'CASINO' })));
    });

    it('H08 SESSION_REVOCATION_REASONS: an injected reason stays rejected on reconstruction', () => {
      const oracle = [
        'logout',
        'administrative',
        'user-sessions-revoked',
        'identity-status-changed',
        'credential-replaced',
        'security-version-changed',
        'service-restarted',
        'idle-timeout',
        'absolute-timeout',
      ];
      expectLockedList(SESSION_REVOCATION_REASONS, oracle, 'stolen');

      for (const reason of oracle) expect(parseOneOf(reason, SESSION_REVOCATION_REASONS, 'revocationReason')).toBe(reason);
      expectRejected(() => parseOneOf('stolen', SESSION_REVOCATION_REASONS, 'revocationReason'));
    });

    it('H09 copies made by consumers stay theirs: mutable, and without effect on validation', () => {
      const copies = [
        [...MEMBERSHIP_SCOPES],
        [...MEMBERSHIP_STATUSES],
        [...USER_STATUSES],
        [...COMPANY_STATUSES],
        [...BRANCH_STATUSES],
        [...SECTOR_TYPES],
        [...SESSION_REVOCATION_REASONS],
      ] as string[][];
      for (const copy of copies) {
        expect(Object.isFrozen(copy)).toBe(false);
        copy.push('INJECTED');
        expect(copy.at(-1)).toBe('INJECTED');
      }
      expectRejected(() => parseSectorType('INJECTED'));
      expectRejected(() => createUser(userInput({ status: 'INJECTED' })));

      // `parseOneOf` não congela a lista recebida do consumidor, nem o protótipo global foi alterado.
      const own = ['A', 'B'];
      expect(parseOneOf('B', own, 'field')).toBe('B');
      own.push('C');
      expect(parseOneOf('C', own, 'field')).toBe('C');
      expect(Object.isFrozen(Array.prototype)).toBe(false);
    });

    it('H10 legitimate state changes keep working on frozen entities and leave inputs unfrozen', () => {
      const input = userInput();
      const user = createUser(input);
      expect(Object.isFrozen(input)).toBe(false);
      expect(changeUserStatus(user, 'SUSPENDED', LATER).status).toBe('SUSPENDED');
      expect(user.status).toBe('ACTIVE');

      const company = newCompany();
      expect(deactivateCompany(company, LATER).status).toBe('INACTIVE');
      const branch = createBranch(branchInput(company));
      expect(deactivateBranch(branch, LATER).status).toBe('INACTIVE');

      const membership = createCompanyMembership(
        companyMembershipInput(user, company, { scope: 'BRANCH_RESTRICTED' }),
      );
      expect(deactivateCompanyMembership(membership, LATER).status).toBe('INACTIVE');
      const local = createBranchMembership({
        id: newId(),
        companyMembershipId: membership.id,
        tenantId: company.tenantId,
        companyId: company.id,
        branchId: branch.id,
        status: 'ACTIVE',
        createdAt: CREATED_AT,
      });
      expect(deactivateBranchMembership(local, LATER).status).toBe('INACTIVE');

      const policyInput = { maxActiveSessionsPerUser: 3 };
      expect(parseSessionPolicy(policyInput).maxActiveSessionsPerUser).toBe(3);
      expect(Object.isFrozen(policyInput)).toBe(false);
    });
  });

  describe('tax identification policy (defensive snapshot)', () => {
    /** Estado de uma empresa `ACTIVE` criada com o NIF dado; lança se a regra fiscal o recusar. */
    const activeWith = (nif: string, policy: TaxIdPolicy = TEST_TAX_ID_POLICY): string =>
      createCompany(companyInput({ nif }), policy).status;

    it('H11 ruleFor returns a frozen snapshot: replacing the rule through it fails and validation is unchanged', () => {
      const rule = TEST_TAX_ID_POLICY.ruleFor(parseJurisdiction('ZZ'));
      expect(rule).toBeDefined();
      if (rule === undefined) return;
      const target = rule as unknown as Record<string, unknown>;
      const attempts: readonly (readonly [string, () => unknown])[] = [
        ['assign isValid', () => {
          target['isValid'] = () => true;
        }],
        ['assign jurisdiction', () => {
          target['jurisdiction'] = 'AO';
        }],
        ['assign source', () => {
          target['source'] = 'alterada';
        }],
        ['delete isValid', () => {
          delete target['isValid'];
        }],
        ['defineProperty', () => Object.defineProperty(target, 'isValid', { value: () => true })],
        ['setPrototypeOf', () => {
          Object.setPrototypeOf(target, { isValid: () => true });
        }],
      ];
      for (const [name, attempt] of attempts) expect(attempt, name).toThrow(TypeError);

      expect(Object.isFrozen(rule)).toBe(true);
      expect(rule.jurisdiction).toBe('ZZ');
      expect(activeWith('NIF-TESTE-0042')).toBe('ACTIVE');
      expectRejected(() => activeWith('999'));
      expect(TEST_TAX_ID_POLICY.ruleFor(parseJurisdiction('ZZ'))).toBe(rule);
    });

    it('H12 later changes to the consumer rule object or array do not alter a created policy', () => {
      const rule: { -readonly [K in keyof TaxIdRule]: TaxIdRule[K] } = {
        isValid: (nif) => nif === 'NIF-H12',
        jurisdiction: parseJurisdiction('ZZ'),
        source: 'Regra fictícia exclusiva para testes automatizados',
      };
      const rules: TaxIdRule[] = [rule];
      const policy = createTaxIdPolicy(rules);

      rule.isValid = () => true;
      rule.jurisdiction = parseJurisdiction('YY');
      rules.push({ isValid: () => true, jurisdiction: parseJurisdiction('XX'), source: 'Outra regra fictícia' });

      // O objecto e o array do consumidor continuam dele: alteráveis e não congelados.
      expect(Object.isFrozen(rule)).toBe(false);
      expect(Object.isFrozen(rules)).toBe(false);
      expect(policy.ruleFor(parseJurisdiction('ZZ'))).not.toBe(rule);
      expect(policy.ruleFor(parseJurisdiction('YY'))).toBeUndefined();
      expect(policy.ruleFor(parseJurisdiction('XX'))).toBeUndefined();
      expect(activeWith('NIF-H12', policy)).toBe('ACTIVE');
      expectRejected(() => activeWith('NIF-OUTRO', policy));
    });

    // Alterado em E1.07-D1-H-R1 (D-176): a versão anterior afirmava que o receptor era o objecto
    // original, o que institucionalizava RV-D1-H-M-01. O contrato passa a excluir `this`.
    it('H13 the snapshot never calls the rule with the original object as receiver', () => {
      const receivers: unknown[] = [];
      const rule = {
        isValid(nif: string): boolean {
          receivers.push(this);
          return nif.startsWith('H13-');
        },
        jurisdiction: parseJurisdiction('ZZ'),
        source: 'Regra fictícia exclusiva para testes automatizados',
      };
      const policy = createTaxIdPolicy([rule]);
      expect(activeWith('H13-0001', policy)).toBe('ACTIVE');
      expectRejected(() => activeWith('X-0001', policy));
      expect(receivers).toHaveLength(2);
      for (const receiver of receivers) expect(receiver).not.toBe(rule);
    });

    it('H14 the empty policy stays frozen and fails closed', () => {
      expect(() => {
        (EMPTY_TAX_ID_POLICY as unknown as Record<string, unknown>)['ruleFor'] = () => TEST_TAX_ID_POLICY.ruleFor(parseJurisdiction('ZZ'));
      }).toThrow(TypeError);
      expect(EMPTY_TAX_ID_POLICY.ruleFor(parseJurisdiction('ZZ'))).toBeUndefined();
      expectRejected(() => activeWith('NIF-TESTE-0001', EMPTY_TAX_ID_POLICY));
    });
  });

  describe('persistence and local service structures', () => {
    it('H15 DATABASE_FILE_EXTENSIONS: no extension can be added and the location check still refuses others', () => {
      const oracle = ['.sqlite', '.sqlite3', '.db'];
      expectLockedList(DATABASE_FILE_EXTENSIONS, oracle, '.txt');

      // Caminhos nunca criados: a validação da localização não toca no sistema de ficheiros.
      const directory = path.join(tmpdir(), 'kil-business-d1h-not-created');
      for (const extension of oracle) {
        const location = path.join(directory, `base${extension}`);
        expect(resolveDatabaseLocation(location, { protectedDirectories: [] })).toBe(location);
      }
      expect(() => resolveDatabaseLocation(path.join(directory, 'base.txt'), { protectedDirectories: [] })).toThrow(
        expect.objectContaining({ reason: 'location-invalid-extension' }),
      );
    });

    it('H16 LOCAL_SERVICE_TRANSITIONS: inner transition lists are frozen, not only the outer object', async () => {
      const oracle: Readonly<Record<LocalServiceState, readonly string[]>> = {
        STOPPED: ['STARTING'],
        STARTING: ['READY', 'FAILED'],
        READY: ['STOPPING'],
        STOPPING: ['STOPPED', 'FAILED'],
        FAILED: ['STARTING', 'STOPPED'],
      };
      expect(() => {
        (LOCAL_SERVICE_TRANSITIONS as Record<string, unknown>)['READY'] = ['STOPPING', 'STARTING'];
      }).toThrow(TypeError);
      for (const [state, allowed] of Object.entries(oracle)) {
        expectLockedList(LOCAL_SERVICE_TRANSITIONS[state as LocalServiceState], allowed, 'STARTING');
      }
      expect(LOCAL_SERVICE_TRANSITIONS).toEqual(oracle);
      expect(LOCAL_SERVICE_TRANSITIONS.READY.includes('STARTING')).toBe(false);

      // O ciclo de vida normal continua a funcionar sobre uma base temporária própria.
      const temporary = createTemporaryDatabase();
      try {
        const { service } = createServiceUnderTest(serviceConfig(temporary.filename));
        await service.start();
        expect(service.state).toBe('READY');
        await service.stop();
        expect(service.state).toBe('STOPPED');
        await service.start();
        expect(service.state).toBe('READY');
        await service.stop();
        expect(service.state).toBe('STOPPED');
      } finally {
        temporary.dispose();
      }
    });

    it('H17 STORED_PARAMETER_BOUNDS: inner bounds are frozen and tampered credentials stay refused', () => {
      const oracle: Readonly<Record<string, Bounds>> = {
        hashBytes: { max: 64, min: 32 },
        memoryKiB: { max: 1048576, min: 19456 },
        parallelism: { max: 16, min: 1 },
        passes: { max: 16, min: 1 },
        saltBytes: { max: 64, min: 16 },
      };
      expect(() => {
        (STORED_PARAMETER_BOUNDS as unknown as Record<string, unknown>)['memoryKiB'] = { max: 8388608, min: 1 };
      }).toThrow(TypeError);
      for (const [key, bounds] of Object.entries(oracle)) {
        expectLockedRecord(STORED_PARAMETER_BOUNDS[key as keyof typeof STORED_PARAMETER_BOUNDS], bounds);
      }
      expect(STORED_PARAMETER_BOUNDS).toEqual(oracle);

      const stored = (overrides: Partial<PasswordHash> = {}): PasswordHash => ({
        algorithm: 'argon2id',
        algorithmVersion: 19,
        ...PASSWORD_HASHING_PARAMETERS,
        hash: Buffer.alloc(32),
        salt: Buffer.alloc(16),
        ...overrides,
      });
      expect(() => assertStoredHash(stored())).not.toThrow();
      for (const tampered of [
        stored({ memoryKiB: 4194304 }),
        stored({ salt: Buffer.alloc(8) }),
        stored({ hash: Buffer.alloc(16) }),
        stored({ passes: 64 }),
      ]) {
        expect(() => assertStoredHash(tampered)).toThrow(PasswordHashingError);
      }
      expect(assertHashingParameters(PASSWORD_HASHING_PARAMETERS)).toEqual(PASSWORD_HASHING_PARAMETERS);
      expect(() => assertHashingParameters({ ...PASSWORD_HASHING_PARAMETERS, memoryKiB: 4194304 })).toThrow(
        PasswordHashingError,
      );
    });

    it('H18 configuration lists: injected values stay refused and the log level order is preserved', () => {
      expectLockedList(LOCAL_SERVICE_ENVIRONMENTS, ['development', 'test', 'production'], 'staging');
      expectLockedList(LOG_LEVELS, ['debug', 'info', 'warn', 'error'], 'silent');
      expectLockedList(MISSING_DATABASE_POLICIES, ['create', 'fail'], 'maybe');
      expectLockedList(PENDING_MIGRATION_POLICIES, ['apply', 'fail'], 'skip');
      expectTypeOf<LocalServiceEnvironment>().toEqualTypeOf<'development' | 'test' | 'production'>();
      expectTypeOf<LogLevel>().toEqualTypeOf<'debug' | 'info' | 'warn' | 'error'>();
      expectTypeOf<MissingDatabasePolicy>().toEqualTypeOf<'create' | 'fail'>();
      expectTypeOf<PendingMigrationPolicy>().toEqualTypeOf<'apply' | 'fail'>();

      const databasePath = path.join(tmpdir(), 'kil-business-d1h-not-created', 'base.sqlite');
      const parse = (overrides: Readonly<Record<string, unknown>>) =>
        parseLocalServiceConfig(
          {
            databasePath,
            environment: 'test',
            instanceId: 'd1h-test',
            logLevel: 'info',
            startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'fail' },
            ...overrides,
          },
          { protectedDirectories: PROTECTED_DIRECTORIES },
        );
      expect(parse({}).startupPolicy).toEqual({ onMissingDatabase: 'fail', onPendingMigrations: 'fail' });
      for (const overrides of [
        { environment: 'staging' },
        { logLevel: 'silent' },
        { startupPolicy: { onMissingDatabase: 'maybe', onPendingMigrations: 'fail' } },
        { startupPolicy: { onMissingDatabase: 'fail', onPendingMigrations: 'skip' } },
      ]) {
        expect(() => parse(overrides)).toThrow(LocalServiceConfigError);
      }

      const lines: string[] = [];
      const logger = createJsonLogger({ instanceId: 'd1h-test', level: 'warn', sink: (line) => lines.push(line) });
      logger.log('info', 'd1h.info');
      logger.log('error', 'd1h.error');
      expect(lines.map((line) => (JSON.parse(line) as { event: string }).event)).toEqual(['d1h.error']);
    });

    it('H19 LOCAL_SERVICE_ENV: variable names cannot be redirected', () => {
      const oracle = {
        databasePath: 'LOCAL_DATABASE_PATH',
        environment: 'LOCAL_SERVICE_ENVIRONMENT',
        instanceId: 'LOCAL_SERVICE_INSTANCE_ID',
        logLevel: 'LOCAL_SERVICE_LOG_LEVEL',
        onMissingDatabase: 'LOCAL_SERVICE_ON_MISSING_DATABASE',
        onPendingMigrations: 'LOCAL_SERVICE_ON_PENDING_MIGRATIONS',
      };
      expectLockedRecord(LOCAL_SERVICE_ENV, oracle);

      const databasePath = path.join(tmpdir(), 'kil-business-d1h-not-created', 'base.sqlite');
      const config = loadLocalServiceConfigFromEnv(
        {
          LOCAL_DATABASE_PATH: databasePath,
          LOCAL_SERVICE_ENVIRONMENT: 'test',
          LOCAL_SERVICE_INSTANCE_ID: 'd1h-env',
          LOCAL_SERVICE_ON_MISSING_DATABASE: 'fail',
          LOCAL_SERVICE_ON_PENDING_MIGRATIONS: 'fail',
          REDIRECTED_DATABASE_PATH: path.join(tmpdir(), 'kil-business-d1h-not-created', 'other.sqlite'),
        },
        { protectedDirectories: PROTECTED_DIRECTORIES },
      );
      expect(config.databasePath).toBe(databasePath);
    });
  });

  describe('structures already protected before D1-H (regression)', () => {
    it('H20 previously frozen policies and catalogues keep rejecting real mutations', () => {
      expectLockedRecord(SECTOR_LABELS, {
        FUEL_STATION: 'Posto de combustível',
        PHARMACY: 'Farmácia',
        RESTAURANT: 'Restauração',
        SUPERMARKET: 'Supermercado',
      });
      expectLockedRecord(DEFAULT_SESSION_POLICY, {
        absoluteLifetimeSeconds: 43200,
        idleTimeoutSeconds: 1800,
        maxActiveSessionsPerUser: 5,
        proofValiditySeconds: 60,
        sessionRetentionDays: 30,
      });
      expectLockedRecord(SESSION_POLICY_LIMITS.maxActiveSessionsPerUser, { max: 20, min: 1 });
      expectLockedRecord(SESSION_POLICY_LIMITS.idleTimeoutSeconds, { max: 28800, min: 60 });
      expectLockedRecord(PASSWORD_HASHING_PARAMETERS, { memoryKiB: 65536, parallelism: 4, passes: 3 });
      expectLockedRecord(MINIMUM_PASSWORD_HASHING_PARAMETERS, { memoryKiB: 19456, parallelism: 1, passes: 2 });
      expectLockedRecord(LOCAL_SERVICE_EXIT_CODES, { invalidConfiguration: 2, ok: 0, startupFailed: 1 });
      expectLockedRecord(AUTHENTICATION_THROTTLE_POLICY, {
        baseLockSeconds: 30,
        clockSkewToleranceSeconds: 60,
        failureMemorySeconds: 86400,
        freeFailures: 5,
        instanceMaxFailures: 100,
        instanceWindowSeconds: 300,
        maxLockSeconds: 900,
        maxTrackedKeys: 10000,
      });

      expect(() => (MIGRATIONS as unknown as unknown[]).push({ name: 'x', sql: '', version: 7 })).toThrow(TypeError);
      for (const migration of MIGRATIONS) {
        expect(() => {
          (migration as unknown as Record<string, unknown>)['sql'] = 'DROP TABLE users';
        }).toThrow(TypeError);
      }
      // E1.07-D2 acrescenta a migração 6; a lista continua congelada.
      expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);

      expect(() => {
        (EMPTY_COMMON_PASSWORD_LIST as unknown as Record<string, unknown>)['includes'] = () => true;
      }).toThrow(TypeError);
      expect(EMPTY_COMMON_PASSWORD_LIST.includes('qualquer-palavra-passe')).toBe(false);
    });
  });
});
