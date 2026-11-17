import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as authorizationModule from '../packages/shared-types/src/authorization';
import * as sharedTypes from '../packages/shared-types/src/index';
import {
  assertRolePermissionAllowed,
  assertTenantContext,
  AUTHORITIES,
  AUTHORIZATION_DENIAL_REASONS,
  AuthorizationContractError,
  checkPermissionCode,
  createExperimentalPermissionCatalog,
  createPermission,
  deactivateRole,
  deactivateRoleAssignment,
  DomainValidationError,
  evaluateAuthorizationFacts,
  extendExperimentalPermissionCatalog,
  INITIAL_PERMISSION_CATALOG_VERSION,
  INITIAL_PERMISSION_DEFINITIONS,
  inspectDomainDecision,
  isDomainAuthorizationDecision,
  isOfficialDomainGrant,
  isOfficialPermissionCatalog,
  listApplicablePermissionCodes,
  OFFICIAL_PERMISSION_CATALOG,
  parsePermissionCode,
  PERMISSION_CATALOG_PROVENANCES,
  PERMISSION_CATEGORIES,
  PERMISSION_SCOPES,
  PERMISSION_STATUSES,
  permissionCatalogProvenance,
  requireOfficialPermissionCatalog,
  requireRecognizedPermissionCatalog,
  requireRegisteredPermission,
  RESERVED_PERMISSION_SEGMENTS,
  ROLE_ASSIGNMENT_SCOPES,
  ROLE_ASSIGNMENT_STATUSES,
  ROLE_STATUSES,
  toExternalDomainEvaluationResponse,
  type AuthorizationDecision,
  type Permission,
  type PermissionCatalog,
  type PermissionDefinition,
} from '../packages/shared-types/src/index';
import * as permissionModule from '../packages/shared-types/src/permission';
import {
  assignAtBranch,
  assignCompanyWide,
  branchTarget,
  companyFacts,
  companyTarget,
  factsFor,
  grantTo,
  newRole,
  officialFactsFor,
  requestFor,
  TEST_CATALOG,
  tenantScenario,
} from './support/authorization-fixtures';
import { UPDATED_AT } from './support/fixtures';

/*
 * E1.07-D1-R1 — integridade e proveniência das decisões e dos catálogos (PD-62, PD-63) e
 * imutabilidade das definições. O identificador In corresponde ao requisito n da secção 15 da
 * instrução; a matriz está em docs/tasks/E1.07-D1-R1.md. Estas regras continuam puras: nenhuma
 * decisão aqui é autorização operacional (E1.07-D4).
 */

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED_TYPES_SOURCES = path.join(REPOSITORY_ROOT, 'packages', 'shared-types', 'src');

const DENIED_RESPONSE = { allowed: false, error: 'access-denied' } as const;

type Mutable = Record<PropertyKey, unknown>;
const mutable = (value: object): Mutable => value as Mutable;
const mutableArray = (value: readonly unknown[]): unknown[] => value as unknown[];
const expectRejected = (mutation: () => unknown): void => {
  expect(mutation).toThrow(TypeError);
};

const captureError = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
};

const expectContractError = (action: () => unknown, reason: string): void => {
  const error = captureError(action);
  expect(error).toBeInstanceOf(AuthorizationContractError);
  expect(error).toMatchObject({ reason });
};

const officialPermission = (code: string): Permission => {
  const permission = OFFICIAL_PERMISSION_CATALOG.find(parsePermissionCode(code));
  if (permission === undefined) throw new Error(`permissão oficial em falta: ${code}`);
  return permission;
};

const definitionAt = (code: string): PermissionDefinition => {
  const definition = INITIAL_PERMISSION_DEFINITIONS.find((candidate) => candidate.code === code);
  if (definition === undefined) throw new Error(`definição em falta: ${code}`);
  return definition;
};

/** Oráculo independente das 24 permissões oficiais (versão 1): código e âmbito exigido. */
const EXPECTED_OFFICIAL: readonly (readonly [string, 'INSTALLATION' | 'COMPANY' | 'BRANCH'])[] = [
  ['installation.settings.read', 'INSTALLATION'],
  ['installation.settings.update', 'INSTALLATION'],
  ['installation.companies.provision', 'INSTALLATION'],
  ['installation.users.provision', 'INSTALLATION'],
  ['installation.authorities.read', 'INSTALLATION'],
  ['installation.authorities.grant', 'INSTALLATION'],
  ['company.read', 'COMPANY'],
  ['company.update', 'COMPANY'],
  ['branches.create', 'COMPANY'],
  ['branches.update', 'COMPANY'],
  ['branches.read', 'BRANCH'],
  ['memberships.read', 'COMPANY'],
  ['memberships.create', 'COMPANY'],
  ['memberships.update', 'COMPANY'],
  ['permissions.read', 'COMPANY'],
  ['roles.read', 'COMPANY'],
  ['roles.create', 'COMPANY'],
  ['roles.update', 'COMPANY'],
  ['roles.deactivate', 'COMPANY'],
  ['roles.permissions.grant', 'COMPANY'],
  ['roles.permissions.revoke', 'COMPANY'],
  ['roles.assignments.read', 'COMPANY'],
  ['roles.assign', 'COMPANY'],
  ['roles.unassign', 'COMPANY'],
];

const byCode = <T extends { readonly code: string }>(left: T, right: T): number =>
  left.code < right.code ? -1 : left.code > right.code ? 1 : 0;

const expectedOfficialSnapshot = () =>
  EXPECTED_OFFICIAL.map(([code, authorityScope]) => ({
    code,
    authorityScope,
    category: 'ADMINISTRATION',
    status: 'AVAILABLE',
    resource: code.split('.').slice(0, -1).join('.'),
    action: code.split('.').at(-1),
  })).sort(byCode);

const officialSnapshot = () =>
  OFFICIAL_PERMISSION_CATALOG.permissions
    .map(({ action, authorityScope, category, code, resource, status }) => ({ code, authorityScope, category, status, resource, action }))
    .sort(byCode);

const definitionsSnapshot = () =>
  INITIAL_PERMISSION_DEFINITIONS.map(({ authorityScope, category, code, status }) => ({ code, authorityScope, category, status }));

