import { DomainValidationError, TenantMismatchError } from './errors.js';
import {
  parseBranchId,
  parseUserId,
  type BranchId,
  type CompanyId,
  type RoleAssignmentId,
  type RoleId,
  type TenantId,
  type UserId,
} from './identifiers.js';
import {
  evaluateMembershipScope,
  type MembershipScope,
  type MembershipScopeEvaluation,
  type MembershipScopeFacts,
} from './membership.js';
import {
  authorityOfPermissionScope,
  parsePermissionCode,
  permissionCatalogProvenance,
  type Permission,
  type PermissionCatalog,
  type PermissionCatalogProvenance,
  type PermissionCode,
} from './permission.js';
import type { Role, RolePermission } from './role.js';
import type { RoleAssignment, RoleAssignmentScope } from './role-assignment.js';
import { parseCompanyScope } from './scoped-record.js';
import { isUserEligible, type User } from './user.js';

/*
 * Contratos e regras PURAS de avaliação de concessões (E1.07-D1, corrigidas em E1.07-D1-R1).
 *
 * NÃO são uma fronteira de segurança efectiva. Estas funções avaliam apenas os factos explícitos que
 * recebem: não consultam SQLite nem sessões, não emitem `TenantContext` e não garantem que os factos
 * sejam autênticos ou correntes. Uma decisão `GRANTED` calculada sobre factos fornecidos pelo
 * consumidor não é prova de sessão, de autoridade nem de contexto confiável, e nenhum componente a
 * aceita como tal. A autoridade dos factos (concessões persistidas, sessão validada, revalidação em
 * cada operação) é garantida em E1.07-D2 a E1.07-D4.
 *
 * Quatro categorias distintas (E1.07-D1-R1):
 * 1. pedido de avaliação (`AuthorizationRequest`), fornecido pelo consumidor;
 * 2. decisão de domínio genuína, emitida por `evaluateAuthorizationFacts` e reconhecida por
 *    `inspectDomainDecision` pela identidade do objecto (registo privado deste módulo);
 * 3. valor fabricado, clonado, serializado ou desconhecido: nunca reconhecido, sempre recusa;
 * 4. autorização operacional (sessão, recurso real, associação persistida, execução controlada):
 *    NÃO existe nesta etapa (E1.07-D4) e nenhuma decisão de domínio a substitui.
 *
 * Fronteira de confiança: o registo privado impede a fabricação e a confusão de autoridade através
 * das interfaces suportadas. Não protege contra código arbitrário com controlo total do mesmo
 * processo, e não é reconhecido entre instâncias distintas do módulo (outro processo, outro *realm*
 * ou outra cópia carregada do pacote): nesses casos a decisão não é reconhecida (falha fechada).
 */

/** Recurso sobre o qual a operação será executada. Só identifica o alvo; não prova acesso a ele. */
export type AuthorizationScope =
  | { readonly kind: 'INSTALLATION' }
  | { readonly kind: 'COMPANY'; readonly tenantId: TenantId; readonly companyId: CompanyId }
  | {
      readonly kind: 'BRANCH';
      readonly tenantId: TenantId;
      readonly companyId: CompanyId;
      readonly branchId: BranchId;
    };

/**
 * Pedido de avaliação. Construído pelo consumidor, NÃO constitui prova de sessão, de autoridade nem
 * de contexto confiável: em E1.07-D4, `userId` virá de uma sessão validada pelo serviço.
 */
export interface AuthorizationRequest {
  readonly userId: UserId;
  readonly permissionCode: PermissionCode;
  readonly scope: AuthorizationScope;
}

export type AuthorizationScopeInput =
  | { readonly kind: 'INSTALLATION' }
  | { readonly kind: 'COMPANY'; readonly tenantId: string; readonly companyId: string }
  | { readonly kind: 'BRANCH'; readonly tenantId: string; readonly companyId: string; readonly branchId: string };

