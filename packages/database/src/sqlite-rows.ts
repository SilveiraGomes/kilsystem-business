import {
  createBranch,
  createBranchMembership,
  createCompanyMembership,
  createUser,
  restoreCompany,
  type Branch,
  type BranchInput,
  type BranchMembership,
  type Company,
  type CompanyInput,
  type CompanyMembership,
  type User,
} from '@kil-business/shared-types';

import { optionalText, readRow, restoreStored, text } from './sqlite-support.js';

/*
 * Colunas e conversão de linhas SQLite em registos de domínio revalidados (D-036, D-039).
 * Módulo interno do pacote: não é exportado por `index.ts`.
 */

export const COMPANY_COLUMNS = `id, tenant_id AS tenantId, jurisdiction, legal_name AS legalName,
  trade_name AS tradeName, nif, status, created_at AS createdAt, updated_at AS updatedAt`;

export const BRANCH_COLUMNS = `id, tenant_id AS tenantId, company_id AS companyId, name, code,
  sector_type AS sectorType, status, created_at AS createdAt, updated_at AS updatedAt`;

export const USER_COLUMNS = `id, username, display_name AS displayName, email, phone, status,
  created_at AS createdAt, updated_at AS updatedAt`;

export const COMPANY_MEMBERSHIP_COLUMNS = `id, user_id AS userId, tenant_id AS tenantId,
  company_id AS companyId, scope, status, created_at AS createdAt, updated_at AS updatedAt`;

export const BRANCH_MEMBERSHIP_COLUMNS = `id, company_membership_id AS companyMembershipId,
  tenant_id AS tenantId, company_id AS companyId, branch_id AS branchId, status,
  created_at AS createdAt, updated_at AS updatedAt`;

export const toCompany = (value: unknown): Company => {
  const row = readRow(value);
  const input: CompanyInput = {
    createdAt: text(row, 'createdAt'),
    id: text(row, 'id'),
    jurisdiction: text(row, 'jurisdiction'),
    legalName: text(row, 'legalName'),
    nif: optionalText(row, 'nif'),
    status: text(row, 'status'),
    tenantId: text(row, 'tenantId'),
    tradeName: optionalText(row, 'tradeName'),
    updatedAt: text(row, 'updatedAt'),
  };
  return restoreStored(() => restoreCompany(input));
};

export const toBranch = (value: unknown): Branch => {
  const row = readRow(value);
  const input: BranchInput = {
    code: text(row, 'code'),
    companyId: text(row, 'companyId'),
    createdAt: text(row, 'createdAt'),
    id: text(row, 'id'),
    name: text(row, 'name'),
    sectorType: text(row, 'sectorType'),
    status: text(row, 'status'),
    tenantId: text(row, 'tenantId'),
    updatedAt: text(row, 'updatedAt'),
  };
  return restoreStored(() => createBranch(input));
};

export const toUser = (value: unknown): User => {
  const row = readRow(value);
  return restoreStored(() =>
    createUser({
      createdAt: text(row, 'createdAt'),
      displayName: text(row, 'displayName'),
      email: optionalText(row, 'email'),
      id: text(row, 'id'),
      phone: optionalText(row, 'phone'),
      status: text(row, 'status'),
      updatedAt: text(row, 'updatedAt'),
      username: text(row, 'username'),
    }),
  );
};

export const toCompanyMembership = (value: unknown): CompanyMembership => {
  const row = readRow(value);
  return restoreStored(() =>
    createCompanyMembership({
      companyId: text(row, 'companyId'),
      createdAt: text(row, 'createdAt'),
      id: text(row, 'id'),
      scope: text(row, 'scope'),
      status: text(row, 'status'),
      tenantId: text(row, 'tenantId'),
      updatedAt: text(row, 'updatedAt'),
      userId: text(row, 'userId'),
    }),
  );
};

export const toBranchMembership = (value: unknown): BranchMembership => {
  const row = readRow(value);
  return restoreStored(() =>
    createBranchMembership({
      branchId: text(row, 'branchId'),
      companyId: text(row, 'companyId'),
      companyMembershipId: text(row, 'companyMembershipId'),
      createdAt: text(row, 'createdAt'),
      id: text(row, 'id'),
      status: text(row, 'status'),
      tenantId: text(row, 'tenantId'),
      updatedAt: text(row, 'updatedAt'),
    }),
  );
};
