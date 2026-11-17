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
 * código funcione como *wildcard* semântico. Congelado: uma alteração externa não pode retirar
 * segmentos reservados (E1.07-D1-R1).
 */
export const RESERVED_PERMISSION_SEGMENTS = Object.freeze(['all', 'any'] as const);
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
 *
 * As listas de valores permitidos deste módulo estão congeladas (E1.07-D1-R1): `parseOneOf` usa-as
 * para validar, e uma lista alterável permitiria, por exemplo, criar permissões com âmbito `GLOBAL`.
 */
export const AUTHORITIES = Object.freeze(['PLATFORM', 'INSTALLATION', 'COMPANY'] as const);

export type Authority = (typeof AUTHORITIES)[number];

/**
 * Âmbito exigido por uma permissão:
 * - `INSTALLATION`: a instalação, sem tenant;
 * - `COMPANY`: a empresa como um todo (operações empresariais globais);
 * - `BRANCH`: um estabelecimento concreto da empresa.
 */
export const PERMISSION_SCOPES = Object.freeze(['INSTALLATION', 'COMPANY', 'BRANCH'] as const);

export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/** Autoridade a que pertence uma permissão; `COMPANY` e `BRANCH` são ambas empresariais. */
export const authorityOfPermissionScope = (scope: PermissionScope): Exclude<Authority, 'PLATFORM'> =>
  scope === 'INSTALLATION' ? 'INSTALLATION' : 'COMPANY';

/**
 * `ADMINISTRATION`: administração da instalação ou da empresa. `OPERATION`: operação comercial,
 * só aplicável a empresas operacionais (`ACTIVE`, D-088). O catálogo inicial só tem administração.
 */
export const PERMISSION_CATEGORIES = Object.freeze(['ADMINISTRATION', 'OPERATION'] as const);

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

/** `WITHDRAWN`: mantida para reconhecer registos antigos, mas sem conceder nada nem aceitar concessões novas. */
export const PERMISSION_STATUSES = Object.freeze(['AVAILABLE', 'WITHDRAWN'] as const);

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

// Marca só de compilação: impede que um literal estrutural seja aceite como catálogo sem uma
// asserção de tipo explícita. NÃO é a garantia: a proveniência é verificada em execução (abaixo).
declare const permissionCatalogBrand: unique symbol;

/**
 * Catálogo tipado, versionado e imutável das operações reconhecidas pelo sistema. É definido em
 * código e alterado só por uma nova versão do software (nunca por perfis, utilizadores ou dados):
 * a gestão do catálogo é distinta da concessão de permissões.
 *
 * A forma deste contrato não prova a origem do catálogo (E1.07-D1-R1, PD-63): só os catálogos
 * construídos por este módulo têm proveniência (`permissionCatalogProvenance`).
 */
export interface PermissionCatalog {
  /** Inteiro positivo; cada extensão tem uma versão superior à da base. Informação de evolução, nunca prova de origem. */
  readonly version: number;
  /** Ordenadas pelo código. */
  readonly permissions: readonly Permission[];
  /** Permissão registada com o código, ou `undefined` (um código válido pode não estar registado). */
  find(code: PermissionCode): Permission | undefined;
  isRegistered(code: PermissionCode): boolean;
  readonly [permissionCatalogBrand]: true;
}

/**
 * Proveniência de um catálogo, verificada em execução (E1.07-D1-R1, PD-63):
 * - `OFFICIAL`: o catálogo operacional oficial (`OFFICIAL_PERMISSION_CATALOG`), único, construído
 *   neste módulo a partir das definições em código;
 * - `EXPERIMENTAL`: criado ou estendido por `createExperimentalPermissionCatalog` ou
 *   `extendExperimentalPermissionCatalog`, para modelação e testes isolados (pode conter códigos
 *   fictícios); nunca é autoridade operacional;
 * - `UNKNOWN`: qualquer outro valor, incluindo objectos estruturalmente iguais, cópias e clones de
 *   catálogos reconhecidos, ou catálogos com as mesmas definições ou versão do oficial.
 */
export const PERMISSION_CATALOG_PROVENANCES = Object.freeze(['OFFICIAL', 'EXPERIMENTAL', 'UNKNOWN'] as const);

export type PermissionCatalogProvenance = (typeof PERMISSION_CATALOG_PROVENANCES)[number];

// Registo privado do módulo: a proveniência pertence à identidade do objecto construído aqui e não
// é transferida por cópia, clonagem, serialização, coincidência de definições ou de versão. Só o
// catálogo oficial é registado como `OFFICIAL` (uma única chamada, abaixo).
const catalogProvenance = new WeakMap<object, Exclude<PermissionCatalogProvenance, 'UNKNOWN'>>();

/** Proveniência de um valor como catálogo; `UNKNOWN` para tudo o que não foi construído por este módulo. */
export const permissionCatalogProvenance = (value: unknown): PermissionCatalogProvenance =>
  (typeof value === 'object' && value !== null ? catalogProvenance.get(value) : undefined) ?? 'UNKNOWN';

/** Verdadeiro só para o catálogo operacional oficial. */
export const isOfficialPermissionCatalog = (value: unknown): value is PermissionCatalog =>
  permissionCatalogProvenance(value) === 'OFFICIAL';

/**
 * Exige um catálogo construído por este módulo, oficial ou experimental (`untrusted-catalog`).
 * Usado pelas regras puras, que continuam a admitir catálogos experimentais em testes.
 */
export const requireRecognizedPermissionCatalog = (value: unknown): PermissionCatalog => {
  if (permissionCatalogProvenance(value) === 'UNKNOWN') throw new AuthorizationContractError('untrusted-catalog');
  return value as PermissionCatalog;
};