export interface AuthorizationRequestInput {
  readonly userId: string;
  readonly permissionCode: string;
  readonly scope: AuthorizationScopeInput;
}

const parseAuthorizationScope = (input: AuthorizationScopeInput): AuthorizationScope => {
  switch (input.kind) {
    case 'INSTALLATION':
      return Object.freeze({ kind: 'INSTALLATION' });
    case 'COMPANY':
      return Object.freeze({ kind: 'COMPANY', ...parseCompanyScope(input) });
    case 'BRANCH':
      return Object.freeze({ kind: 'BRANCH', ...parseCompanyScope(input), branchId: parseBranchId(input.branchId) });
    default:
      throw new DomainValidationError('scope', 'não é um âmbito permitido');
  }
};

/** Validação estrutural do pedido (identificadores e gramática do código). */
export const createAuthorizationRequest = (input: AuthorizationRequestInput): AuthorizationRequest =>
  Object.freeze({
    userId: parseUserId(input.userId),
    permissionCode: parsePermissionCode(input.permissionCode),
    scope: parseAuthorizationScope(input.scope),
  });

/**
 * Concessão explícita da autoridade da instalação a uma identidade. Contrato conceptual: a emissão,
 * a persistência e a delegação são de E1.07-D3. Nunca concede acesso a empresas.
 */
export interface InstallationAuthorityGrant {
  readonly userId: UserId;
  readonly permissionCode: PermissionCode;
}

/** Concessão que tornou uma permissão aplicável ao âmbito pedido (proveniência para diagnóstico e auditoria). */
export type PermissionGrant =
  | {
      readonly source: 'ROLE_ASSIGNMENT';
      readonly permissionCode: PermissionCode;
      readonly roleId: RoleId;
      readonly roleAssignmentId: RoleAssignmentId;
      readonly assignmentScope: RoleAssignmentScope;
    }
  | { readonly source: 'INSTALLATION_AUTHORITY'; readonly permissionCode: PermissionCode };

/** Motivos internos de recusa, para diagnóstico e auditoria futura; nunca devolvidos a consumidores externos. */
export const AUTHORIZATION_DENIAL_REASONS = Object.freeze([
  'untrusted-catalog',
  'unknown-permission',
  'permission-unavailable',
  'scope-mismatch',
  'inconsistent-facts',
  'no-installation-authority',
  'no-membership',
  'user-not-active',
  'membership-inactive',
  'company-not-operational',
  'branch-out-of-scope',
  'permission-not-granted',
] as const);

export type AuthorizationDenialReason = (typeof AUTHORIZATION_DENIAL_REASONS)[number];

// Marca só de compilação: um literal estrutural não é aceite como decisão sem asserção de tipo
// explícita. NÃO é a garantia: o reconhecimento é feito em execução pelo registo privado abaixo.
declare const domainDecisionBrand: unique symbol;

/**
 * Decisão de DOMÍNIO emitida pelo avaliador puro (`evaluateAuthorizationFacts`): explícita,
 * profundamente imutável, recusa por omissão, sem `TenantContext`.
 *
 * Proveniência (E1.07-D1-R1, PD-62): só os objectos emitidos por este módulo, neste processo, são
 * reconhecidos (`inspectDomainDecision`). Objectos fabricados, convertidos por asserção de tipo,
 * clonados, copiados, desserializados ou embrulhados num `Proxy` não são decisões, mesmo com a forma
 * exacta de uma decisão genuína. Uma decisão genuína NÃO prova sessão, identidade efectiva, origem
 * confiável dos factos, autoridade empresarial persistida nem autorização para executar uma operação
 * real: só que estas regras, aplicadas aos factos recebidos, produziram este resultado.
 */
export type AuthorizationDecision = (
  | {
      readonly outcome: 'GRANTED';
      readonly permissionCode: PermissionCode;
      readonly grants: readonly PermissionGrant[];
    }
  | { readonly outcome: 'DENIED'; readonly reason: AuthorizationDenialReason }
) & { readonly [domainDecisionBrand]: true };

