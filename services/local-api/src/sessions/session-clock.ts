import { randomBytes } from 'node:crypto';

/*
 * Relógio das sessões (E1.07-C, D-112; corrigido em E1.07-C-R1, D-124). As sessões e os
 * comprovativos só são válidos dentro do arranque do serviço que os emitiu, pelo que o relógio
 * monotónico do processo é comparável durante toda a sua vida. Ambos os relógios são lidos em
 * milissegundos (`Date#getTime` e `performance.now()`).
 *
 * Instante efectivo: `efectivo = max(parede, efectivo anterior + Δmonotónico)`, em que
 * Δmonotónico é o tempo monotónico decorrido desde a leitura anterior. Consequências:
 * - o instante efectivo nunca recua;
 * - avança sempre, pelo menos, o tempo monotónico decorrido, também depois de um avanço do
 *   relógio de parede seguido de retrocesso (o defeito RV-01 congelava-o até o tempo real
 *   alcançar o instante adiantado);
 * - um retrocesso do relógio de parede não prolonga nenhuma validade;
 * - um avanço do relógio de parede antecipa as expirações (conservador para o acesso);
 * - numa suspensão em que o relógio monotónico pare, o relógio de parede faz avançar o instante.
 *
 * Para não perder fracções em leituras muito frequentes, o tempo monotónico não é somado leitura
 * a leitura: o instante é calculado como `base + (monotónico - monotónico da base)`, e a base só
 * muda quando o relógio de parede passa à frente. Assim, o erro de arredondamento não se acumula.
 *
 * `earliestPlausible` é o instante MAIS ANTIGO compatível com o que este processo observou:
 * `min(parede, parede inicial + monotónico decorrido desde a criação)`. Serve apenas para limitar
 * eliminações irreversíveis (D-125): um avanço do relógio de parede durante o arranque não pode,
 * sozinho, autorizar a eliminação de registos. Não corrige um relógio que já estava adiantado
 * quando o processo começou; por isso a eliminação automática no arranque está suspensa.
 */

/** Milissegundos de um relógio monotónico (por omissão, `performance.now()`). */
export type MonotonicClock = () => number;

export interface SessionClock {
  /** Instante efectivo em milissegundos: nunca recua; usado em todas as expirações. */
  (): number;
  /** Instante mais antigo plausível em milissegundos: usado só para limitar eliminações. */
  readonly earliestPlausible: () => number;
}

export const systemMonotonicClock: MonotonicClock = () => performance.now();

const finiteOrUndefined = (value: number): number | undefined => (Number.isFinite(value) ? value : undefined);

export const createSessionClock = (wall: () => Date, monotonic: MonotonicClock): SessionClock => {
  const anchorMonotonic = monotonic();
  if (!Number.isFinite(anchorMonotonic)) throw new RangeError('Relógio monotónico inválido.');
  const anchorWall = finiteOrUndefined(wall().getTime()) ?? 0;

  // Maior leitura monotónica observada: um valor inválido ou que recue é ignorado, sem contar
  // duas vezes o mesmo intervalo.
  let monotonicHigh = anchorMonotonic;
  // Instante efectivo e leitura monotónica no último ponto em que o relógio de parede passou à frente.
  let baseEffective = anchorWall;
  let baseMonotonic = anchorMonotonic;

  const observe = (): { readonly wall: number | undefined } => {
    const current = monotonic();
    if (Number.isFinite(current) && current > monotonicHigh) monotonicHigh = current;
    return { wall: finiteOrUndefined(wall().getTime()) };
  };

  const now = (): number => {
    const { wall: wallNow } = observe();
    const advanced = baseEffective + (monotonicHigh - baseMonotonic);
    if (wallNow !== undefined && wallNow > advanced) {
      baseEffective = wallNow;
      baseMonotonic = monotonicHigh;
      return wallNow;
    }
    return advanced;
  };

  const earliestPlausible = (): number => {
    const { wall: wallNow } = observe();
    const sinceAnchor = anchorWall + (monotonicHigh - anchorMonotonic);
    return wallNow === undefined ? sinceAnchor : Math.min(wallNow, sinceAnchor);
  };

  return Object.assign(now, { earliestPlausible });
};

/** Identificador aleatório (128 bits, hexadecimal) de cada arranque efectivo do serviço. */
export const createServiceRunId = (): string => randomBytes(16).toString('hex');