const FORGED_PERMISSION = createPermission({
  authorityScope: 'BRANCH',
  category: 'OPERATION',
  code: 'sales.create',
  description: 'Permissão fabricada para os ensaios',
});
const FORGED_DEFINITION: PermissionDefinition = Object.freeze({
  authorityScope: 'INSTALLATION',
  category: 'ADMINISTRATION',
  code: 'installation.backdoor.open',
  description: 'Definição não autorizada',
});

/** Catálogo fabricado: mesma versão e mesmas permissões que o oficial, mais um código fictício. */
const fabricatedCatalog = (): PermissionCatalog =>
  ({
    version: INITIAL_PERMISSION_CATALOG_VERSION,
    permissions: OFFICIAL_PERMISSION_CATALOG.permissions,
    find: (code: string) => (code === FORGED_PERMISSION.code ? FORGED_PERMISSION : OFFICIAL_PERMISSION_CATALOG.find(parsePermissionCode(code))),
    isRegistered: () => true,
  }) as unknown as PermissionCatalog;

/** Associação `COMPANY_WIDE` com um perfil activo e as concessões indicadas. */
const companyWideGrant = (codes: readonly string[] = ['company.read']) => {
  const scenario = tenantScenario();
  const role = newRole(scenario.company);
  const assignment = assignCompanyWide(role, scenario.membership);
  const rolePermissions = codes.map((code) => grantTo(role, code));
  const facts = companyFacts(scenario, { roles: [role], rolePermissions, assignments: [assignment] });
  return { ...scenario, assignment, facts, role, rolePermissions };
};

/** Decisão `GRANTED` genuína, avaliada sobre o catálogo OFICIAL. */
const genuineGranted = () => {
  const scenario = companyWideGrant(['company.read', 'roles.read']);
  const request = requestFor(scenario.user, 'company.read', companyTarget(scenario.company));
  return { ...scenario, request, decision: evaluateAuthorizationFacts(officialFactsFor(request, scenario.facts)) };
};

/** Decisão `DENIED` genuína, avaliada sobre o catálogo OFICIAL. */
const genuineDenied = () => {
  const scenario = companyWideGrant(['company.read']);
  const request = requestFor(scenario.user, 'company.update', companyTarget(scenario.company));
  return { ...scenario, request, decision: evaluateAuthorizationFacts(officialFactsFor(request, scenario.facts)) };
};

const expectNotRecognized = (value: unknown): void => {
  expect(inspectDomainDecision(value)).toEqual({ recognized: false });
  expect(isDomainAuthorizationDecision(value)).toBe(false);
  expect(isOfficialDomainGrant(value)).toBe(false);
  expect(toExternalDomainEvaluationResponse(value)).toEqual(DENIED_RESPONSE);
};

const expectOfficialGrant = (decision: AuthorizationDecision): void => {
  expect(inspectDomainDecision(decision)).toEqual({ recognized: true, outcome: 'GRANTED', catalog: 'OFFICIAL' });
  expect(isOfficialDomainGrant(decision)).toBe(true);
  expect(toExternalDomainEvaluationResponse(decision)).toEqual({ allowed: true });
};

const expectRecognizedDenial = (decision: AuthorizationDecision, reason: string): void => {
  expect(decision).toEqual({ outcome: 'DENIED', reason });
  expect(inspectDomainDecision(decision)).toMatchObject({ recognized: true, outcome: 'DENIED' });
  expect(isOfficialDomainGrant(decision)).toBe(false);
  expect(toExternalDomainEvaluationResponse(decision)).toEqual(DENIED_RESPONSE);
};

/*
 * Tentativas reais de alteração em execução, agrupadas por requisito (24 a 29). Cada uma tem de ser
 * recusada com `TypeError` (módulos ES em modo estrito); I30 executa todas e confirma o catálogo.
 */
const DEFINITION_ARRAY_ATTEMPTS: readonly (() => unknown)[] = [
  () => mutableArray(INITIAL_PERMISSION_DEFINITIONS).push(FORGED_DEFINITION),
  () => mutableArray(INITIAL_PERMISSION_DEFINITIONS).pop(),
  () => mutableArray(INITIAL_PERMISSION_DEFINITIONS).reverse(),
  () => mutableArray(INITIAL_PERMISSION_DEFINITIONS).splice(0, 1),
  () => {
    mutableArray(INITIAL_PERMISSION_DEFINITIONS)[0] = FORGED_DEFINITION;
  },
  () => {
    mutableArray(INITIAL_PERMISSION_DEFINITIONS).length = 0;
  },
];

const DEFINITION_ATTEMPTS: readonly (() => unknown)[] = [
  () => {
    mutable(definitionAt('roles.read')).code = 'sales.create';
  },
  () => {
    mutable(definitionAt('roles.read')).description = 'Descrição alterada';
  },
  () => {
    mutable(definitionAt('roles.read')).category = 'OPERATION';
  },
  () => {
    mutable(definitionAt('roles.read')).status = 'WITHDRAWN';
  },
  () => delete mutable(definitionAt('roles.read')).category,
  () => Object.defineProperty(definitionAt('roles.read'), 'code', { value: 'sales.create' }),
  () => {
    mutable(definitionAt('roles.read')).extra = true;
  },
];

const AUTHORITY_ATTEMPTS: readonly (() => unknown)[] = [
  // Transformar permissões empresariais em permissões da instalação (definição e permissão viva).
  () => {
    mutable(definitionAt('company.update')).authorityScope = 'INSTALLATION';
  },
  () => {
    mutable(officialPermission('company.update')).authorityScope = 'INSTALLATION';
  },
  () => {
    mutable(definitionAt('installation.authorities.grant')).authorityScope = 'COMPANY';
  },
  () => mutableArray(AUTHORITIES).push('GLOBAL'),
  () => mutableArray(PERMISSION_SCOPES).push('GLOBAL'),
];

const SCOPE_ATTEMPTS: readonly (() => unknown)[] = [
  () => {
    mutable(definitionAt('branches.read')).authorityScope = 'COMPANY';
  },
  () => {
    mutable(officialPermission('branches.read')).authorityScope = 'COMPANY';
  },
  () => {
    mutable(officialPermission('roles.assign')).authorityScope = 'BRANCH';
  },
  () => {
    mutable(officialPermission('company.read')).category = 'OPERATION';
  },
  () => {
    mutable(officialPermission('company.read')).status = 'WITHDRAWN';
  },
  () => mutableArray(ROLE_ASSIGNMENT_SCOPES).push('TENANT'),
];