/**
 * Resultado da inspecção de um valor como decisão de domínio:
 * - `recognized: false`: pedido, estrutura fabricada, clone, cópia, valor serializado ou
 *   desconhecido (inclui `null` e `undefined`);
 * - `recognized: true`: decisão emitida pelo avaliador puro, com o resultado REGISTADO na emissão
 *   (não lido das propriedades do objecto) e a proveniência do catálogo usado.
 */
export type DomainDecisionInspection =
  | { readonly recognized: false }
  | {
      readonly recognized: true;
      readonly outcome: AuthorizationDecision['outcome'];
      readonly catalog: PermissionCatalogProvenance;
    };

type RecognizedDecision = Extract<DomainDecisionInspection, { readonly recognized: true }>;

// Registo privado do módulo: chave = identidade do objecto emitido; valor = resultado e proveniência
// do catálogo, fixados na emissão. Nenhuma função pública acrescenta entradas sem passar pelo
// avaliador, e nenhuma propriedade, versão ou marca do objecto substitui esta verificação.
const issuedDecisions = new WeakMap<object, RecognizedDecision>();

const NOT_RECOGNIZED: DomainDecisionInspection = Object.freeze({ recognized: false });

const issue = (
  body:
    | { readonly outcome: 'GRANTED'; readonly permissionCode: PermissionCode; readonly grants: readonly PermissionGrant[] }
    | { readonly outcome: 'DENIED'; readonly reason: AuthorizationDenialReason },
  catalog: PermissionCatalogProvenance,
): AuthorizationDecision => {
  const decision = Object.freeze({ ...body }) as AuthorizationDecision;
  issuedDecisions.set(decision, Object.freeze({ recognized: true, outcome: body.outcome, catalog }));
  return decision;
};

const denied = (reason: AuthorizationDenialReason, catalog: PermissionCatalogProvenance): AuthorizationDecision =>
  issue({ outcome: 'DENIED', reason }, catalog);

/** Inspecção da proveniência; nunca lança excepções, para qualquer valor. */
export const inspectDomainDecision = (value: unknown): DomainDecisionInspection =>
  (typeof value === 'object' && value !== null ? issuedDecisions.get(value) : undefined) ?? NOT_RECOGNIZED;

/** Verdadeiro só para decisões emitidas pelo avaliador puro (qualquer resultado). */
export const isDomainAuthorizationDecision = (value: unknown): value is AuthorizationDecision =>
  inspectDomainDecision(value).recognized;

/**
 * Verdadeiro só para uma decisão genuína com resultado registado `GRANTED`, avaliada sobre o
 * catálogo OFICIAL. Concessões sobre catálogos experimentais não contam. Continua a ser apenas uma
 * avaliação de domínio: não é autorização operacional (E1.07-D4).
 */
export const isOfficialDomainGrant = (value: unknown): boolean => {
  const inspection = inspectDomainDecision(value);
  return inspection.recognized && inspection.outcome === 'GRANTED' && inspection.catalog === 'OFFICIAL';
};

/**
 * Resposta externa ILUSTRATIVA de uma avaliação de domínio: idêntica para todas as recusas, sem
 * motivos nem identificadores. `allowed: true` NÃO é autorização efectiva de acesso; a resposta
 * operacional, vinculada a sessão, recurso e operação, é de E1.07-D4.
 */
export type ExternalDomainEvaluationResponse =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly error: 'access-denied' };

const EXTERNAL_ALLOWED: ExternalDomainEvaluationResponse = Object.freeze({ allowed: true });
const EXTERNAL_DENIED: ExternalDomainEvaluationResponse = Object.freeze({ allowed: false, error: 'access-denied' });

