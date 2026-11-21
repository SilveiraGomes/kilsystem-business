import {
  createBranch,
  createBranchMembership,
  createCompanyMembership,
  createRole,
  createRoleAssignment,
  createRolePermission,
  createUser,
  restoreCompany,
  type Branch,
  type BranchInput,
  type BranchMembership,
  type Company,
  type CompanyInput,
  type CompanyMembership,
  type Role,
  type RoleAssignment,
  type RolePermission,
  type User,
} from '@kil-business/shared-types';

import { PersistenceError } from './errors.js';
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

export const INSERT_USER_SQL = `INSERT INTO users (id, username, display_name, email, phone, status, created_at, updated_at)
  VALUES (@id, @username, @displayName, @email, @phone, @status, @createdAt, @updatedAt)`;

export const userParameters = (user: User): Record<string, string | null> => ({
  createdAt: user.createdAt,
  displayName: user.displayName,
  email: user.email ?? null,
  id: user.id,
  phone: user.phone ?? null,
  status: user.status,
  updatedAt: user.updatedAt,
  username: user.username,
});

export const COMPANY_MEMBERSHIP_COLUMNS =`id, user_id AS userId, tenant_id AS tenantId,
  company_id AS companyId, scope, status, created_at AS createdAt, updated_at AS updatedAt`;

export const BRANCH_MEMBERSHIP_COLUMNS = `id, company_membership_id AS companyMembershipId,
  tenant_id AS tenantId, company_id AS companyId, branch_id AS branchId, status,
  created_at AS createdAt, updated_at AS updatedAt`;

export const ROLE_COLUMNS = `id, tenant_id AS tenantId, company_id AS companyId, code, name, description, status,
  created_at AS createdAt, updated_at AS updatedAt`;

export const ROLE_PERMISSION_COLUMNS = `tenant_id AS tenantId, role_id AS roleId, permission_code AS permissionCode,
  catalog_version AS catalogVersion, created_at AS createdAt`;

export const ROLE_ASSIGNMENT_COLUMNS = `id, tenant_id AS tenantId, company_id AS companyId, role_id AS roleId,
  company_membership_id AS companyMembershipId, scope, branch_id AS branchId, status,
  created_at AS createdAt, updated_at AS updatedAt`;

export const toRole = (value: unknown): Role => {
  const row = readRow(value);
  return restoreStored(() =>
    createRole({
      code: text(row, 'code'),
      companyId: text(row, 'companyId'),
      createdAt: text(row, 'createdAt'),
      description: optionalText(row, 'description'),
      id: text(row, 'id'),
      name: text(row, 'name'),
      status: text(row, 'status'),
      tenantId: text(row, 'tenantId'),
      updatedAt: text(row, 'updatedAt'),
    }),
  );
};

/** Concessão persistida, com a versão do catálogo oficial em que foi feita (D-181). */
export interface StoredRolePermission {
  readonly grant: RolePermission;
  readonly catalogVersion: number;
}

export const toStoredRolePermission = (value: unknown): StoredRolePermission => {
  const row = readRow(value);
  const catalogVersion = row.catalogVersion;
  if (typeof catalogVersion !== 'number' || !Number.isSafeInteger(catalogVersion) || catalogVersion < 1) {
    throw new PersistenceError('invalid-stored-record');
  }
  // Só a estrutura e a gramática do código são revalidadas: um código fora do catálogo vigente
  // continua legível e identificável (D-162, PD-61); nunca é convertido nem descartado aqui.
  const grant = restoreStored(() =>
    createRolePermission({
      createdAt: text(row, 'createdAt'),
      permissionCode: text(row, 'permissionCode'),
      roleId: text(row, 'roleId'),
      tenantId: text(row, 'tenantId'),
    }),
  );
  return { catalogVersion, grant };
};

export const toRoleAssignment = (value: unknown): RoleAssignment => {
  const row = readRow(value);
  return restoreStored(() =>
    createRoleAssignment({
      branchId: optionalText(row, 'branchId'),
      companyId: text(row, 'companyId'),
      companyMembershipId: text(row, 'companyMembershipId'),
      createdAt: text(row, 'createdAt'),
      id: text(row, 'id'),
      roleId: text(row, 'roleId'),
      scope: text(row, 'scope'),
      status: text(row, 'status'),
      tenantId: text(row, 'tenantId'),
      updatedAt: text(row, 'updatedAt'),
    }),
  );
};

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
