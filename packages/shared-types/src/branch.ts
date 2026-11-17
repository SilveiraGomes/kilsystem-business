import {
  parseBranchId,
  parseCompanyId,
  parseTenantId,
  type BranchId,
  type CompanyId,
  type TenantId,
} from './identifiers.js';
import { parseSectorType, type SectorType } from './sectors.js';
import {
  assertChronology,
  parseOneOf,
  parseRequiredText,
  parseTimestamp,
  type Timestamp,
} from './validation.js';

/** Congelada em execução (E1.07-D1-H, PD-64). */
export const BRANCH_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE'] as const);

export type BranchStatus = (typeof BRANCH_STATUSES)[number];

/** Estabelecimento de uma empresa; empresas podem combinar sectores diferentes (D-018). */
export interface Branch {
  readonly id: BranchId;
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly name: string;
  /** Código interno normalizado; único dentro da empresa (D-026). */
  readonly code: string;
  readonly sectorType: SectorType;
  readonly status: BranchStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface BranchInput {
  readonly id: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly name: string;
  readonly code: string;
  readonly sectorType: string;
  readonly status: string;
  readonly createdAt: Date | string;
  /** Por omissão, igual a `createdAt`. */
  readonly updatedAt?: Date | string | undefined;
}

/**
 * Normalização explícita do código (D-026): remove espaços nas extremidades, aplica Unicode NFKC,
 * converte para maiúsculas e reduz espaços internos consecutivos a um único espaço.
 */
export const normalizeBranchCode = (value: unknown, field = 'code'): string =>
  parseRequiredText(
    parseRequiredText(value, field).normalize('NFKC').toUpperCase().replace(/\s+/g, ' '),
    field,
  );

export const createBranch = (input: BranchInput): Branch => {
  const createdAt = parseTimestamp(input.createdAt, 'createdAt');
  const updatedAt =
    input.updatedAt === undefined ? createdAt : parseTimestamp(input.updatedAt, 'updatedAt');
  assertChronology(createdAt, updatedAt);

  return Object.freeze({
    id: parseBranchId(input.id, 'id'),
    tenantId: parseTenantId(input.tenantId),
    companyId: parseCompanyId(input.companyId),
    name: parseRequiredText(input.name, 'name'),
    code: normalizeBranchCode(input.code),
    sectorType: parseSectorType(input.sectorType),
    status: parseOneOf(input.status, BRANCH_STATUSES, 'status'),
    createdAt,
    updatedAt,
  });
};

/** Desactivação lógica (D-027); não elimina dados. */
export const deactivateBranch = (branch: Branch, at: Date | string): Branch =>
  createBranch({ ...branch, status: 'INACTIVE', updatedAt: at });