/**
 * Converte um valor na resposta externa ilustrativa. Só `isOfficialDomainGrant` produz
 * `allowed: true`; qualquer outro valor (recusa genuína, concessão sobre catálogo experimental,
 * estrutura fabricada, clone, valor serializado, `null`, `undefined`) produz a mesma recusa genérica,
 * que nunca indica se a identidade, a empresa, o estabelecimento, o perfil ou a permissão existem.
 */
export const toExternalDomainEvaluationResponse = (value: unknown): ExternalDomainEvaluationResponse =>
  isOfficialDomainGrant(value) ? EXTERNAL_ALLOWED : EXTERNAL_DENIED;

/** Factos da autoridade empresarial numa empresa: elegibilidade (D-088) e concessões explícitas. */
export interface CompanyAuthorizationFacts {
  readonly membership: MembershipScopeFacts;
  readonly roles: readonly Role[];
  readonly rolePermissions: readonly RolePermission[];
  readonly assignments: readonly RoleAssignment[];
}

/** Factos da autoridade da instalação. */
export interface InstallationAuthorizationFacts {
  readonly user: User;
  readonly grants: readonly InstallationAuthorityGrant[];
}

export interface AuthorizationFacts {
  /**
   * Catálogo construído por `permission.ts` (oficial ou experimental); qualquer outro objecto recusa
   * (`untrusted-catalog`). O futuro caminho operacional (E1.07-D2) usa só o catálogo oficial e não
   * o recebe de pedidos, DTOs nem adaptadores.
   */
  readonly catalog: PermissionCatalog;
  readonly request: AuthorizationRequest;
  /** Factos da empresa do âmbito pedido; ausentes, nenhuma permissão empresarial é aplicável. */
  readonly company?: CompanyAuthorizationFacts | undefined;
  /** Factos da autoridade da instalação; ignorados em pedidos empresariais. */
  readonly installation?: InstallationAuthorizationFacts | undefined;
}

type CompanyTarget = Extract<AuthorizationScope, { readonly kind: 'COMPANY' | 'BRANCH' }>;

type GrantResolution =
  | { readonly ok: false; readonly reason: AuthorizationDenialReason }
  | {
      readonly ok: true;
      readonly eligibility: Extract<MembershipScopeEvaluation, { readonly eligible: true }>;
      readonly grants: readonly PermissionGrant[];
    };

const refused = (reason: AuthorizationDenialReason): GrantResolution => ({ ok: false, reason });

/**
 * Aplicabilidade de uma atribuição activa ao alvo, por intersecção dos âmbitos (E1.07-D1):
 * associação empresarial ∩ associação local ∩ âmbito da atribuição ∩ âmbito exigido.
 * - Alvo `COMPANY`: só atribuições `COMPANY_WIDE` sob associação `COMPANY_WIDE`.
 * - Alvo `BRANCH` (já confirmado como abrangido pela associação): atribuições `COMPANY_WIDE` sob
 *   associação `COMPANY_WIDE`, ou atribuições `BRANCH` desse mesmo estabelecimento.
 */
const assignmentApplies = (
  assignment: RoleAssignment,
  membershipScope: MembershipScope,
  target: CompanyTarget,
  coveredBranches: readonly BranchId[],
): boolean => {
  if (assignment.scope === 'COMPANY_WIDE') return membershipScope === 'COMPANY_WIDE';
  return (
    target.kind === 'BRANCH' &&
    assignment.branchId === target.branchId &&
    coveredBranches.includes(assignment.branchId)
  );
};

const grantsPermissionAt = (permission: Permission | undefined, target: CompanyTarget): boolean =>
  permission !== undefined &&
  permission.status === 'AVAILABLE' &&
  authorityOfPermissionScope(permission.authorityScope) === 'COMPANY' &&
  permission.authorityScope === target.kind;

/**
 * Concessões empresariais aplicáveis ao alvo: a união das permissões dos perfis activos atribuídos
 * por atribuições activas e aplicáveis, só dentro do âmbito comum autorizado. Factos de outro tenant,
 * empresa ou identidade recusam tudo (`inconsistent-facts`).
 */