const ADDITION_ATTEMPTS: readonly (() => unknown)[] = [
  () => mutableArray(OFFICIAL_PERMISSION_CATALOG.permissions).push(FORGED_PERMISSION),
  () => mutableArray(OFFICIAL_PERMISSION_CATALOG.permissions).pop(),
  () => {
    mutable(OFFICIAL_PERMISSION_CATALOG).find = () => FORGED_PERMISSION;
  },
  () => {
    mutable(OFFICIAL_PERMISSION_CATALOG).isRegistered = () => true;
  },
  () => {
    mutable(OFFICIAL_PERMISSION_CATALOG).permissions = [FORGED_PERMISSION];
  },
  () => {
    mutable(OFFICIAL_PERMISSION_CATALOG).version = 2;
  },
  () => Object.defineProperty(OFFICIAL_PERMISSION_CATALOG, 'extra', { value: FORGED_PERMISSION }),
  () => {
    Object.setPrototypeOf(OFFICIAL_PERMISSION_CATALOG, { find: () => FORGED_PERMISSION });
  },
  () => {
    mutable(officialPermission('roles.read')).code = 'sales.create';
  },
];

const RETURNED_COLLECTION_ATTEMPTS: readonly (() => unknown)[] = [
  () => {
    mutableArray(OFFICIAL_PERMISSION_CATALOG.permissions)[0] = FORGED_PERMISSION;
  },
  () => mutableArray(OFFICIAL_PERMISSION_CATALOG.permissions).sort(),
  () => mutableArray(RESERVED_PERMISSION_SEGMENTS).pop(),
  () => mutableArray(PERMISSION_CATEGORIES).push('SUPERUSER'),
  () => mutableArray(PERMISSION_STATUSES).push('GRANTED'),
  () => mutableArray(PERMISSION_CATALOG_PROVENANCES).push('TRUSTED'),
  () => mutableArray(AUTHORIZATION_DENIAL_REASONS).pop(),
  () => mutableArray(ROLE_STATUSES).push('SUPERUSER'),
  () => mutableArray(ROLE_ASSIGNMENT_STATUSES).push('PERMANENT'),
];

