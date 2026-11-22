import { createHash } from 'node:crypto';

import type { ThrottleRecord } from '@kil-business/database';

/*
 * Limitação de tentativas de autenticação (D-094). Contagem pessimista: cada tentativa admitida
 * é contada como falha ANTES da derivação e só é anulada se for bem-sucedida. Tentativas
 * concorrentes não conseguem, por isso, ultrapassar o limite.
 */
export const AUTHENTICATION_THROTTLE_POLICY = Object.freeze({
  /** Falhas consecutivas por username antes do primeiro bloqueio temporário. */
  freeFailures: 5,
  /** Primeiro bloqueio; duplica a cada falha seguinte. */
  baseLockSeconds: 30,
  /** Bloqueio máximo; não existem bloqueios permanentes. */
  maxLockSeconds: 900,
  /** Sem tentativas durante este período, o contador por username é esquecido. */
  failureMemorySeconds: 86400,
  /** Janela fixa do limite global da instância. */
  instanceWindowSeconds: 300,
  /** Falhas na janela, em qualquer username, que suspendem a instância até ao fim da janela. */
  instanceMaxFailures: 100,
  /** Número máximo de chaves de username guardadas (as mais antigas são descartadas). */
  maxTrackedKeys: 10000,
  /** Diferença tolerada para registos "no futuro" (relógio atrasado) antes de os corrigir. */
  clockSkewToleranceSeconds: 60,
});

/** Forma de uma política (valores numéricos); a da recuperação (E1.07-D3-R1) usa outros valores. */
export type ThrottlePolicy = { readonly [Key in keyof typeof AUTHENTICATION_THROTTLE_POLICY]: number };

export const INSTANCE_THROTTLE_KEY = 'instance';

/** Chave por username normalizado: SHA-256, sem guardar o username em texto (incluindo os inexistentes). */
export const throttleKeyFor = (normalizedUsername: string): string =>
  `user:${createHash('sha256').update(normalizedUsername, 'utf8').digest('hex')}`;

export type AttemptDecision =
  | { readonly allowed: false; readonly retryAfterSeconds: number }
  | { readonly allowed: true; readonly user: ThrottleRecord; readonly instance: ThrottleRecord };

const SECOND = 1000;
const iso = (milliseconds: number): string => new Date(milliseconds).toISOString();
const time = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

/**
 * Um bloqueio nunca dura mais do que `maxSeconds` desde o momento em que foi registado
 * (`since`): um valor adulterado ou corrompido não se torna permanente.
 */
const clampedLock = (lockedUntil: string | undefined, since: number, maxSeconds: number): number | undefined => {
  const until = time(lockedUntil);
  return until === undefined ? undefined : Math.min(until, since + maxSeconds * SECOND);
};

const retryAfter = (until: number, now: number): number => Math.max(1, Math.ceil((until - now) / SECOND));

const lockFor = (failures: number, policy: ThrottlePolicy): number =>
  Math.min(policy.baseLockSeconds * 2 ** (failures - policy.freeFailures), policy.maxLockSeconds);

/**
 * Decide se uma tentativa é admitida e devolve os registos já contados. `now` vem de um relógio
 * injectado. Registos ilegíveis ou "no futuro" são tratados de forma segura.
 */
export const evaluateAttempt = (
  key: string,
  userRecord: ThrottleRecord | undefined,
  instanceRecord: ThrottleRecord | undefined,
  now: number,
  policy: ThrottlePolicy = AUTHENTICATION_THROTTLE_POLICY,
): AttemptDecision => {
  const skew = policy.clockSkewToleranceSeconds * SECOND;

  // Limite global da instância, por janela fixa. Janela inválida, terminada ou no futuro: reinicia.
  const windowStart = time(instanceRecord?.windowStartedAt);
  const windowValid =
    instanceRecord !== undefined &&
    windowStart !== undefined &&
    windowStart <= now + skew &&
    now < windowStart + policy.instanceWindowSeconds * SECOND;
  const instanceFailures = windowValid ? instanceRecord.failures : 0;
  const instanceStart = windowValid && windowStart !== undefined ? Math.min(windowStart, now) : now;
  const instanceLock = windowValid
    ? clampedLock(instanceRecord.lockedUntil, instanceStart, policy.instanceWindowSeconds)
    : undefined;
  if (instanceLock !== undefined && instanceLock > now) {
    return { allowed: false, retryAfterSeconds: retryAfter(instanceLock, now) };
  }

  // Contador por username: esquecido após um período sem tentativas. Um registo "no futuro"
  // (relógio recuado) mantém o contador, mas o bloqueio guardado não é aplicado: a falha seguinte
  // volta a bloquear, já com a duração escalada.
  const lastAttempt = time(userRecord?.lastAttemptAt);
  const inFuture = lastAttempt !== undefined && lastAttempt > now + skew;
  const remembered =
    userRecord !== undefined &&
    lastAttempt !== undefined &&
    (inFuture || now - lastAttempt < policy.failureMemorySeconds * SECOND);
  const userFailures = remembered ? userRecord.failures : 0;
  const userLock =
    remembered && !inFuture ? clampedLock(userRecord.lockedUntil, lastAttempt, policy.maxLockSeconds) : undefined;
  if (userLock !== undefined && userLock > now) {
    return { allowed: false, retryAfterSeconds: retryAfter(userLock, now) };
  }

  const failures = userFailures + 1;
  const counted = instanceFailures + 1;
  return {
    allowed: true,
    instance: Object.freeze({
      failures: counted,
      key: INSTANCE_THROTTLE_KEY,
      lastAttemptAt: iso(now),
      lockedUntil:
        counted >= policy.instanceMaxFailures ? iso(instanceStart + policy.instanceWindowSeconds * SECOND) : undefined,
      windowStartedAt: iso(instanceStart),
    }),
    user: Object.freeze({
      failures,
      key,
      lastAttemptAt: iso(now),
      lockedUntil: failures >= policy.freeFailures ? iso(now + lockFor(failures, policy) * SECOND) : undefined,
      // Início da sequência de falhas em curso.
      windowStartedAt: remembered ? userRecord.windowStartedAt : iso(now),
    }),
  };
};

/** Após uma autenticação válida: a falha contada antecipadamente é anulada na instância. */
export const instanceAfterSuccess = (instance: ThrottleRecord | undefined): ThrottleRecord | undefined =>
  instance === undefined || instance.failures === 0
    ? instance
    : Object.freeze({ ...instance, failures: instance.failures - 1, lockedUntil: undefined });