const resolveCompanyGrants = (
  catalog: PermissionCatalog,
  userId: UserId,
  target: CompanyTarget,
  facts: CompanyAuthorizationFacts,
): GrantResolution => {
  const { membership: scopeFacts } = facts;
  const company = scopeFacts.company;
  if (company.tenantId !== target.tenantId || company.id !== target.companyId) return refused('inconsistent-facts');
  if (scopeFacts.user !== undefined && scopeFacts.user.id !== userId) return refused('inconsistent-facts');
  if (scopeFacts.membership !== undefined && scopeFacts.membership.userId !== userId) return refused('inconsistent-facts');
  const sameCompany = (record: { readonly tenantId: TenantId; readonly companyId?: CompanyId }): boolean =>
    record.tenantId === target.tenantId && (record.companyId === undefined || record.companyId === target.companyId);
  if (!facts.roles.every(sameCompany) || !facts.rolePermissions.every(sameCompany) || !facts.assignments.every(sameCompany)) {
    return refused('inconsistent-facts');
  }

  let eligibility: MembershipScopeEvaluation;
  try {
    eligibility = evaluateMembershipScope(scopeFacts);
  } catch (error) {
    if (error instanceof TenantMismatchError) return refused('inconsistent-facts');
    throw error;
  }
  if (!eligibility.eligible) return refused(eligibility.reason);
  const membership = scopeFacts.membership;
  if (membership === undefined) return refused('no-membership');
  if (target.kind === 'BRANCH' && !eligibility.branchIds.includes(target.branchId)) return refused('branch-out-of-scope');

  const activeRoles = new Map(facts.roles.filter((role) => role.status === 'ACTIVE').map((role) => [role.id, role]));
  const grants: PermissionGrant[] = [];
  for (const assignment of facts.assignments) {
    if (assignment.status !== 'ACTIVE' || assignment.companyMembershipId !== membership.id) continue;
    const role = activeRoles.get(assignment.roleId);
    if (role === undefined) continue;
    if (!assignmentApplies(assignment, membership.scope, target, eligibility.branchIds)) continue;
    for (const rolePermission of facts.rolePermissions) {
      if (rolePermission.roleId !== role.id) continue;
      if (!grantsPermissionAt(catalog.find(rolePermission.permissionCode), target)) continue;
      grants.push(
        Object.freeze({
          source: 'ROLE_ASSIGNMENT',
          permissionCode: rolePermission.permissionCode,
          roleId: role.id,
          roleAssignmentId: assignment.id,
          assignmentScope: assignment.scope,
        }),
      );
    }
  }
  return { ok: true, eligibility, grants };
};

/**
 * União das permissões empresariais aplicáveis a um alvo `COMPANY` ou `BRANCH`, ordenada e sem
 * repetições. Vazia em qualquer recusa (por omissão), incluindo um catálogo sem proveniência
 * reconhecida. Não é uma lista “global” do utilizador: as concessões de um estabelecimento nunca
 * contam noutro. Não é uma decisão nem uma autorização.
 */
export const listApplicablePermissionCodes = (input: {
  readonly catalog: PermissionCatalog;
  readonly userId: UserId;
  readonly scope: AuthorizationScope;
  readonly company: CompanyAuthorizationFacts;
}): readonly PermissionCode[] => {
  try {
    const { catalog, scope } = input;
    if (permissionCatalogProvenance(catalog) === 'UNKNOWN' || scope.kind === 'INSTALLATION') return Object.freeze([]);
    const resolution = resolveCompanyGrants(catalog, input.userId, scope, input.company);
    if (!resolution.ok) return Object.freeze([]);
    return Object.freeze([...new Set(resolution.grants.map((grant) => grant.permissionCode))].sort());
  } catch {
    return Object.freeze([]);
  }
};

