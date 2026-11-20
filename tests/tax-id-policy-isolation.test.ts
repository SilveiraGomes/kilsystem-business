import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  assertValidTaxId,
  createCompany,
  createTaxIdPolicy,
  DomainValidationError,
  parseJurisdiction,
  type Jurisdiction,
  type TaxIdPolicy,
  type TaxIdRule,
} from '../packages/shared-types/src/index';
import { companyInput, TEST_TAX_ID_POLICY } from './support/fixtures';

/*
 * E1.07-D1-H-R1 (RV-D1-H-M-01, D-176): isolamento da política fiscal em relação aos objectos do
 * consumidor. Regras fictícias com prefixos inventados; nenhuma representa uma norma real nem um
 * algoritmo do NIF angolano (PD-09).
 */

const ZZ = parseJurisdiction('ZZ');
const YY = parseJurisdiction('YY');
const SOURCE = 'Regra fictícia exclusiva para testes automatizados';

type Validator = (this: void, nif: string) => boolean;
type MutableRule = { -readonly [K in keyof TaxIdRule]: TaxIdRule[K] };

const accepts = (policy: TaxIdPolicy, nif: string, jurisdiction: Jurisdiction = ZZ): boolean => {
  try {
    assertValidTaxId(jurisdiction, nif, policy);
    return true;
  } catch (error) {
    if (error instanceof DomainValidationError) return false;
    throw error;
  }
};

const ruleOf = (policy: TaxIdPolicy, jurisdiction: Jurisdiction = ZZ): TaxIdRule => {
  const rule = policy.ruleFor(jurisdiction);
  if (rule === undefined) throw new Error(`sem regra para ${jurisdiction}`);
  return rule;
};

const captureError = (action: () => unknown): unknown => {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
};

/** Regra que lê estado de `this`: viola o contrato (D-176) e só é construída por asserção. */
const thisDependentRule = (prefix: string) => {
  const rule = {
    config: { prefixes: [prefix] },
    isValid(this: { prefix?: unknown; config?: { prefixes: string[] } } | undefined, nif: string): boolean {
      const own = this?.prefix;
      const nested = this?.config?.prefixes ?? [];
      return (typeof own === 'string' && nif.startsWith(own)) || nested.some((candidate) => nif.startsWith(candidate));
    },
    jurisdiction: ZZ,
    prefix,
    source: SOURCE,
  };
  return { rule, asRule: rule as unknown as TaxIdRule };
};