describe('E1.07-D1-R1 decision provenance', () => {
  it('I01 recognises a genuine GRANTED decision emitted by the pure evaluator', () => {
    const { decision } = genuineGranted();
    expect(decision.outcome).toBe('GRANTED');
    expect(isDomainAuthorizationDecision(decision)).toBe(true);
    expectOfficialGrant(decision);
    expect(Object.isFrozen(inspectDomainDecision(decision))).toBe(true);
  });

  it('I02 recognises a genuine DENIED decision without granting anything', () => {
    const { decision } = genuineDenied();
    expect(inspectDomainDecision(decision)).toEqual({ recognized: true, outcome: 'DENIED', catalog: 'OFFICIAL' });
    expect(isDomainAuthorizationDecision(decision)).toBe(true);
    expectRecognizedDenial(decision, 'permission-not-granted');
  });

  it('I03 rejects the minimal forged object { outcome: "GRANTED" }', () => {
    expectNotRecognized({ outcome: 'GRANTED' });
    expectNotRecognized(Object.freeze({ outcome: 'GRANTED' }));
    expectNotRecognized({ outcome: 'GRANTED', allowed: true, recognized: true, catalog: 'OFFICIAL' });
  });

  it('I04 rejects a forged object with the complete structure of a genuine grant', () => {
    const { decision } = genuineGranted();
    if (decision.outcome !== 'GRANTED') throw new Error('esperada concessão');
    // Mesmos campos e até o mesmo array congelado de proveniência da decisão genuína.
    expectNotRecognized({ outcome: 'GRANTED', permissionCode: decision.permissionCode, grants: decision.grants });
    expectNotRecognized(Object.freeze({ outcome: 'GRANTED', permissionCode: decision.permissionCode, grants: decision.grants }));
    // Herança do protótipo e Proxy não transportam a identidade do objecto emitido.
    expectNotRecognized(Object.create(decision));
    expectNotRecognized(new Proxy(decision, {}));
  });

  it('I05 rejects objects converted to a decision through type assertions', () => {
    // @ts-expect-error -- um literal estrutural não é uma AuthorizationDecision sem asserção explícita
    const literal: AuthorizationDecision = { outcome: 'DENIED', reason: 'permission-not-granted' };
    const asserted = { outcome: 'GRANTED', permissionCode: parsePermissionCode('company.read'), grants: [] } as unknown as AuthorizationDecision;
    expectNotRecognized(literal);
    expectNotRecognized(asserted);
    expect(toExternalDomainEvaluationResponse(asserted)).toEqual(DENIED_RESPONSE);
  });

  it('I06 does not recognise clones or copies of a genuine decision', () => {
    const { decision } = genuineGranted();
    const sameReference: unknown = [decision][0];
    expectOfficialGrant(sameReference as AuthorizationDecision);
    for (const copy of [structuredClone(decision), { ...decision }, Object.assign({}, decision), Object.freeze({ ...decision })]) {
      expect(copy).toEqual(decision);
      expectNotRecognized(copy);
    }
  });

  it('I07 does not transfer authority through serialisation and deserialisation', () => {
    const { decision } = genuineGranted();
    const serialized = JSON.stringify(decision);
    const restored: unknown = JSON.parse(serialized);
    expect(restored).toEqual(decision);
    expectNotRecognized(restored);
    expect(serialized).not.toMatch(/recognized|OFFICIAL|catalog/);
    expectNotRecognized(JSON.parse(JSON.stringify({ decision })));
  });

  it('I08 keeps a genuine DENIED decision denied after mutation attempts', () => {
    const { decision } = genuineDenied();
    expectRejected(() => {
      mutable(decision).outcome = 'GRANTED';
    });
    expectRejected(() => Object.defineProperty(decision, 'outcome', { value: 'GRANTED' }));
    expectRejected(() => delete mutable(decision).reason);
    expectRejected(() => {
      mutable(decision).reason = 'no-membership';
    });
    expectRejected(() => {
      mutable(decision).grants = [];
    });
    expect(Reflect.set(decision, 'outcome', 'GRANTED')).toBe(false);
    expectRecognizedDenial(decision, 'permission-not-granted');
  });

  it('I09 keeps a genuine GRANTED decision consistent and rejects added fields', () => {
    const { decision } = genuineGranted();
    expectRejected(() => {
      mutable(decision).outcome = 'DENIED';
    });
    expectRejected(() => {
      mutable(decision).permissionCode = 'installation.settings.update';
    });
    expectRejected(() => {
      mutable(decision).tenantContext = { tenantId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' };
    });
    expectRejected(() => {
      mutable(decision).reason = 'permission-not-granted';
    });
    expect(decision).toMatchObject({ outcome: 'GRANTED', permissionCode: 'company.read' });
    expect(Object.keys(decision).sort()).toEqual(['grants', 'outcome', 'permissionCode']);
    expectOfficialGrant(decision);
  });

  it('I10 protects internal structures and is unaffected by shared references', () => {
    const { decision, rolePermissions } = genuineGranted();
    if (decision.outcome !== 'GRANTED') throw new Error('esperada concessão');
    const [grant] = decision.grants;
    if (grant === undefined || grant.source !== 'ROLE_ASSIGNMENT') throw new Error('esperada proveniência por atribuição');
    expectRejected(() => mutableArray(decision.grants).push(grant));
    expectRejected(() => {
      mutableArray(decision.grants).length = 0;
    });
    expectRejected(() => {
      mutable(grant).source = 'INSTALLATION_AUTHORITY';
    });
    expectRejected(() => {
      mutable(grant).assignmentScope = 'BRANCH';
    });
    expectRejected(() => Object.setPrototypeOf(decision, {}));
    expectRejected(() => {
      mutable(inspectDomainDecision(decision)).catalog = 'EXPERIMENTAL';
    });
    // Alterar os factos depois da avaliação não altera a decisão já emitida (cópia interna).
    const before = JSON.stringify(decision);
    rolePermissions.splice(0, rolePermissions.length);
    expect(JSON.stringify(decision)).toBe(before);
    expect(decision.grants).toHaveLength(1);
    expectOfficialGrant(decision);
  });

  it('I11 converts forged decisions into the generic refusal', () => {
    const { decision } = genuineGranted();
    const forged: unknown[] = [
      { outcome: 'GRANTED' },
      { ...decision },
      { allowed: true },
      { outcome: 'GRANTED', permissionCode: 'company.read', grants: [{ source: 'INSTALLATION_AUTHORITY', permissionCode: 'company.read' }] },
    ];
    for (const value of forged) expect(toExternalDomainEvaluationResponse(value)).toEqual(DENIED_RESPONSE);
  });

  it('I12 converts genuine refusals and experimental grants into the generic refusal', () => {
    expect(toExternalDomainEvaluationResponse(genuineDenied().decision)).toEqual(DENIED_RESPONSE);
    const { company, facts, user } = companyWideGrant(['company.read']);
    const experimental = evaluateAuthorizationFacts(factsFor(requestFor(user, 'company.read', companyTarget(company)), facts));
    expect(inspectDomainDecision(experimental)).toEqual({ recognized: true, outcome: 'GRANTED', catalog: 'EXPERIMENTAL' });
    expect(isOfficialDomainGrant(experimental)).toBe(false);
    expect(toExternalDomainEvaluationResponse(experimental)).toEqual(DENIED_RESPONSE);
  });

  it('I13 keeps a single generic access-denied response without identifiers', () => {
    const { company, decision, role, user } = genuineDenied();
    const responses = [decision, { outcome: 'GRANTED' }, null, undefined, 'GRANTED'].map(toExternalDomainEvaluationResponse);
    for (const response of responses) {
      expect(response).toBe(responses[0]);
      expect(response).toEqual(DENIED_RESPONSE);
      expect(Object.isFrozen(response)).toBe(true);
      expect(Object.keys(response).sort()).toEqual(['allowed', 'error']);
      const serialized = JSON.stringify(response);
      for (const secret of [user.id, user.username, company.id, company.tenantId, role.id, role.code, 'reason', 'permission-not-granted', 'OFFICIAL']) {
        expect(serialized).not.toContain(secret);
      }
    }
  });

  it('I14 handles invalid values, null and undefined without throwing', () => {
    const { decision } = genuineGranted();
    const invalid: unknown[] = [null, undefined, 0, 1, '', 'GRANTED', true, false, Number.NaN, [], [decision], Symbol('GRANTED'), () => 'GRANTED', new Date(), OFFICIAL_PERMISSION_CATALOG];
    for (const value of invalid) {
      expect(() => inspectDomainDecision(value)).not.toThrow();
      expectNotRecognized(value);
    }
    for (const facts of [null, undefined]) expectRecognizedDenial(evaluateAuthorizationFacts(facts as never), 'inconsistent-facts');
    for (const facts of [{}, { request: undefined }]) expectRecognizedDenial(evaluateAuthorizationFacts(facts as never), 'untrusted-catalog');
    expectRecognizedDenial(evaluateAuthorizationFacts({ catalog: OFFICIAL_PERMISSION_CATALOG, request: undefined as never }), 'inconsistent-facts');
    const { request } = genuineGranted();
    expectRecognizedDenial(evaluateAuthorizationFacts({ catalog: null as never, request }), 'untrusted-catalog');
    expect(permissionCatalogProvenance(decision)).toBe('UNKNOWN');
  });
});

describe('E1.07-D1-R1 catalog provenance', () => {
  it('I15 recognises the official operational catalog', () => {
    expect(permissionCatalogProvenance(OFFICIAL_PERMISSION_CATALOG)).toBe('OFFICIAL');
    expect(isOfficialPermissionCatalog(OFFICIAL_PERMISSION_CATALOG)).toBe(true);
    expect(requireOfficialPermissionCatalog(OFFICIAL_PERMISSION_CATALOG)).toBe(OFFICIAL_PERMISSION_CATALOG);
    expect(requireRecognizedPermissionCatalog(OFFICIAL_PERMISSION_CATALOG)).toBe(OFFICIAL_PERMISSION_CATALOG);
    expect(OFFICIAL_PERMISSION_CATALOG.version).toBe(INITIAL_PERMISSION_CATALOG_VERSION);
    expect(OFFICIAL_PERMISSION_CATALOG.permissions).toHaveLength(24);
    expect(PERMISSION_CATALOG_PROVENANCES).toEqual(['OFFICIAL', 'EXPERIMENTAL', 'UNKNOWN']);
  });

  it('I16 recognises experimental catalogs as experimental only', () => {
    const created = createExperimentalPermissionCatalog(1, [{ authorityScope: 'COMPANY', category: 'ADMINISTRATION', code: 'reports.read', description: 'Fictícia' }]);
    const extendedFromOfficial = extendExperimentalPermissionCatalog(OFFICIAL_PERMISSION_CATALOG, 2, []);
    for (const catalog of [TEST_CATALOG, created, extendedFromOfficial, extendExperimentalPermissionCatalog(TEST_CATALOG, 3, [])]) {
      expect(permissionCatalogProvenance(catalog)).toBe('EXPERIMENTAL');
      expect(isOfficialPermissionCatalog(catalog)).toBe(false);
      expect(requireRecognizedPermissionCatalog(catalog)).toBe(catalog);
      expectContractError(() => requireOfficialPermissionCatalog(catalog), 'catalog-not-official');
    }
  });

  it('I17 rejects fabricated catalogs as official and exposes no other way to register one', () => {
    // @ts-expect-error -- um literal estrutural não é um PermissionCatalog sem asserção explícita
    const literal: PermissionCatalog = { version: 1, permissions: [], find: () => undefined, isRegistered: () => false };
    const fabricated = fabricatedCatalog();
    for (const catalog of [literal, fabricated]) {
      expect(permissionCatalogProvenance(catalog)).toBe('UNKNOWN');
      expect(isOfficialPermissionCatalog(catalog)).toBe(false);
      expectContractError(() => requireOfficialPermissionCatalog(catalog), 'untrusted-catalog');
      expectContractError(() => requireRecognizedPermissionCatalog(catalog), 'untrusted-catalog');
      expectContractError(() => requireRegisteredPermission(catalog, parsePermissionCode('sales.create')), 'untrusted-catalog');
      expectContractError(() => extendExperimentalPermissionCatalog(catalog, 9, []), 'untrusted-catalog');
    }
    const scenario = tenantScenario();
    const role = newRole(scenario.company);
    expectContractError(() => assertRolePermissionAllowed(role, grantTo(role, 'sales.create'), fabricated), 'untrusted-catalog');
    const facts = companyFacts(scenario, { roles: [role], rolePermissions: [grantTo(role, 'sales.create')], assignments: [assignCompanyWide(role, scenario.membership)] });
    const sale = requestFor(scenario.user, 'sales.create', branchTarget(scenario.company, scenario.branchA));
    expectRecognizedDenial(evaluateAuthorizationFacts(factsFor(sale, facts, { catalog: fabricated })), 'untrusted-catalog');
    expect(listApplicablePermissionCodes({ catalog: fabricated, userId: scenario.user.id, scope: sale.scope, company: facts })).toEqual([]);
    // A mesma concessão sobre o catálogo experimental reconhecido é avaliada, mas não é oficial.
    expect(inspectDomainDecision(evaluateAuthorizationFacts(factsFor(sale, facts)))).toEqual({ recognized: true, outcome: 'GRANTED', catalog: 'EXPERIMENTAL' });
    // A única proveniência oficial é a constante do módulo: as exportações em execução são estas.
    expect(Object.keys(permissionModule).sort()).toEqual(
      [
        'AUTHORITIES', 'INITIAL_PERMISSION_CATALOG_VERSION', 'INITIAL_PERMISSION_DEFINITIONS', 'INSTALLATION_PERMISSION_PREFIX',
        'OFFICIAL_PERMISSION_CATALOG', 'PERMISSION_CATALOG_PROVENANCES', 'PERMISSION_CATEGORIES', 'PERMISSION_CODE_MAX_LENGTH',
        'PERMISSION_MAX_SEGMENTS', 'PERMISSION_MIN_SEGMENTS', 'PERMISSION_SCOPES', 'PERMISSION_SEGMENT_MAX_LENGTH', 'PERMISSION_STATUSES',
        'PLATFORM_PERMISSION_PREFIX', 'RESERVED_PERMISSION_SEGMENTS', 'authorityOfPermissionScope', 'checkPermissionCode',
        'createExperimentalPermissionCatalog', 'createPermission', 'extendExperimentalPermissionCatalog', 'isOfficialPermissionCatalog',
        'isPermissionCode', 'parsePermissionCode', 'permissionCatalogProvenance', 'requireOfficialPermissionCatalog',
        'requireRecognizedPermissionCatalog', 'requireRegisteredPermission',
      ].sort(),
    );
  });

  it('I18 rejects copies, clones and proxies of the official catalog', () => {
    const scenario = companyWideGrant(['company.read']);
    const read = requestFor(scenario.user, 'company.read', companyTarget(scenario.company));
    expectOfficialGrant(evaluateAuthorizationFacts(officialFactsFor(read, scenario.facts)));
    expect(() => structuredClone(OFFICIAL_PERMISSION_CATALOG)).toThrow();
    const copies = [
      { ...OFFICIAL_PERMISSION_CATALOG },
      Object.assign({}, OFFICIAL_PERMISSION_CATALOG),
      Object.freeze({ ...OFFICIAL_PERMISSION_CATALOG }),
      Object.create(OFFICIAL_PERMISSION_CATALOG) as PermissionCatalog,
      new Proxy(OFFICIAL_PERMISSION_CATALOG, {}),
    ];
    for (const copy of copies) {
      expect(permissionCatalogProvenance(copy)).toBe('UNKNOWN');
      expect(isOfficialPermissionCatalog(copy)).toBe(false);
      expectContractError(() => requireOfficialPermissionCatalog(copy), 'untrusted-catalog');
      expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(read, scenario.facts, { catalog: copy })), 'untrusted-catalog');
    }
  });

  it('I19 does not accept the official version number as proof of origin', () => {
    const forgedVersion = fabricatedCatalog();
    expect(forgedVersion.version).toBe(OFFICIAL_PERMISSION_CATALOG.version);
    expect(permissionCatalogProvenance(forgedVersion)).toBe('UNKNOWN');
    const experimentalV1 = createExperimentalPermissionCatalog(INITIAL_PERMISSION_CATALOG_VERSION, [definitionAt('company.read')]);
    expect(experimentalV1.version).toBe(OFFICIAL_PERMISSION_CATALOG.version);
    expect(permissionCatalogProvenance(experimentalV1)).toBe('EXPERIMENTAL');
    expectContractError(() => requireOfficialPermissionCatalog(experimentalV1), 'catalog-not-official');
  });

  it('I20 does not accept identical definitions as proof of origin', () => {
    const identical = createExperimentalPermissionCatalog(INITIAL_PERMISSION_CATALOG_VERSION, INITIAL_PERMISSION_DEFINITIONS);
    expect(identical.version).toBe(OFFICIAL_PERMISSION_CATALOG.version);
    expect(identical.permissions).toEqual(OFFICIAL_PERMISSION_CATALOG.permissions);
    expect(permissionCatalogProvenance(identical)).toBe('EXPERIMENTAL');
    expect(isOfficialPermissionCatalog(identical)).toBe(false);
    expectContractError(() => requireOfficialPermissionCatalog(identical), 'catalog-not-official');
    const { company, facts, user } = companyWideGrant(['company.read']);
    const decision = evaluateAuthorizationFacts(factsFor(requestFor(user, 'company.read', companyTarget(company)), facts, { catalog: identical }));
    expect(inspectDomainDecision(decision)).toEqual({ recognized: true, outcome: 'GRANTED', catalog: 'EXPERIMENTAL' });
    expect(toExternalDomainEvaluationResponse(decision)).toEqual(DENIED_RESPONSE);
    const structural = { ...identical, permissions: OFFICIAL_PERMISSION_CATALOG.permissions } as PermissionCatalog;
    expect(permissionCatalogProvenance(structural)).toBe('UNKNOWN');
  });

  it('I21 keeps fictitious permissions testable in explicitly experimental catalogs', () => {
    expect(TEST_CATALOG.isRegistered(parsePermissionCode('sales.create'))).toBe(true);
    const scenario = tenantScenario({ restrictedTo: ['A', 'B'] });
    const cashier = newRole(scenario.company, { code: 'CAIXA' });
    expect(() => assertRolePermissionAllowed(cashier, grantTo(cashier, 'sales.create'), TEST_CATALOG)).not.toThrow();
    const facts = companyFacts(scenario, { roles: [cashier], rolePermissions: [grantTo(cashier, 'sales.create')], assignments: [assignAtBranch(cashier, scenario.membership, scenario.branchA)] });
    const saleA = evaluateAuthorizationFacts(factsFor(requestFor(scenario.user, 'sales.create', branchTarget(scenario.company, scenario.branchA)), facts));
    expect(inspectDomainDecision(saleA)).toEqual({ recognized: true, outcome: 'GRANTED', catalog: 'EXPERIMENTAL' });
    expectRecognizedDenial(evaluateAuthorizationFacts(factsFor(requestFor(scenario.user, 'sales.create', branchTarget(scenario.company, scenario.branchB)), facts)), 'permission-not-granted');
    const extended = extendExperimentalPermissionCatalog(TEST_CATALOG, 3, [{ authorityScope: 'COMPANY', category: 'OPERATION', code: 'accounting.entries.create', description: 'Fictícia' }]);
    expect(extended.isRegistered(parsePermissionCode('accounting.entries.create'))).toBe(true);
    expect(OFFICIAL_PERMISSION_CATALOG.isRegistered(parsePermissionCode('accounting.entries.create'))).toBe(false);
  });

  it('I22 rejects permissions that do not exist in the official catalog', () => {
    const fictitious = ['sales.create', 'accounting.entries.create', 'pos.sales.create', 'stock.items.update', 'invoices.issue', 'platform.licences.read'];
    for (const code of fictitious.filter((candidate) => checkPermissionCode(candidate) === undefined)) {
      const parsed = parsePermissionCode(code);
      expect(OFFICIAL_PERMISSION_CATALOG.find(parsed), code).toBeUndefined();
      expect(OFFICIAL_PERMISSION_CATALOG.isRegistered(parsed), code).toBe(false);
      expectContractError(() => requireRegisteredPermission(OFFICIAL_PERMISSION_CATALOG, parsed), 'unknown-permission');
    }
    const scenario = tenantScenario();
    const role = newRole(scenario.company);
    expectContractError(() => assertRolePermissionAllowed(role, grantTo(role, 'sales.create'), OFFICIAL_PERMISSION_CATALOG), 'unknown-permission');
    const facts = companyFacts(scenario, { roles: [role], rolePermissions: [grantTo(role, 'sales.create')], assignments: [assignCompanyWide(role, scenario.membership)] });
    const sale = requestFor(scenario.user, 'sales.create', branchTarget(scenario.company, scenario.branchA));
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(sale, facts)), 'unknown-permission');
    expect(OFFICIAL_PERMISSION_CATALOG.permissions.filter((permission) => /^(sales|purchases|pos|stock|accounting|invoices|fiscal|platform)\./.test(permission.code))).toEqual([]);
  });

  it('I23 keeps the installation and company authorities separate in the official catalog', () => {
    const installation = OFFICIAL_PERMISSION_CATALOG.permissions.filter((permission) => permission.authorityScope === 'INSTALLATION');
    const company = OFFICIAL_PERMISSION_CATALOG.permissions.filter((permission) => permission.authorityScope !== 'INSTALLATION');
    expect(installation).toHaveLength(6);
    expect(company).toHaveLength(18);
    expect(installation.every((permission) => permission.code.startsWith('installation.') && permission.category === 'ADMINISTRATION')).toBe(true);
    expect(company.some((permission) => permission.code.startsWith('installation.'))).toBe(false);
    const scenario = tenantScenario();
    const role = newRole(scenario.company);
    for (const permission of installation) {
      expectContractError(() => assertRolePermissionAllowed(role, grantTo(role, permission.code), OFFICIAL_PERMISSION_CATALOG), 'permission-authority-incompatible');
    }
    const facts = companyFacts(scenario, { roles: [role], rolePermissions: [grantTo(role, 'installation.settings.update')], assignments: [assignCompanyWide(role, scenario.membership)] });
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(requestFor(scenario.user, 'installation.settings.update', { kind: 'INSTALLATION' }), facts)), 'no-installation-authority');
    const installationFacts = { installation: { user: scenario.user, grants: [{ userId: scenario.user.id, permissionCode: parsePermissionCode('installation.settings.update') }] } };
    expectOfficialGrant(evaluateAuthorizationFacts(officialFactsFor(requestFor(scenario.user, 'installation.settings.update', { kind: 'INSTALLATION' }), undefined, installationFacts)));
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(requestFor(scenario.user, 'company.read', companyTarget(scenario.company)), undefined, installationFacts)), 'no-membership');
  });
});

