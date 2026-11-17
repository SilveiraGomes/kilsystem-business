import { AuthorizationContractError, DomainValidationError, TenantMismatchError } from './errors.js';
import { parseRoleId, parseTenantId, type CompanyId, type RoleId, type TenantId } from './identifiers.js';
import {
  authorityOfPermissionScope,
  parsePermissionCode,
  requireRegisteredPermission,
  type PermissionCatalog,
  type PermissionCode,
} from './permission.js';
import { parseChronology, parseCompanyScope } from './scoped-record.js';
import {
  parseOneOf,
  parseOptionalText,
  parseRequiredText,
  parseTimestamp,
  type Timestamp,
} from './validation.js';

/*
 * Perfis empresariais (E1.07-D1). Um perfil é um conjunto nomeado de concessões explícitas,
 * pertencente a exactamente um tenant. O código e o nome são identificação e apresentação: nunca
 * determinam autoridade. Não há perfis globais, herança entre perfis nem permissões negativas.
 */

export const ROLE_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE'] as const);

export type RoleStatus = (typeof ROLE_STATUSES)[number];

export const ROLE_CODE_MIN_LENGTH = 2;
export const ROLE_CODE_MAX_LENGTH = 64;

// Validação ANTES da conversão para maiúsculas, como no username (D-085): caracteres Unicode que se
// convertem em ASCII são recusados em vez de normalizados.
const ROLE_CODE_PATTERN = new RegExp(`^[A-Za-z][A-Za-z0-9_-]{${ROLE_CODE_MIN_LENGTH - 1},${ROLE_CODE_MAX_LENGTH - 1}}$`);

/**
 * Normalização do código de perfil: remove espaços nas extremidades, exige 2 a 64 caracteres ASCII
 * (letra inicial; depois letras, algarismos, `_` e `-`) e converte para maiúsculas. A unicidade é
 * por tenant, sobre o valor normalizado.
 */
export const normalizeRoleCode = (value: unknown, field = 'code'): string => {
  if (typeof value !== 'string') throw new DomainValidationError(field, 'deve ser texto');
  const candidate = value.trim();
  if (!ROLE_CODE_PATTERN.test(candidate)) {
    throw new DomainValidationError(
      field,
      `deve ter ${ROLE_CODE_MIN_LENGTH} a ${ROLE_CODE_MAX_LENGTH} caracteres ASCII, a começar por letra, entre letras, algarismos, '_' e '-'`,
    );
  }
  return candidate.toUpperCase();
};

/** Perfil empresarial; pertence a um único tenant e não é reutilizável noutra empresa. */
export interface Role {
  readonly id: RoleId;
  readonly tenantId: TenantId;
  readonly companyId: CompanyId;
  /** Normalizado por `normalizeRoleCode`; único no tenant e imutável. */
  readonly code: string;
  /** Apresentação apenas; não determina autoridade. */
  readonly name: string;
  readonly description?: string;
  readonly status: RoleStatus;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

export interface RoleInput {
  readonly id: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly code: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly status: string;
  readonly createdAt: Date | string;
  /** Por omissão, igual a `createdAt`. */
  readonly updatedAt?: Date | string | undefined;
}

/** Cria ou reconstrói um perfil; só os campos do contrato são copiados. */
export const createRole = (input: RoleInput): Role => {
  const { createdAt, updatedAt } = parseChronology(input);
  const { companyId, tenantId } = parseCompanyScope(input);
  const description = parseOptionalText(input.description, 'description');
  return Object.freeze({
    id: parseRoleId(input.id, 'id'),
    tenantId,
    companyId,
    code: normalizeRoleCode(input.code),
    name: parseRequiredText(input.name, 'name'),
    ...(description === undefined ? {} : { description }),
    status: parseOneOf(input.status, ROLE_STATUSES, 'status'),
    createdAt,
    updatedAt,
  });
};

/** Desactivação lógica; a eliminação física não é o mecanismo normal (D-060). */
export const deactivateRole = (role: Role, at: Date | string): Role =>
  createRole({ ...role, status: 'INACTIVE', updatedAt: at });

/** Um perfil inactivo não concede permissões. */
export const isRoleActive = (role: Role): boolean => role.status === 'ACTIVE';

/**
 * Concessão explícita de uma permissão do catálogo a um perfil. Única por
 * `(tenantId, roleId, permissionCode)`. Sem permissões negativas nem *wildcards*.
 */
export interface RolePermission {
  readonly tenantId: TenantId;
  readonly roleId: RoleId;
  readonly permissionCode: PermissionCode;
  readonly createdAt: Timestamp;
}

export interface RolePermissionInput {
  readonly tenantId: string;
  readonly roleId: string;
  readonly permissionCode: string;
  readonly createdAt: Date | string;
}

/** Validação estrutural (reconstrução); a admissibilidade é verificada por `assertRolePermissionAllowed`. */
export const createRolePermission = (input: RolePermissionInput): RolePermission =>
  Object.freeze({
    tenantId: parseTenantId(input.tenantId),
    roleId: parseRoleId(input.roleId),
    permissionCode: parsePermissionCode(input.permissionCode),
    createdAt: parseTimestamp(input.createdAt, 'createdAt'),
  });

/**
 * Regras de uma concessão nova a um perfil empresarial:
 * - mesmo tenant do perfil (`TenantMismatchError`) e o mesmo perfil (`DomainValidationError`);
 * - catálogo reconhecido (`untrusted-catalog`); E1.07-D2 passa só o catálogo oficial;
 * - permissão registada e disponível no catálogo (`unknown-permission`, `permission-unavailable`);
 * - permissão da autoridade empresarial: permissões da instalação nunca são concedidas a perfis
 *   empresariais (`permission-authority-incompatible`).
 * Não verifica a autoridade do actor que concede (delegação, E1.07-D3).
 */
export const assertRolePermissionAllowed = (
  role: Role,
  grant: RolePermission,
  catalog: PermissionCatalog,
): void => {
  if (grant.tenantId !== role.tenantId) throw new TenantMismatchError();
  if (grant.roleId !== role.id) throw new DomainValidationError('roleId', 'não corresponde ao perfil indicado');
  const permission = requireRegisteredPermission(catalog, grant.permissionCode);
  if (authorityOfPermissionScope(permission.authorityScope) !== 'COMPANY') {
    throw new AuthorizationContractError('permission-authority-incompatible');
  }
};
