import { DomainValidationError } from './errors.js';
import { parseRequiredText, type Brand } from './validation.js';

/** Código de jurisdição ISO 3166-1 alfa-2 (ex.: `AO`). */
export type Jurisdiction = Brand<string, 'Jurisdiction'>;

const ISO_ALPHA_2 = /^[A-Z]{2}$/;

export const parseJurisdiction = (value: unknown, field = 'jurisdiction'): Jurisdiction => {
  const candidate = typeof value === 'string' ? value.trim().toUpperCase() : value;
  if (typeof candidate !== 'string' || !ISO_ALPHA_2.test(candidate)) {
    throw new DomainValidationError(field, 'deve ser um código ISO 3166-1 alfa-2');
  }
  return candidate as Jurisdiction;
};

/**
 * Regra de validação do NIF de uma jurisdição. Só pode ser configurada com fonte normativa,
 * versão e vigência confirmadas (`AGENTS.md`, D-024); o projecto não fornece nenhuma regra.
 */
export interface TaxIdRule {
  readonly jurisdiction: Jurisdiction;
  /** Fonte normativa, versão e vigência que fundamentam a regra. */
  readonly source: string;
  /**
   * Função autónoma do NIF (D-176): não pode depender de `this`. A política nunca a invoca com o
   * objecto da regra como receptor. Estado capturado pela própria função (fecho, função ligada)
   * pertence ao consumidor e fica fora da garantia de isolamento: a regra deve ser pura.
   */
  readonly isValid: (this: void, nif: string) => boolean;
}

export interface TaxIdPolicy {
  readonly ruleFor: (jurisdiction: Jurisdiction) => TaxIdRule | undefined;
}

/** Receptor de todas as invocações: vazio, sem protótipo e congelado; não expõe estado de ninguém. */
const NEUTRAL_RECEIVER: object = Object.freeze(Object.create(null) as object);
// Capturado no carregamento do módulo: a invocação não lê `call`/`apply` da função do consumidor.
const { apply } = Reflect;

const snapshotRule = (rule: TaxIdRule): TaxIdRule => {
  // Cada propriedade é lida uma única vez, para que o valor validado seja o valor guardado.
  const jurisdiction = parseJurisdiction(rule.jurisdiction);
  const source: unknown = rule.source;
  const validator: unknown = rule.isValid;
  parseRequiredText(source, 'source');
  if (typeof validator !== 'function') throw new DomainValidationError('isValid', 'deve ser uma função');
  const validate = validator as (this: object, nif: string) => boolean;
  const isValid = Object.freeze((nif: string): boolean => apply(validate, NEUTRAL_RECEIVER, [nif]));
  return Object.freeze({ jurisdiction, source: source as string, isValid });
};

/**
 * A política guarda e devolve um instantâneo congelado de cada regra, fixado na criação
 * (E1.07-D1-H, PD-64; E1.07-D1-H-R1, D-176). Garantias:
 * - `jurisdiction`, `source` e a referência de `isValid` são lidos uma vez e copiados; outras
 *   propriedades do objecto fornecido (incluindo estruturas aninhadas) não são guardadas;
 * - `isValid` é invocada com um receptor neutro e congelado, nunca com o objecto original, e sem
 *   ler `call`/`apply` da função fornecida;
 * - a regra devolvida por `ruleFor`, o seu `isValid`, `ruleFor` e a política são congelados;
 * - o objecto, o array e a função do consumidor não são congelados.
 * Limite: o estado capturado pela própria função (fecho ou função ligada) não é copiável nem
 * congelável sem alterar objectos do consumidor; fica fora da garantia (D-176).
 */
export const createTaxIdPolicy = (rules: readonly TaxIdRule[]): TaxIdPolicy => {
  const byJurisdiction = new Map<Jurisdiction, TaxIdRule>();
  for (const rule of rules) {
    const snapshot = snapshotRule(rule);
    if (byJurisdiction.has(snapshot.jurisdiction)) {
      throw new DomainValidationError('jurisdiction', 'tem mais de uma regra fiscal configurada');
    }
    byJurisdiction.set(snapshot.jurisdiction, snapshot);
  }
  const ruleFor = Object.freeze((jurisdiction: Jurisdiction): TaxIdRule | undefined => byJurisdiction.get(jurisdiction));
  return Object.freeze({ ruleFor });
};

/** Política sem regras: falha fechada, nenhuma empresa pode ficar `ACTIVE`. */
export const EMPTY_TAX_ID_POLICY: TaxIdPolicy = createTaxIdPolicy([]);

export const assertValidTaxId = (
  jurisdiction: Jurisdiction,
  nif: string | undefined,
  policy: TaxIdPolicy,
): void => {
  const rule = policy.ruleFor(jurisdiction);
  if (rule === undefined) {
    throw new DomainValidationError('nif', 'não existe regra fiscal configurada para a jurisdição');
  }
  const { isValid } = rule;
  if (nif === undefined || !isValid(nif)) {
    throw new DomainValidationError('nif', 'não cumpre a regra fiscal da jurisdição');
  }
};
