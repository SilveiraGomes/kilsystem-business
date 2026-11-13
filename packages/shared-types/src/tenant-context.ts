import { TenantContextError } from './errors.js';
import {
  isTraceId,
  parseActorId,
  parseCorrelationId,
  parseTenantId,
  type ActorId,
  type CorrelationId,
  type TenantId,
} from './identifiers.js';
import { isCanonicalUuid } from './validation.js';

/**
 * Contexto obrigatório de qualquer acesso a dados empresariais. Deve ser construído a partir
 * de identidade autenticada (etapa futura); nunca de um identificador fornecido apenas pelo cliente.
 */
export interface TenantContext {
  readonly tenantId: TenantId;
  readonly actorId: ActorId;
  readonly correlationId: CorrelationId;
}

export interface TenantContextInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly correlationId: string;
}

export const createTenantContext = (input: TenantContextInput): TenantContext =>
  Object.freeze({
    tenantId: parseTenantId(input.tenantId),
    actorId: parseActorId(input.actorId),
    correlationId: parseCorrelationId(input.correlationId),
  });

/** Guarda de execução para fronteiras onde a tipagem estática pode ser contornada. */
export function assertTenantContext(value: unknown): asserts value is TenantContext {
  if (value === undefined || value === null) throw new TenantContextError('missing');
  const valid =
    typeof value === 'object' &&
    'tenantId' in value &&
    isCanonicalUuid(value.tenantId) &&
    'actorId' in value &&
    isTraceId(value.actorId) &&
    'correlationId' in value &&
    isTraceId(value.correlationId);
  if (!valid) throw new TenantContextError('invalid');
}
