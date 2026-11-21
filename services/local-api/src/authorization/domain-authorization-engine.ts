import { randomUUID } from 'node:crypto';

import {
  createAuthorizationRequest,
  createTenantContext,
  DomainValidationError,
  evaluateAuthorizationFacts,
  OFFICIAL_PERMISSION_CATALOG,
  requireOfficialPermissionCatalog,
  type AuthorizationDecision,
  type AuthorizationRequest,
  type AuthorizationRequestInput,
  type CompanyAuthorizationFacts,
  type CompanyId,
  type TenantContext,
  type UserId,
} from '@kil-business/shared-types';

/*
 * Motor INTERNO de avaliação RBAC sobre factos persistidos (E1.07-D2, D-182).
 *
 * Recebe apenas um pedido de avaliação de domínio (identidade, código da permissão e alvo), obtém
 * todos os factos dos repositórios internos, numa leitura consistente e só do tenant do alvo, e
 * aplica as regras puras de E1.07-D1 com o catálogo OFICIAL fixado neste módulo. O consumidor não
 * fornece perfis, concessões, atribuições, catálogos nem decisões: campos adicionais do pedido são
 * ignorados, porque o pedido é reconstruído só com os campos do contrato.
 *
 * O resultado é uma DECISÃO DE DOMÍNIO genuína (`inspectDomainDecision`), NÃO uma autorização
 * operacional (E1.07-D4): o pedido não é autenticado, o `userId` não vem de uma sessão validada e o
 * tenant indicado no alvo não prova autoridade. Nenhuma operação protegida, HTTP ou IPC aceita esta
 * decisão como prova de autoridade.
 */

/**
 * Actor do contexto interno usado para ler os factos. Identifica, nos registos e erros, que o
 * contexto NÃO deriva de uma identidade autenticada (PD-27 continua aberta até E1.07-D4).
 */
export const UNAUTHENTICATED_DOMAIN_EVALUATION_ACTOR = 'unauthenticated:internal-rbac-domain-evaluation';

/** Fonte interna dos factos de uma empresa (composição do serviço); nunca fornecida pelo consumidor. */
export type CompanyAuthorizationFactsSource = (
  context: TenantContext,
  userId: UserId,
  companyId: CompanyId,
) => Promise<CompanyAuthorizationFacts | undefined>;

export interface InternalDomainAuthorizationEvaluator {
  /**
   * Avaliação de domínio NÃO autenticada de um pedido sobre os factos persistidos. Recusa por
   * omissão. Pedidos estruturalmente inválidos são recusados com `DomainValidationError`; uma base
   * com registos inválidos falha fechada (`PersistenceError`), sem decisão.
   */
  evaluate(request: AuthorizationRequestInput): Promise<AuthorizationDecision>;
}

/** Catálogo do motor: só o oficial; recusa catálogos experimentais e desconhecidos. */
export const requireDomainEvaluationCatalog = requireOfficialPermissionCatalog;

const contextFor = (request: AuthorizationRequest): TenantContext | undefined =>
  request.scope.kind === 'INSTALLATION'
    ? undefined
    : createTenantContext({
        actorId: UNAUTHENTICATED_DOMAIN_EVALUATION_ACTOR,
        correlationId: randomUUID(),
        tenantId: request.scope.tenantId,
      });

export const createInternalDomainAuthorizationEvaluator = (
  readCompanyFacts: CompanyAuthorizationFactsSource,
): InternalDomainAuthorizationEvaluator => {
  const catalog = requireDomainEvaluationCatalog(OFFICIAL_PERMISSION_CATALOG);

  const evaluate = async (input: AuthorizationRequestInput): Promise<AuthorizationDecision> => {
    if (typeof input !== 'object' || input === null || typeof input.scope !== 'object' || input.scope === null) {
      throw new DomainValidationError('request', 'não é um pedido de avaliação');
    }
    const request = createAuthorizationRequest({
      permissionCode: input.permissionCode,
      scope: input.scope,
      userId: input.userId,
    });
    const context = contextFor(request);
    // A autoridade da instalação (concessões `installation.*`) só será persistida em E1.07-D3: até
    // lá, um pedido da instalação não tem factos e é recusado (`no-installation-authority`), e a
    // autoridade da instalação nunca é consultada em pedidos empresariais.
    if (context === undefined || request.scope.kind === 'INSTALLATION') {
      return evaluateAuthorizationFacts({ catalog, request });
    }
    const company = await readCompanyFacts(context, request.userId, request.scope.companyId);
    return evaluateAuthorizationFacts({ catalog, company, request });
  };

  return Object.freeze({ evaluate });
};
