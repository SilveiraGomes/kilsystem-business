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

export const BRANCH_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export type BranchStatus = (typeof BRANCH_STATUSES)[number];

/** Estabelecimento de uma empresa; empresas podem combinar sectores diferentes (D-018). */
export interface Branch {
  readonly id: BranchId;
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  readonly name: string;
  /** Código interno do estabelecimento. */
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
    code: parseRequiredText(input.code, 'code'),
    sectorType: parseSectorType(input.sectorType),
    status: parseOneOf(input.status, BRANCH_STATUSES, 'status'),
    createdAt,
    updatedAt,
  });
};
