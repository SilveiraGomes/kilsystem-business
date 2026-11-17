import { AuthorizationContractError, DomainValidationError } from './errors.js';
import { parseOneOf, parseRequiredText, type Brand } from './validation.js';

/*
 * Permissões e catálogo (E1.07-D1). Contratos de domínio apenas: nada aqui consulta sessões,
 * persistência ou contexto autenticado, e a validade de um código não significa que a permissão
 * esteja registada nem concedida a alguém.
 */

/**
 * Identificação técnica estável de uma permissão (ex.: `roles.assign`). Nunca é um nome traduzido.
 * Só existe na forma canónica: o valor recebido não é normalizado, é aceite ou recusado.
 */
export type PermissionCode = Brand<string, 'PermissionCode'>;

/** Comprimento máximo do código completo, pontos incluídos. */
export const PERMISSION_CODE_MAX_LENGTH = 96;
/** Comprimento máximo de cada segmento. */
export const PERMISSION_SEGMENT_MAX_LENGTH = 32;
export const PERMISSION_MIN_SEGMENTS = 2;
export const PERMISSION_MAX_SEGMENTS = 4;
/**
 * Segmentos que sugerem coberturas genéricas (“todas as operações”); recusados para que nenhum
 * código funcione como *wildcard* semântico.
 */
export const RESERVED_PERMISSION_SEGMENTS = ['all', 'any'] as const;
/** Prefixo reservado à autoridade da instalação; nenhuma outra permissão o pode usar. */
export const INSTALLATION_PERMISSION_PREFIX = 'installation';
/** Prefixo reservado à autoridade da plataforma KIL, que não tem permissões neste catálogo (D-083). */
export const PLATFORM_PERMISSION_PREFIX = 'platform';

// Segmento: letra minúscula ASCII inicial, depois letras minúsculas e algarismos, com `_` apenas
// entre grupos (sem `_` inicial, final ou repetido). Sem maiúsculas, espaços, hífenes nem Unicode.
const SEGMENT_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const WILDCARD_PATTERN = /[*?%#]/;

export type PermissionCodeViolation =
  | 'not-text'
  | 'empty'
  | 'too-long'
  | 'wildcard'
  | 'segment-count'
  | 'empty-segment'
  | 'segment-too-long'
  | 'invalid-segment'
  | 'reserved-segment';

const VIOLATION_MESSAGES: Readonly<Record<PermissionCodeViolation, string>> = Object.freeze({
  'not-text': 'deve ser texto',
  empty: 'é obrigatório',
  'too-long': `excede ${PERMISSION_CODE_MAX_LENGTH} caracteres`,
  wildcard: 'não admite wildcards',
  'segment-count': `deve ter de ${PERMISSION_MIN_SEGMENTS} a ${PERMISSION_MAX_SEGMENTS} segmentos separados por '.'`,
  'empty-segment': 'não admite segmentos vazios',
  'segment-too-long': `cada segmento tem no máximo ${PERMISSION_SEGMENT_MAX_LENGTH} caracteres`,
  'invalid-segment': "cada segmento usa só minúsculas ASCII, algarismos e '_' interno, a começar por letra",
  'reserved-segment': 'usa um segmento reservado',
});

/**
 * Gramática dos códigos (E1.07-D1): 2 a 4 segmentos separados por `.`, cada um com 1 a 32
 * caracteres `[a-z][a-z0-9]*(_[a-z0-9]+)*`, até 96 caracteres no total, sem *wildcards* nem
 * segmentos reservados. Devolve a primeira violação, ou `undefined` se o código for válido.
 */
export const checkPermissionCode = (value: unknown): PermissionCodeViolation | undefined => {
  if (typeof value !== 'string') return 'not-text';
  if (value.length === 0) return 'empty';
  if (value.length > PERMISSION_CODE_MAX_LENGTH) return 'too-long';
  if (WILDCARD_PATTERN.test(value)) return 'wildcard';
  const segments = value.split('.');
  if (segments.length < PERMISSION_MIN_SEGMENTS || segments.length > PERMISSION_MAX_SEGMENTS) {
    return 'segment-count';
  }
  for (const segment of segments) {
    if (segment.length === 0) return 'empty-segment';
    if (segment.length > PERMISSION_SEGMENT_MAX_LENGTH) return 'segment-too-long';
    if (!SEGMENT_PATTERN.test(segment)) return 'invalid-segment';
    if ((RESERVED_PERMISSION_SEGMENTS as readonly string[]).includes(segment)) return 'reserved-segment';
  }
  return undefined;
};

/** Validade sintáctica apenas; não indica que a permissão esteja registada no catálogo. */
export const isPermissionCode = (value: unknown): value is PermissionCode => checkPermissionCode(value) === undefined;

export const parsePermissionCode = (value: unknown, field = 'permissionCode'): PermissionCode => {
  const violation = checkPermissionCode(value);
  if (violation !== undefined) throw new DomainValidationError(field, VIOLATION_MESSAGES[violation]);
  return value as PermissionCode;
};

/**
 * Autoridades administrativas (E1.07-D1, D-083):
 * - `PLATFORM`: autoridade da KIL (licenciamento, contratos, instalações, suporte autorizado). Não
 *   pertence à autoridade empresarial e não tem permissões neste catálogo; não implementada.
 * - `INSTALLATION`: configuração técnica, inicialização e provisionamento autorizado. Não concede
 *   acesso a dados comerciais. A autoridade efectiva do administrador inicial é de E1.07-D3.
 * - `COMPANY`: limitada a um tenant e à respectiva empresa, sempre através de associações activas.
 * Nenhuma autoridade implica outra.
 */
export const AUTHORITIES = ['PLATFORM', 'INSTALLATION', 'COMPANY'] as const;

export type Authority = (typeof AUTHORITIES)[number];

/**
 * Âmbito exigido por uma permissão:
 * - `INSTALLATION`: a instalação, sem tenant;
 * - `COMPANY`: a empresa como um todo (operações empresariais globais);
 * - `BRANCH`: um estabelecimento concreto da empresa.
 */
export const PERMISSION_SCOPES = ['INSTALLATION', 'COMPANY', 'BRANCH'] as const;

export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/** Autoridade a que pertence uma permissão; `COMPANY` e `BRANCH` são ambas empresariais. */
export const authorityOfPermissionScope = (scope: PermissionScope): Exclude<Authority, 'PLATFORM'> =>
  scope === 'INSTALLATION' ? 'INSTALLATION' : 'COMPANY';

/**
 * `ADMINISTRATION`: administração da instalação ou da empresa. `OPERATION`: operação comercial,
 * só aplicável a empresas operacionais (`ACTIVE`, D-088). O catálogo inicial só tem administração.
 */
export const PERMISSION_CATEGORIES = ['ADMINISTRATION', 'OPERATION'] as const;

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

/** `WITHDRAWN`: mantida para reconhecer registos antigos, mas sem conceder nada nem aceitar concessões novas. */
export const PERMISSION_STATUSES = ['AVAILABLE', 'WITHDRAWN'] as const;

export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];