/**
 * Exige o catálogo operacional oficial: recusa catálogos desconhecidos (`untrusted-catalog`) e
 * experimentais (`catalog-not-official`). É o único catálogo admissível no futuro caminho
 * operacional sobre concessões persistidas (E1.07-D2); nenhum pedido, DTO ou adaptador o fornece.
 */
export const requireOfficialPermissionCatalog = (value: unknown): PermissionCatalog => {
  const provenance = permissionCatalogProvenance(value);
  if (provenance === 'UNKNOWN') throw new AuthorizationContractError('untrusted-catalog');
  if (provenance !== 'OFFICIAL') throw new AuthorizationContractError('catalog-not-official');
  return value as PermissionCatalog;
};

const parseCatalogVersion = (version: unknown): number => {
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new AuthorizationContractError('invalid-catalog-version');
  }
  return version;
};

const buildCatalog = (
  version: number,
  permissions: readonly Permission[],
  provenance: Exclude<PermissionCatalogProvenance, 'UNKNOWN'>,
): PermissionCatalog => {
  // O índice privado é a única colecção consultada por `find`; não é exposto aos consumidores.
  const byCode = new Map<string, Permission>();
  for (const permission of permissions) {
    if (byCode.has(permission.code)) throw new AuthorizationContractError('duplicate-permission');
    byCode.set(permission.code, permission);
  }
  const ordered = Object.freeze([...byCode.values()].sort((left, right) => left.code.localeCompare(right.code)));
  const catalog = Object.freeze({
    version,
    permissions: ordered,
    find: Object.freeze((code: PermissionCode): Permission | undefined => byCode.get(code)),
    isRegistered: Object.freeze((code: PermissionCode): boolean => byCode.has(code)),
  }) as unknown as PermissionCatalog;
  catalogProvenance.set(catalog, provenance);
  return catalog;
};

/**
 * Catálogo EXPERIMENTAL, para modelação e testes isolados (admite códigos fictícios). Recusa
 * códigos duplicados (`duplicate-permission`) e versões inválidas (`invalid-catalog-version`).
 * Nunca é oficial, mesmo com as definições e a versão do catálogo oficial.
 */
export const createExperimentalPermissionCatalog = (
  version: number,
  definitions: readonly PermissionDefinition[],
): PermissionCatalog => buildCatalog(parseCatalogVersion(version), definitions.map(createPermission), 'EXPERIMENTAL');

/**
 * Estende um catálogo reconhecido (`untrusted-catalog` caso contrário) numa versão superior, sem
 * alterar a base. O resultado é sempre EXPERIMENTAL, mesmo a partir do oficial: a extensão do
 * catálogo oficial faz-se por alteração controlada das definições em código, numa versão nova do
 * software (D-149), e não por composição em execução.
 */
export const extendExperimentalPermissionCatalog = (
  base: PermissionCatalog,
  version: number,
  additions: readonly PermissionDefinition[],
): PermissionCatalog => {
  const recognized = requireRecognizedPermissionCatalog(base);
  const next = parseCatalogVersion(version);
  if (next <= recognized.version) throw new AuthorizationContractError('invalid-catalog-version');
  return buildCatalog(next, [...recognized.permissions, ...additions.map(createPermission)], 'EXPERIMENTAL');
};

/**
 * Exige um catálogo reconhecido (`untrusted-catalog`), e nele uma permissão registada
 * (`unknown-permission`) e disponível (`permission-unavailable`).
 */
export const requireRegisteredPermission = (catalog: PermissionCatalog, code: PermissionCode): Permission => {
  const permission = requireRecognizedPermissionCatalog(catalog).find(code);
  if (permission === undefined) throw new AuthorizationContractError('unknown-permission');
  if (permission.status !== 'AVAILABLE') throw new AuthorizationContractError('permission-unavailable');
  return permission;
};

// Cada definição é congelada individualmente (E1.07-D1-R1, RV-D1-M-03); os campos são texto.
const installation = (code: string, description: string): PermissionDefinition =>
  Object.freeze({ authorityScope: 'INSTALLATION', category: 'ADMINISTRATION', code, description });

const company = (code: string, description: string): PermissionDefinition =>
  Object.freeze({ authorityScope: 'COMPANY', category: 'ADMINISTRATION', code, description });

const branch = (code: string, description: string): PermissionDefinition =>
  Object.freeze({ authorityScope: 'BRANCH', category: 'ADMINISTRATION', code, description });

export const INITIAL_PERMISSION_CATALOG_VERSION = 1;

/**
 * Definições do catálogo oficial na versão 1 (E1.07-D1): só a fundação da administração da
 * instalação e da empresa. Sem vendas, compras, POS, stock, contabilidade nem módulos sectoriais.
 * O array e cada definição estão congelados. Reutilizá-las noutro catálogo não lhe dá proveniência
 * oficial.
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

/**
 * Catálogo operacional OFICIAL: o único objecto com proveniência `OFFICIAL`, construído uma vez
 * neste módulo. Novos módulos entram por alteração controlada das definições oficiais em código,
 * numa versão superior, nunca por injecção em execução. Não é uma autorização: só define o que
 * existe.
 */
export const OFFICIAL_PERMISSION_CATALOG: PermissionCatalog = buildCatalog(
  parseCatalogVersion(INITIAL_PERMISSION_CATALOG_VERSION),
  INITIAL_PERMISSION_DEFINITIONS.map(createPermission),
  'OFFICIAL',
);
