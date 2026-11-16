import { LOG_LEVELS, type LogLevel } from './config.js';

/** Valores permitidos em registos: apenas escalares e listas de números. */
export type LogValue = string | number | boolean | null | readonly number[];
export type LogFields = Readonly<Record<string, LogValue>>;

export interface Logger {
  readonly log: (level: LogLevel, event: string, fields?: LogFields) => void;
}

export interface JsonLoggerOptions {
  readonly level: LogLevel;
  readonly instanceId: string;
  /** Recebe uma linha JSON por registo. */
  readonly sink: (line: string) => void;
  readonly clock?: () => Date;
}

// Defesa em profundidade: estes campos nunca são escritos, mesmo que algum chamador os envie.
const SENSITIVE_KEY =
  /nif|tax|password|passwd|secret|token|credential|legal.?name|email|phone|user.?name|display.?name|salt|hash/i;

const sanitize = (fields: LogFields): LogFields =>
  Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : value]),
  );

/** Registo estruturado em JSON Lines, filtrado por nível. */
export const createJsonLogger = ({ clock = () => new Date(), instanceId, level, sink }: JsonLoggerOptions): Logger => {
  const threshold = LOG_LEVELS.indexOf(level);
  return {
    log: (recordLevel, event, fields = {}) => {
      if (LOG_LEVELS.indexOf(recordLevel) < threshold) return;
      sink(
        JSON.stringify({
          ...sanitize(fields),
          event,
          instanceId,
          level: recordLevel,
          time: clock().toISOString(),
        }),
      );
    },
  };
};