describe('E1.07-D1-R1 immutability', () => {
  it('I24 rejects changes to the initial definitions array', () => {
    expect(Object.isFrozen(INITIAL_PERMISSION_DEFINITIONS)).toBe(true);
    for (const attempt of DEFINITION_ARRAY_ATTEMPTS) expectRejected(attempt);
    expect(INITIAL_PERMISSION_DEFINITIONS).toHaveLength(24);
    expect(INITIAL_PERMISSION_DEFINITIONS[0]?.code).toBe('installation.settings.read');
  });

  it('I25 rejects changes to individual definitions', () => {
    for (const definition of INITIAL_PERMISSION_DEFINITIONS) expect(Object.isFrozen(definition), definition.code).toBe(true);
    for (const attempt of DEFINITION_ATTEMPTS) expectRejected(attempt);
    expect(definitionAt('roles.read')).toEqual({ authorityScope: 'COMPANY', category: 'ADMINISTRATION', code: 'roles.read', description: 'Consultar os perfis da empresa' });
  });

  it('I26 rejects changes to the authority of a permission', () => {
    for (const attempt of AUTHORITY_ATTEMPTS) expectRejected(attempt);
    expect(definitionAt('company.update').authorityScope).toBe('COMPANY');
    expect(officialPermission('company.update').authorityScope).toBe('COMPANY');
    expect(AUTHORITIES).toEqual(['PLATFORM', 'INSTALLATION', 'COMPANY']);
    expect(PERMISSION_SCOPES).toEqual(['INSTALLATION', 'COMPANY', 'BRANCH']);
    expect(captureError(() => createPermission({ authorityScope: 'GLOBAL', category: 'ADMINISTRATION', code: 'reports.read', description: 'x' }))).toBeInstanceOf(DomainValidationError);
  });

  it('I27 rejects changes to the scope, category and status of a permission', () => {
    for (const attempt of SCOPE_ATTEMPTS) expectRejected(attempt);
    expect(officialPermission('branches.read').authorityScope).toBe('BRANCH');
    expect(officialPermission('roles.assign').authorityScope).toBe('COMPANY');
    expect(officialPermission('company.read')).toMatchObject({ category: 'ADMINISTRATION', status: 'AVAILABLE' });
    expect(ROLE_ASSIGNMENT_SCOPES).toEqual(['COMPANY_WIDE', 'BRANCH']);
  });

  it('I28 rejects unauthorised additions to the official catalog', () => {
    for (const attempt of ADDITION_ATTEMPTS) expectRejected(attempt);
    expect(OFFICIAL_PERMISSION_CATALOG.find(parsePermissionCode('sales.create'))).toBeUndefined();
    expect(OFFICIAL_PERMISSION_CATALOG.isRegistered(parsePermissionCode('installation.backdoor.open'))).toBe(false);
    const extended = extendExperimentalPermissionCatalog(OFFICIAL_PERMISSION_CATALOG, 2, [FORGED_DEFINITION]);
    expect(extended.isRegistered(parsePermissionCode('installation.backdoor.open'))).toBe(true);
    expect(OFFICIAL_PERMISSION_CATALOG.isRegistered(parsePermissionCode('installation.backdoor.open'))).toBe(false);
    expect(OFFICIAL_PERMISSION_CATALOG.permissions).toHaveLength(24);
    expect(OFFICIAL_PERMISSION_CATALOG.version).toBe(1);
  });

  it('I29 returns frozen collections and references to consumers', () => {
    expect(Object.isFrozen(OFFICIAL_PERMISSION_CATALOG)).toBe(true);
    expect(Object.isFrozen(OFFICIAL_PERMISSION_CATALOG.permissions)).toBe(true);
    const first = officialPermission('roles.read');
    expect(officialPermission('roles.read')).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    for (const list of [AUTHORITIES, PERMISSION_SCOPES, PERMISSION_CATEGORIES, PERMISSION_STATUSES, RESERVED_PERMISSION_SEGMENTS, PERMISSION_CATALOG_PROVENANCES, AUTHORIZATION_DENIAL_REASONS, ROLE_STATUSES, ROLE_ASSIGNMENT_SCOPES, ROLE_ASSIGNMENT_STATUSES]) {
      expect(Object.isFrozen(list)).toBe(true);
    }
    for (const attempt of RETURNED_COLLECTION_ATTEMPTS) expectRejected(attempt);
    expect(checkPermissionCode('company.all')).toBe('reserved-segment');
    const { company, facts, user } = companyWideGrant(['company.read', 'roles.read']);
    const { scope } = requestFor(user, 'company.read', companyTarget(company));
    const listed = listApplicablePermissionCodes({ catalog: OFFICIAL_PERMISSION_CATALOG, userId: user.id, scope, company: facts });
    expect(listed).toEqual(['company.read', 'roles.read']);
    expect(Object.isFrozen(listed)).toBe(true);
    expectRejected(() => mutableArray(listed).push('installation.settings.update'));
  });

  it('I30 preserves every official definition after all mutation attempts', () => {
    const before = officialSnapshot();
    const attempts = [...DEFINITION_ARRAY_ATTEMPTS, ...DEFINITION_ATTEMPTS, ...AUTHORITY_ATTEMPTS, ...SCOPE_ATTEMPTS, ...ADDITION_ATTEMPTS, ...RETURNED_COLLECTION_ATTEMPTS];
    let rejected = 0;
    for (const attempt of attempts) {
      if (captureError(attempt) instanceof TypeError) rejected += 1;
    }
    expect(rejected).toBe(attempts.length);
    expect(officialSnapshot()).toEqual(before);
    expect(officialSnapshot()).toEqual(expectedOfficialSnapshot());
    expect(definitionsSnapshot().map(({ code }) => code)).toEqual(EXPECTED_OFFICIAL.map(([code]) => code));
    expect(definitionsSnapshot().every(({ status }) => status === undefined)).toBe(true);
    expect(isOfficialPermissionCatalog(OFFICIAL_PERMISSION_CATALOG)).toBe(true);
    expect(OFFICIAL_PERMISSION_CATALOG.version).toBe(1);
  });
});