export interface Permission {
  readonly code: PermissionCode;
  readonly description: string;
  readonly authorityScope: PermissionScope;
  /** Segmentos do código antes da acção (ex.: `roles` em `roles.assign`); derivado do código. */
  readonly resource: string;
  /** Último segmento do código (ex.: `assign`); derivado do código. */
  readonly action: string;
  readonly category: PermissionCategory;
  readonly status: PermissionStatus;
}

export interface PermissionDefinition {
  readonly code: string;
  readonly description: string;
  readonly authorityScope: string;
  readonly category: string;
  /** Por omissão, `AVAILABLE`. */
  readonly status?: string | undefined;
}

/**
 * Cria uma permissão. O recurso e a acção são derivados do código, para não divergirem dele.
 * Só permissões `INSTALLATION` usam o prefixo `installation`; o prefixo `platform` é recusado; a
 * autoridade da instalação não tem operações comerciais.
 */
export const createPermission = (definition: PermissionDefinition): Permission => {
  const code = parsePermissionCode(definition.code, 'code');
  const authorityScope = parseOneOf(definition.authorityScope, PERMISSION_SCOPES, 'authorityScope');
  const category = parseOneOf(definition.category, PERMISSION_CATEGORIES, 'category');
  const segments = code.split('.');
  const prefix = segments[0];
  if (prefix === PLATFORM_PERMISSION_PREFIX) {
    throw new DomainValidationError('code', 'a autoridade da plataforma não tem permissões neste catálogo');
  }
  if ((prefix === INSTALLATION_PERMISSION_PREFIX) !== (authorityScope === 'INSTALLATION')) {
    throw new DomainValidationError('code', 'o prefixo não corresponde à autoridade da permissão');
  }
  if (authorityScope === 'INSTALLATION' && category !== 'ADMINISTRATION') {
    throw new DomainValidationError('category', 'a autoridade da instalação não tem operações comerciais');
  }
  return Object.freeze({
    code,
    description: parseRequiredText(definition.description, 'description'),
    authorityScope,
    resource: segments.slice(0, -1).join('.'),
    action: segments.at(-1) as string,
    category,
    status: parseOneOf(definition.status ?? 'AVAILABLE', PERMISSION_STATUSES, 'status'),
  });
};

/**
 * Catálogo tipado, versionado e imutável das operações reconhecidas pelo sistema. É definido em
 * código e alterado só por uma nova versão do software (nunca por perfis, utilizadores ou dados):
 * a gestão do catálogo é distinta da concessão de permissões.
 */
export interface PermissionCatalog {
  /** Inteiro positivo; cada extensão tem uma versão superior à da base. */
  readonly version: number;
  /** Ordenadas pelo código. */
  readonly permissions: readonly Permission[];
  /** Permissão registada com o código, ou `undefined` (um código válido pode não estar registado). */
  find(code: PermissionCode): Permission | undefined;
  isRegistered(code: PermissionCode): boolean;
}