/** Avaliação com a proveniência do catálogo já verificada (`OFFICIAL` ou `EXPERIMENTAL`). */
interface Evaluation {
  readonly catalog: PermissionCatalog;
  readonly provenance: PermissionCatalogProvenance;
  readonly request: AuthorizationRequest;
}

const granted = (
  evaluation: Evaluation,
  grants: readonly PermissionGrant[],
): AuthorizationDecision =>
  issue(
    { outcome: 'GRANTED', permissionCode: evaluation.request.permissionCode, grants: Object.freeze([...grants]) },
    evaluation.provenance,
  );

const evaluateInstallation = (
  evaluation: Evaluation,
  facts: InstallationAuthorizationFacts | undefined,
): AuthorizationDecision => {
  const { provenance, request } = evaluation;
  if (facts === undefined) return denied('no-installation-authority', provenance);
  if (facts.user.id !== request.userId || facts.grants.some((grant) => grant.userId !== request.userId)) {
    return denied('inconsistent-facts', provenance);
  }
  if (!isUserEligible(facts.user)) return denied('user-not-active', provenance);
  const matching = facts.grants.filter((grant) => grant.permissionCode === request.permissionCode);
  if (matching.length === 0) return denied('permission-not-granted', provenance);
  return granted(
    evaluation,
    matching.map((grant) => Object.freeze({ source: 'INSTALLATION_AUTHORITY', permissionCode: grant.permissionCode })),
  );
};

const evaluate = (facts: AuthorizationFacts): AuthorizationDecision => {
  const { catalog, request } = facts;
  // O catálogo é lido uma vez e a sua proveniência verificada antes de qualquer consulta: uma
  // estrutura fabricada, copiada ou clonada nunca é consultada.
  const provenance = permissionCatalogProvenance(catalog);
  if (provenance === 'UNKNOWN') return denied('untrusted-catalog', provenance);
  const evaluation: Evaluation = { catalog, provenance, request };
  const permission = catalog.find(request.permissionCode);
  if (permission === undefined) return denied('unknown-permission', provenance);
  if (permission.status !== 'AVAILABLE') return denied('permission-unavailable', provenance);
  if (permission.authorityScope !== request.scope.kind) return denied('scope-mismatch', provenance);
  if (request.scope.kind === 'INSTALLATION') return evaluateInstallation(evaluation, facts.installation);

  // Pedido empresarial: a autoridade da instalação é ignorada (não concede acesso comercial).
  if (facts.company === undefined) return denied('no-membership', provenance);
  const resolution = resolveCompanyGrants(catalog, request.userId, request.scope, facts.company);
  if (!resolution.ok) return denied(resolution.reason, provenance);
  if (permission.category === 'OPERATION' && !resolution.eligibility.companyOperational) {
    return denied('company-not-operational', provenance);
  }
  const matching = resolution.grants.filter((grant) => grant.permissionCode === request.permissionCode);
  if (matching.length === 0) return denied('permission-not-granted', provenance);
  return granted(evaluation, matching);
};

/**
 * Avaliação pura de um pedido sobre factos explícitos; recusa por omissão. Única fonte de decisões
 * reconhecidas (`inspectDomainDecision`). Um catálogo sem proveniência reconhecida recusa
 * (`untrusted-catalog`); qualquer excepção na avaliação (factos malformados) resulta em recusa
 * (`inconsistent-facts`). Admite catálogos experimentais (testes isolados), mas as concessões assim
 * obtidas ficam registadas como experimentais e nunca produzem `allowed: true` externamente.
 *
 * Só para modelação e testes até E1.07-D4: não é autorização integrada e o resultado não deve ser
 * usado para autorizar operações enquanto os factos não vierem de fontes confiáveis (E1.07-D2/D4).
 */
export const evaluateAuthorizationFacts = (facts: AuthorizationFacts): AuthorizationDecision => {
  try {
    return evaluate(facts);
  } catch {
    return denied('inconsistent-facts', 'UNKNOWN');
  }
};
