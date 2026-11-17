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
  readonly isValid: (nif: string) => boolean;
}

export interface TaxIdPolicy {
  readonly ruleFor: (jurisdiction: Jurisdiction) => TaxIdRule | undefined;
}

/**
 * A política guarda e devolve um instantâneo congelado de cada regra, fixado na criação
 * (E1.07-D1-H, PD-64): quem recebe a política não consegue alterar a regra aplicada aos restantes
 * utilizadores através de `ruleFor`, e alterações posteriores às propriedades do objecto fornecido
 * não mudam a validação. O objecto do consumidor não é congelado.
 */
export const createTaxIdPolicy = (rules: readonly TaxIdRule[]): TaxIdPolicy => {
  const byJurisdiction = new Map<Jurisdiction, TaxIdRule>();
  for (const rule of rules) {
    const jurisdiction = parseJurisdiction(rule.jurisdiction);
    parseRequiredText(rule.source, 'source');
    if (byJurisdiction.has(jurisdiction)) {
      throw new DomainValidationError('jurisdiction', 'tem mais de uma regra fiscal configurada');
    }
    // `this` continua a ser o objecto original, como na chamada `rule.isValid(nif)` anterior.
    const isValid = rule.isValid;
    byJurisdiction.set(
      jurisdiction,
      Object.freeze({ jurisdiction, source: rule.source, isValid: (nif: string): boolean => isValid.call(rule, nif) }),
    );
  }
  return Object.freeze({ ruleFor: (jurisdiction: Jurisdiction) => byJurisdiction.get(jurisdiction) });
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
  if (nif === undefined || !rule.isValid(nif)) {
    throw new DomainValidationError('nif', 'não cumpre a regra fiscal da jurisdição');
  }
};