describe('Tax ID policy isolation (E1.07-D1-H-R1, RV-D1-H-M-01)', () => {
  it('HR01 reproduction: changing state read through `this` after creation no longer changes the policy', () => {
    // Cenário exacto da revisão H-M: antes da correcção, ANTES-001 passava a ser recusado e DEPOIS-001 aceite.
    const { rule, asRule } = thisDependentRule('ANTES-');
    const policy = createTaxIdPolicy([asRule]);
    const before = [accepts(policy, 'ANTES-001'), accepts(policy, 'DEPOIS-001')];

    rule.prefix = 'DEPOIS-';

    expect([accepts(policy, 'ANTES-001'), accepts(policy, 'DEPOIS-001')]).toEqual(before);
    // O estado do objecto do consumidor nunca é visível à regra registada: a regra falha fechada.
    expect(before).toEqual([false, false]);
    expect(Object.isFrozen(rule)).toBe(false);
    expect(rule.prefix).toBe('DEPOIS-');
  });

  it('HR02 a legitimate policy is accepted and exposes exactly the declared, canonical values', () => {
    const policy = createTaxIdPolicy([
      { isValid: (nif) => nif === 'NIF-ZZ-1', jurisdiction: ' zz ' as Jurisdiction, source: SOURCE },
      {
        isValid(nif: string): boolean {
          return nif === 'NIF-YY-1';
        },
        jurisdiction: YY,
        source: SOURCE,
      },
    ]);

    const zz = ruleOf(policy);
    expect(Object.keys(zz).sort()).toEqual(['isValid', 'jurisdiction', 'source']);
    expect(zz.jurisdiction).toBe('ZZ');
    expect(zz.source).toBe(SOURCE);
    expect(policy.ruleFor(parseJurisdiction('XX'))).toBeUndefined();
    expect(accepts(policy, 'NIF-ZZ-1')).toBe(true);
    expect(accepts(policy, 'NIF-YY-1', YY)).toBe(true);
    expect(accepts(policy, 'NIF-YY-1')).toBe(false);
  });

  it('HR03 the legitimate fiscal validation used by the domain is preserved', () => {
    expect(accepts(TEST_TAX_ID_POLICY, 'NIF-TESTE-0042')).toBe(true);
    expect(accepts(TEST_TAX_ID_POLICY, '999')).toBe(false);
    expect(accepts(TEST_TAX_ID_POLICY, 'NIF-TESTE-0042', YY)).toBe(false);
    expect(createCompany(companyInput({ nif: 'NIF-TESTE-0042' }), TEST_TAX_ID_POLICY).status).toBe('ACTIVE');
    expect(() => createCompany(companyInput({ nif: 'NIF-INVALIDO' }), TEST_TAX_ID_POLICY)).toThrow(DomainValidationError);
    expect(() => assertValidTaxId(ZZ, undefined, TEST_TAX_ID_POLICY)).toThrow(DomainValidationError);
  });

  it('HR04 later changes to the original rule object (any property, prototype or shape) have no effect', () => {
    const rule: MutableRule & Record<string, unknown> = { isValid: (nif) => nif === 'NIF-OK', jurisdiction: ZZ, source: SOURCE };
    const policy = createTaxIdPolicy([rule]);
    const snapshot = ruleOf(policy);

    rule.isValid = () => true;
    rule.jurisdiction = YY;
    rule.source = 'Fonte alterada';
    rule['extra'] = 'acrescentada';
    Reflect.deleteProperty(rule, 'isValid');
    Object.defineProperty(rule, 'isValid', { get: () => () => true });
    Object.setPrototypeOf(rule, { isValid: () => true });

    expect(ruleOf(policy)).toBe(snapshot);
    expect(snapshot.source).toBe(SOURCE);
    expect(policy.ruleFor(YY)).toBeUndefined();
    expect(accepts(policy, 'NIF-OK')).toBe(true);
    expect(accepts(policy, 'NIF-MAU')).toBe(false);
  });

  it('HR05 later changes to properties that `isValid` reads through `this` (own and nested) have no effect', () => {
    const { rule, asRule } = thisDependentRule('A-');
    const policy = createTaxIdPolicy([asRule]);
    const probe = ['A-1', 'B-1', 'C-1'].map((nif) => accepts(policy, nif));

    rule.prefix = 'B-';
    rule.config.prefixes.push('C-');
    rule.config = { prefixes: ['A-', 'B-', 'C-'] };

    expect(['A-1', 'B-1', 'C-1'].map((nif) => accepts(policy, nif))).toEqual(probe);
    expect(probe).toEqual([false, false, false]);
  });

  it('HR06 the rule returned by ruleFor, its validator, ruleFor and the policy reject every mutation', () => {
    const policy = createTaxIdPolicy([{ isValid: (nif) => nif === 'NIF-OK', jurisdiction: ZZ, source: SOURCE }]);
    const rule = ruleOf(policy);
    const target = rule as unknown as Record<string, unknown>;
    const validator = rule.isValid as unknown as Record<string, unknown>;
    const ruleFor = policy.ruleFor as unknown as Record<string, unknown>;
    const always = (): boolean => true;
    const attempts: readonly (readonly [string, () => unknown])[] = [
      ['rule: assign isValid', () => (target['isValid'] = always)],
      ['rule: assign source', () => (target['source'] = 'alterada')],
      ['rule: assign jurisdiction', () => (target['jurisdiction'] = 'YY')],
      ['rule: add property', () => (target['extra'] = 1)],
      ['rule: delete isValid', () => delete target['isValid']],
      ['rule: defineProperty', () => Object.defineProperty(target, 'isValid', { value: always })],
      ['rule: setPrototypeOf', () => {
        Object.setPrototypeOf(target, { isValid: always });
      }],
      ['validator: assign call', () => (validator['call'] = always)],
      ['validator: assign apply', () => (validator['apply'] = always)],
      ['validator: defineProperty', () => Object.defineProperty(validator, 'call', { value: always })],
      ['validator: setPrototypeOf', () => {
        Object.setPrototypeOf(validator, null);
      }],
      ['validator: delete name', () => delete validator['name']],
      ['ruleFor: assign call', () => (ruleFor['call'] = always)],
      ['ruleFor: setPrototypeOf', () => {
        Object.setPrototypeOf(ruleFor, null);
      }],
      ['policy: assign ruleFor', () => ((policy as unknown as Record<string, unknown>)['ruleFor'] = () => rule)],
    ];
    for (const [name, attempt] of attempts) expect(attempt, name).toThrow(TypeError);

    for (const value of [policy, policy.ruleFor, rule, rule.isValid]) expect(Object.isFrozen(value)).toBe(true);
    expect(ruleOf(policy)).toBe(rule);
    expect(Object.getPrototypeOf(rule)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(rule.isValid)).toBe(Function.prototype);
    expect(rule.isValid.call(undefined, 'NIF-MAU')).toBe(false);
    expect(accepts(policy, 'NIF-OK')).toBe(true);
    expect(accepts(policy, 'NIF-MAU')).toBe(false);
  });

  it('HR07 validators that use `this` only ever see a neutral, frozen, empty receiver (strict and sloppy)', () => {
    const receivers: unknown[] = [];
    const rule = {
      isValid(nif: string): boolean {
        receivers.push(this);
        return nif === 'NIF-OK';
      },
      jurisdiction: ZZ,
      source: SOURCE,
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- só o construtor cria uma função em modo não estrito (`this` indefinido seria o objecto global)
    const sloppy = new Function('nif', 'return this === globalThis || nif === "NIF-YY";') as unknown as Validator;
    const policy = createTaxIdPolicy([rule, { isValid: sloppy, jurisdiction: YY, source: SOURCE }]);

    expect(accepts(policy, 'NIF-OK')).toBe(true);
    expect(accepts(policy, 'NIF-MAU')).toBe(false);
    // Em modo não estrito, um receptor `undefined` seria substituído por `globalThis` e esta regra aceitaria tudo.
    expect(accepts(policy, 'NIF-QUALQUER', YY)).toBe(false);
    expect(accepts(policy, 'NIF-YY', YY)).toBe(true);

    expect(receivers).toHaveLength(2);
    const [receiver] = receivers;
    expect(receiver).not.toBe(rule);
    expect(receiver).not.toBe(globalThis);
    expect(receivers[1]).toBe(receiver);
    expect(typeof receiver).toBe('object');
    expect(Object.isFrozen(receiver)).toBe(true);
    expect(Object.getPrototypeOf(receiver)).toBeNull();
    expect(Reflect.ownKeys(receiver as object)).toEqual([]);
    expect(() => ((receiver as Record<string, unknown>)['prefix'] = 'X-')).toThrow(TypeError);
  });

  it('HR08 trust boundary: state captured by the validator itself (closure, bound function) stays with the consumer', () => {
    // Limite documentado (D-176): a política não copia nem congela fechos; a regra tem de ser pura.
    const state = { prefix: 'A-' };
    const bound = { prefix: 'A-' };
    const closure: Validator = (nif) => nif.startsWith(state.prefix);
    const boundValidator: Validator = function (this: { prefix: string }, nif: string): boolean {
      return nif.startsWith(this.prefix);
    }.bind(bound);
    const policy = createTaxIdPolicy([
      { isValid: closure, jurisdiction: ZZ, source: SOURCE },
      { isValid: boundValidator, jurisdiction: YY, source: SOURCE },
    ]);
    expect([accepts(policy, 'A-1'), accepts(policy, 'B-1')]).toEqual([true, false]);
    expect([accepts(policy, 'A-1', YY), accepts(policy, 'B-1', YY)]).toEqual([true, false]);

    state.prefix = 'B-';
    bound.prefix = 'B-';

    // O contrato não promete isolamento destes estados: a mudança é visível e o estado não foi congelado.
    expect([accepts(policy, 'A-1'), accepts(policy, 'B-1')]).toEqual([false, true]);
    expect([accepts(policy, 'A-1', YY), accepts(policy, 'B-1', YY)]).toEqual([false, true]);
    expect(Object.isFrozen(state)).toBe(false);
    expect(Object.isFrozen(bound)).toBe(false);
    // O que a política garante continua garantido: a referência da função e a regra devolvida.
    expect(ruleOf(policy).isValid).not.toBe(closure);
    expect(Object.isFrozen(ruleOf(policy))).toBe(true);
  });

  it('HR09 nested or extra properties of the consumer object are neither copied nor reachable', () => {
    const nested = { prefixes: ['A-'], deeper: { enabled: true } };
    const rule = { config: nested, isValid: (nif: string) => nif === 'NIF-OK', jurisdiction: ZZ, source: SOURCE };
    const policy = createTaxIdPolicy([rule]);
    const snapshot = ruleOf(policy);

    expect(Reflect.ownKeys(snapshot).sort()).toEqual(['isValid', 'jurisdiction', 'source']);
    for (const value of Object.values(snapshot)) {
      expect(value === nested || value === nested.prefixes || value === nested.deeper || value === rule).toBe(false);
    }
    nested.prefixes.push('B-');
    nested.deeper.enabled = false;
    expect(accepts(policy, 'NIF-OK')).toBe(true);
    expect(Object.isFrozen(nested)).toBe(false);
    expect(Object.isFrozen(nested.prefixes)).toBe(false);
    expect(Object.isFrozen(nested.deeper)).toBe(false);
  });

  it('HR10 two policies are isolated from each other, even when built from the same consumer object', () => {
    const rule: MutableRule = { isValid: (nif) => nif === 'NIF-1', jurisdiction: ZZ, source: SOURCE };
    const first = createTaxIdPolicy([rule]);
    rule.isValid = (nif) => nif === 'NIF-2';
    const second = createTaxIdPolicy([rule]);

    expect(first).not.toBe(second);
    expect(first.ruleFor).not.toBe(second.ruleFor);
    expect(ruleOf(first)).not.toBe(ruleOf(second));
    expect(ruleOf(first).isValid).not.toBe(ruleOf(second).isValid);
    expect([accepts(first, 'NIF-1'), accepts(first, 'NIF-2')]).toEqual([true, false]);
    expect([accepts(second, 'NIF-1'), accepts(second, 'NIF-2')]).toEqual([false, true]);

    const third = createTaxIdPolicy([{ isValid: () => true, jurisdiction: YY, source: SOURCE }]);
    expect(first.ruleFor(YY)).toBeUndefined();
    expect(second.ruleFor(YY)).toBeUndefined();
    expect(third.ruleFor(ZZ)).toBeUndefined();
  });

  it('HR11 nothing owned by the consumer is frozen: rule, array, validator function and nested data', () => {
    const validator: Validator = (nif) => nif === 'NIF-OK';
    const rules: MutableRule[] = [{ isValid: validator, jurisdiction: ZZ, source: SOURCE }];
    const rulesBefore = [...rules];
    createTaxIdPolicy(rules);

    for (const value of [rules, rules[0], validator]) expect(Object.isFrozen(value)).toBe(false);
    expect(Object.isExtensible(validator)).toBe(true);
    expect(rules).toEqual(rulesBefore);
    rules.push({ isValid: validator, jurisdiction: YY, source: SOURCE });
    expect(rules).toHaveLength(2);
  });

  it('HR12 later changes to the consumer validator function object (call, apply, prototype) have no effect', () => {
    const validator: Validator = (nif) => nif === 'NIF-OK';
    const policy = createTaxIdPolicy([{ isValid: validator, jurisdiction: ZZ, source: SOURCE }]);
    const functionObject = validator as unknown as Record<string, unknown>;

    functionObject['call'] = () => true;
    functionObject['apply'] = () => true;
    Object.setPrototypeOf(validator, { call: () => true, apply: () => true });

    expect(accepts(policy, 'NIF-MAU')).toBe(false);
    expect(accepts(policy, 'NIF-OK')).toBe(true);
  });

  it('HR13 each property of the consumer rule is read once: the validated value is the stored value', () => {
    const reads = { isValid: 0, jurisdiction: 0, source: 0 };
    const rule = {
      get isValid(): Validator {
        reads.isValid += 1;
        return reads.isValid === 1 ? (nif) => nif === 'NIF-OK' : () => true;
      },
      get jurisdiction(): Jurisdiction {
        reads.jurisdiction += 1;
        return reads.jurisdiction === 1 ? ZZ : YY;
      },
      get source(): string {
        reads.source += 1;
        return reads.source === 1 ? SOURCE : '   ';
      },
    };
    const policy = createTaxIdPolicy([rule]);

    expect(reads).toEqual({ isValid: 1, jurisdiction: 1, source: 1 });
    expect(ruleOf(policy).source).toBe(SOURCE);
    expect(policy.ruleFor(YY)).toBeUndefined();
    expect(accepts(policy, 'NIF-MAU')).toBe(false);
    expect(reads).toEqual({ isValid: 1, jurisdiction: 1, source: 1 });
  });

  it('HR14 the contract is validated at creation: a missing or non-function validator is refused', () => {
    const invalid: readonly (readonly [string, unknown])[] = [
      ['undefined', undefined],
      ['null', null],
      ['string', 'true'],
      ['number', 1],
      ['object', {}],
      ['array', []],
      ['symbol', Symbol('isValid')],
    ];
    for (const [label, isValid] of invalid) {
      const error = captureError(() =>
        createTaxIdPolicy([{ isValid, jurisdiction: ZZ, source: SOURCE } as unknown as TaxIdRule]),
      );
      expect(error, label).toBeInstanceOf(DomainValidationError);
      expect(error, label).toMatchObject({ field: 'isValid' });
    }
    expect(captureError(() => createTaxIdPolicy([{ isValid: () => true, jurisdiction: ZZ, source: ' ' }]))).toMatchObject({
      field: 'source',
    });
    expect(
      captureError(() => createTaxIdPolicy([{ isValid: () => true, jurisdiction: 'Z' as Jurisdiction, source: SOURCE }])),
    ).toMatchObject({ field: 'jurisdiction' });
  });

  it('HR15 the type contract excludes `this`: a rule that declares a dependency on `this` is not a TaxIdRule', () => {
    expectTypeOf<ThisParameterType<TaxIdRule['isValid']>>().toEqualTypeOf<void>();
    const { rule } = thisDependentRule('A-');
    // @ts-expect-error -- D-176: `isValid` não pode exigir um receptor; a regra tem de ser autónoma.
    const typed: TaxIdRule = rule;
    expect(typed).toBe(rule);
    // Uma função que não declara `this` continua compatível (consumidores existentes, `tests/support/fixtures.ts`).
    const compatible: TaxIdRule = { isValid: (nif) => nif.length > 0, jurisdiction: ZZ, source: SOURCE };
    expect(accepts(createTaxIdPolicy([compatible]), 'NIF')).toBe(true);
  });
});
