import type { RecoveryThrottleRecord } from '@kil-business/database';

import { evaluateAttempt, type ThrottlePolicy } from './throttle-policy.js';

/*
 * Limitação própria da recuperação do administrador inicial (E1.07-D3-R1; D-233, DP-06), separada da
 * autenticação (D-094) e guardada numa tabela própria (a de autenticação só aceita as chaves
 * `instance` e `user:…`). Reutiliza a função pura `evaluateAttempt`: contagem pessimista antes da
 * derivação, bloqueio exponencial limitado, nunca permanente, e registos "no futuro" tratados com
 * segurança. O limite por instância não se aplica (existe uma única chave).
 */
export const RECOVERY_THROTTLE_POLICY: ThrottlePolicy = Object.freeze({
  /** Falhas antes do primeiro bloqueio. */
  freeFailures: 3,
  /** Primeiro bloqueio; duplica a cada falha seguinte. */
  baseLockSeconds: 60,
  /** Bloqueio máximo; nunca permanente. */
  maxLockSeconds: 3600,
  /** Sem tentativas durante 7 dias, o contador é esquecido. */
  failureMemorySeconds: 604800,
  instanceWindowSeconds: 300,
  instanceMaxFailures: Number.MAX_SAFE_INTEGER,
  maxTrackedKeys: 1,
  clockSkewToleranceSeconds: 60,
});

const RECOVERY_THROTTLE_KEY = 'recovery';

export type RecoveryAdmission =
  | { readonly allowed: false; readonly retryAfterSeconds: number; readonly refused: RecoveryThrottleRecord }
  | { readonly allowed: true; readonly counted: RecoveryThrottleRecord };

/**
 * Decide a admissão de uma tentativa e devolve o registo a gravar: com a falha já contada, se for
 * admitida; com a recusa somada à contagem agregada, se não for (sem crescimento da base).
 */
export const evaluateRecoveryAttempt = (
  record: RecoveryThrottleRecord | undefined,
  now: number,
  policy: ThrottlePolicy = RECOVERY_THROTTLE_POLICY,
): RecoveryAdmission => {
  const refusedCount = record?.refusedCount ?? 0;
  const decision = evaluateAttempt(
    RECOVERY_THROTTLE_KEY,
    record === undefined ? undefined : { ...record, key: RECOVERY_THROTTLE_KEY },
    undefined,
    now,
    policy,
  );
  if (!decision.allowed) {
    const base = record ?? {
      failures: 0,
      lastAttemptAt: new Date(now).toISOString(),
      lockedUntil: undefined,
      windowStartedAt: new Date(now).toISOString(),
    };
    return {
      allowed: false,
      refused: Object.freeze({
        failures: base.failures,
        lastAttemptAt: base.lastAttemptAt,
        lockedUntil: base.lockedUntil,
        refusedCount: refusedCount + 1,
        windowStartedAt: base.windowStartedAt,
      }),
      retryAfterSeconds: decision.retryAfterSeconds,
    };
  }
  return {
    allowed: true,
    counted: Object.freeze({
      failures: decision.user.failures,
      lastAttemptAt: decision.user.lastAttemptAt,
      lockedUntil: decision.user.lockedUntil,
      refusedCount,
      windowStartedAt: decision.user.windowStartedAt,
    }),
  };
};

/** Depois de uma recuperação bem-sucedida: falhas esquecidas; a contagem agregada de recusas mantém-se. */
export const recoveryThrottleAfterSuccess = (
  record: RecoveryThrottleRecord | undefined,
  at: string,
): RecoveryThrottleRecord =>
  Object.freeze({
    failures: 0,
    lastAttemptAt: at,
    lockedUntil: undefined,
    refusedCount: record?.refusedCount ?? 0,
    windowStartedAt: at,
  });
