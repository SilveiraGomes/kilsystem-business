import { randomBytes } from 'node:crypto';

/*
 * Relógio das sessões (E1.07-C, D-112). As sessões e os comprovativos só são válidos dentro do
 * arranque do serviço que os emitiu, pelo que o relógio monotónico do processo é comparável
 * durante toda a sua vida. O instante efectivo é o MAIOR entre:
 * - o relógio de parede;
 * - o relógio de parede no momento da composição mais o tempo monotónico decorrido;
 * - o último instante efectivo devolvido.
 * Consequências: um retrocesso do relógio de parede não prolonga nenhuma validade (o tempo
 * continua a avançar pelo relógio monotónico); um avanço do relógio de parede antecipa as
 * expirações (comportamento conservador); o instante efectivo nunca recua.
 */

/** Milissegundos de um relógio monotónico (por omissão, `performance.now()`). */
export type MonotonicClock = () => number;

export type SessionClock = () => number;

export const systemMonotonicClock: MonotonicClock = () => performance.now();

export const createSessionClock = (wall: () => Date, monotonic: MonotonicClock): SessionClock => {
  const read = (): { readonly wall: number; readonly monotonic: number } => ({
    monotonic: monotonic(),
    wall: wall().getTime(),
  });
  const anchor = read();
  if (!Number.isFinite(anchor.monotonic)) throw new RangeError('Relógio monotónico inválido.');
  const anchorWall = Number.isFinite(anchor.wall) ? anchor.wall : 0;
  let last = anchorWall;

  return () => {
    const current = read();
    const elapsed = Number.isFinite(current.monotonic) ? current.monotonic - anchor.monotonic : 0;
    const candidates = [anchorWall + Math.max(0, elapsed), last];
    if (Number.isFinite(current.wall)) candidates.push(current.wall);
    last = Math.max(...candidates);
    return last;
  };
};

/** Identificador aleatório (128 bits, hexadecimal) de cada arranque efectivo do serviço. */
export const createServiceRunId = (): string => randomBytes(16).toString('hex');