const parseCatalogVersion = (version: unknown): number => {
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new AuthorizationContractError('invalid-catalog-version');
  }
  return version;
};

const buildCatalog = (version: number, permissions: readonly Permission[]): PermissionCatalog => {
  const byCode = new Map<string, Permission>();
  for (const permission of permissions) {
    if (byCode.has(permission.code)) throw new AuthorizationContractError('duplicate-permission');
    byCode.set(permission.code, permission);
  }
  const ordered = Object.freeze([...byCode.values()].sort((left, right) => left.code.localeCompare(right.code)));
  return Object.freeze({
    version,
    permissions: ordered,
    find: (code: PermissionCode): Permission | undefined => byCode.get(code),
    isRegistered: (code: PermissionCode): boolean => byCode.has(code),
  });
};

/** Recusa códigos duplicados (`duplicate-permission`) e versões inválidas (`invalid-catalog-version`). */
export const createPermissionCatalog = (
  version: number,
  definitions: readonly PermissionDefinition[],
): PermissionCatalog => buildCatalog(parseCatalogVersion(version), definitions.map(createPermission));

/**
 * Extensão futura (ex.: módulos sectoriais) sem reconstruir o motor: devolve um catálogo novo com
 * as permissões da base e as adições, numa versão superior. A base não é alterada.
 */
export const extendPermissionCatalog = (
  base: PermissionCatalog,
  version: number,
  additions: readonly PermissionDefinition[],
): PermissionCatalog => {
  const next = parseCatalogVersion(version);
  if (next <= base.version) throw new AuthorizationContractError('invalid-catalog-version');
  return buildCatalog(next, [...base.permissions, ...additions.map(createPermission)]);
};

/**
 * Exige uma permissão registada (`unknown-permission`) e disponível (`permission-unavailable`).
 */
export const requireRegisteredPermission = (catalog: PermissionCatalog, code: PermissionCode): Permission => {
  const permission = catalog.find(code);
  if (permission === undefined) throw new AuthorizationContractError('unknown-permission');
  if (permission.status !== 'AVAILABLE') throw new AuthorizationContractError('permission-unavailable');
  return permission;
};

const installation = (code: string, description: string): PermissionDefinition => ({
  authorityScope: 'INSTALLATION',
  category: 'ADMINISTRATION',
  code,
  description,
});

const company = (code: string, description: string): PermissionDefinition => ({
  authorityScope: 'COMPANY',
  category: 'ADMINISTRATION',
  code,
  description,
});

const branch = (code: string, description: string): PermissionDefinition => ({
  authorityScope: 'BRANCH',
  category: 'ADMINISTRATION',
  code,
  description,
});

export const INITIAL_PERMISSION_CATALOG_VERSION = 1;

/**
 * Catálogo inicial (E1.07-D1): só a fundação da administração da instalação e da empresa. Sem
 * vendas, compras, POS, stock, contabilidade nem módulos sectoriais.
 */
export const INITIAL_PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = Object.freeze([
  installation('installation.settings.read', 'Consultar a configuração técnica da instalação'),
  installation('installation.settings.update', 'Alterar a configuração técnica da instalação'),
  installation('installation.companies.provision', 'Provisionar empresas (tenants) na instalação'),
  installation('installation.users.provision', 'Provisionar identidades locais da instalação'),
  installation('installation.authorities.read', 'Consultar quem detém autoridade da instalação'),
  installation('installation.authorities.grant', 'Conceder ou retirar autoridade da instalação'),
  company('company.read', 'Consultar os dados da empresa'),
  company('company.update', 'Alterar os dados da empresa'),
  company('branches.create', 'Criar estabelecimentos da empresa'),
  company('branches.update', 'Alterar ou desactivar estabelecimentos da empresa'),
  branch('branches.read', 'Consultar um estabelecimento'),
  company('memberships.read', 'Consultar as associações empresariais e locais'),
  company('memberships.create', 'Criar associações empresariais e locais'),
  company('memberships.update', 'Alterar o âmbito ou desactivar associações empresariais e locais'),
  company('permissions.read', 'Consultar o catálogo de permissões'),
  company('roles.read', 'Consultar os perfis da empresa'),
  company('roles.create', 'Criar perfis da empresa, sem permissões'),
  company('roles.update', 'Alterar o nome e a descrição de perfis'),
  company('roles.deactivate', 'Desactivar ou reactivar perfis'),
  company('roles.permissions.grant', 'Conceder permissões do catálogo a perfis'),
  company('roles.permissions.revoke', 'Retirar permissões de perfis'),
  company('roles.assignments.read', 'Consultar as atribuições de perfis'),
  company('roles.assign', 'Atribuir perfis a associações empresariais'),
  company('roles.unassign', 'Desactivar atribuições de perfis'),
]);

export const INITIAL_PERMISSION_CATALOG: PermissionCatalog = createPermissionCatalog(
  INITIAL_PERMISSION_CATALOG_VERSION,
  INITIAL_PERMISSION_DEFINITIONS,
);