describe('E1.07-D1-R1 regressions on the official catalog', () => {
  it('I31 denies by default', () => {
    const scenario = tenantScenario();
    const read = requestFor(scenario.user, 'company.read', companyTarget(scenario.company));
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(read, undefined)), 'no-membership');
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(read, companyFacts(scenario))), 'permission-not-granted');
    const role = newRole(scenario.company);
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(read, companyFacts(scenario, { roles: [role], rolePermissions: [grantTo(role, 'company.read')] }))), 'permission-not-granted');
  });

  it('I32 isolates grants by tenant', () => {
    const own = companyWideGrant(['company.read']);
    const other = companyWideGrant(['company.read']);
    const cross = requestFor(own.user, 'company.read', companyTarget(other.company));
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(cross, own.facts)), 'inconsistent-facts');
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(cross, other.facts)), 'inconsistent-facts');
    expect(listApplicablePermissionCodes({ catalog: OFFICIAL_PERMISSION_CATALOG, userId: own.user.id, scope: cross.scope, company: own.facts })).toEqual([]);
    expectOfficialGrant(evaluateAuthorizationFacts(officialFactsFor(requestFor(other.user, 'company.read', companyTarget(other.company)), other.facts)));
  });

  it('I33 isolates grants by branch', () => {
    const scenario = tenantScenario({ restrictedTo: ['A'] });
    const role = newRole(scenario.company);
    const facts = companyFacts(scenario, { roles: [role], rolePermissions: [grantTo(role, 'branches.read')], assignments: [assignAtBranch(role, scenario.membership, scenario.branchA)] });
    expectOfficialGrant(evaluateAuthorizationFacts(officialFactsFor(requestFor(scenario.user, 'branches.read', branchTarget(scenario.company, scenario.branchA)), facts)));
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(requestFor(scenario.user, 'branches.read', branchTarget(scenario.company, scenario.branchB)), facts)), 'branch-out-of-scope');
    const wide = tenantScenario();
    const wideRole = newRole(wide.company);
    const wideFacts = companyFacts(wide, { roles: [wideRole], rolePermissions: [grantTo(wideRole, 'branches.read')], assignments: [assignAtBranch(wideRole, wide.membership, wide.branchA)] });
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(requestFor(wide.user, 'branches.read', branchTarget(wide.company, wide.branchB)), wideFacts)), 'permission-not-granted');
  });

  it('I34 gives no grants through an inactive role', () => {
    const { company, facts, role, user } = companyWideGrant(['company.read']);
    const inactive = { ...facts, roles: [deactivateRole(role, UPDATED_AT)] };
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(requestFor(user, 'company.read', companyTarget(company)), inactive)), 'permission-not-granted');
  });

  it('I35 gives no grants through an inactive assignment', () => {
    const { assignment, company, facts, user } = companyWideGrant(['company.read']);
    const inactive = { ...facts, assignments: [deactivateRoleAssignment(assignment, UPDATED_AT)] };
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(requestFor(user, 'company.read', companyTarget(company)), inactive)), 'permission-not-granted');
  });

  it('I36 unites grants of several roles only within the requested target', () => {
    const scenario = tenantScenario();
    const reader = newRole(scenario.company, { code: 'LEITOR' });
    const manager = newRole(scenario.company, { code: 'GESTOR' });
    const local = newRole(scenario.company, { code: 'LOJA_A' });
    const facts = companyFacts(scenario, {
      roles: [reader, manager, local],
      rolePermissions: [grantTo(reader, 'company.read'), grantTo(manager, 'roles.read'), grantTo(manager, 'roles.assign'), grantTo(local, 'branches.read')],
      assignments: [assignCompanyWide(reader, scenario.membership), assignCompanyWide(manager, scenario.membership), assignAtBranch(local, scenario.membership, scenario.branchA)],
    });
    for (const code of ['company.read', 'roles.read', 'roles.assign']) {
      expectOfficialGrant(evaluateAuthorizationFacts(officialFactsFor(requestFor(scenario.user, code, companyTarget(scenario.company)), facts)));
    }
    const atCompany = requestFor(scenario.user, 'company.read', companyTarget(scenario.company));
    expect(listApplicablePermissionCodes({ catalog: OFFICIAL_PERMISSION_CATALOG, userId: scenario.user.id, scope: atCompany.scope, company: facts })).toEqual(['company.read', 'roles.assign', 'roles.read']);
    const atB = requestFor(scenario.user, 'branches.read', branchTarget(scenario.company, scenario.branchB));
    expectRecognizedDenial(evaluateAuthorizationFacts(officialFactsFor(atB, facts)), 'permission-not-granted');
    expect(listApplicablePermissionCodes({ catalog: OFFICIAL_PERMISSION_CATALOG, userId: scenario.user.id, scope: atB.scope, company: facts })).toEqual([]);
  });

  it('I37 issues no operational authority and offers no other source of recognised decisions', () => {
    expect(Object.keys(authorizationModule).sort()).toEqual(
      [
        'AUTHORIZATION_DENIAL_REASONS', 'createAuthorizationRequest', 'evaluateAuthorizationFacts', 'inspectDomainDecision',
        'isDomainAuthorizationDecision', 'isOfficialDomainGrant', 'listApplicablePermissionCodes', 'toExternalDomainEvaluationResponse',
      ].sort(),
    );
    const exported = Object.keys(sharedTypes);
    for (const removed of ['isAuthorizationGranted', 'toExternalAuthorizationResponse', 'denyAuthorization', 'createPermissionCatalog', 'extendPermissionCatalog', 'INITIAL_PERMISSION_CATALOG']) {
      expect(exported, removed).not.toContain(removed);
    }
    const { decision } = genuineGranted();
    expectOfficialGrant(decision);
    const external = toExternalDomainEvaluationResponse(decision);
    expect(Object.keys(external)).toEqual(['allowed']);
    for (const value of [decision, external, inspectDomainDecision(decision)]) {
      expect(JSON.stringify(value)).not.toMatch(/tenantId|actorId|sessionId|token|correlationId/);
      expect(() => assertTenantContext(value)).toThrow();
    }
  });

  it('I38 adds no new path to issue an authenticated TenantContext', () => {
    expect(Object.keys(sharedTypes).filter((name) => /TenantContext/.test(name)).sort()).toEqual(['TenantContextError', 'assertTenantContext', 'createTenantContext']);
    for (const file of ['authorization.ts', 'authorization-repositories.ts', 'permission.ts', 'role.ts', 'role-assignment.ts', 'scoped-record.ts', 'errors.ts']) {
      const text = readFileSync(path.join(SHARED_TYPES_SOURCES, file), 'utf8');
      expect(text, file).not.toMatch(/createTenantContext|TenantContextInput|parseActorId|parseCorrelationId/);
    }
    const { decision } = genuineGranted();
    expect(() => assertTenantContext({ ...decision, tenantId: undefined })).toThrow();
  });
});
