import { PersistenceError, resolveDatabaseLocation } from '@kil-business/database';

export const LOCAL_SERVICE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export const MISSING_DATABASE_POLICIES = ['create', 'fail'] as const;
export const PENDING_MIGRATION_POLICIES = ['apply', 'fail'] as const;

export type LocalServiceEnvironment = (typeof LOCAL_SERVICE_ENVIRONMENTS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type MissingDatabasePolicy = (typeof MISSING_DATABASE_POLICIES)[number];
export type PendingMigrationPolicy = (typeof PENDING_MIGRATION_POLICIES)[number];

/** Política de inicialização: o que fazer perante base inexistente ou migrações pendentes. */
export interface StartupPolicy {
  readonly onMissingDatabase: MissingDatabasePolicy;
  readonly onPendingMigrations: PendingMigrationPolicy;
}

/** Configuração validada. Não admite SQL, pragmas nem migrações: o esquema vem só do código. */
export interface LocalServiceConfig {
  readonly databasePath: string;
  readonly environment: LocalServiceEnvironment;
  readonly logLevel: LogLevel;
  readonly instanceId: string;
  readonly startupPolicy: StartupPolicy;
}

/** Variáveis de ambiente lidas explicitamente; nenhum ficheiro `.env` é carregado. */
export const LOCAL_SERVICE_ENV = {
  databasePath: 'LOCAL_DATABASE_PATH',
  environment: 'LOCAL_SERVICE_ENVIRONMENT',
  instanceId: 'LOCAL_SERVICE_INSTANCE_ID',
  logLevel: 'LOCAL_SERVICE_LOG_LEVEL',
  onMissingDatabase: 'LOCAL_SERVICE_ON_MISSING_DATABASE',
  onPendingMigrations: 'LOCAL_SERVICE_ON_PENDING_MIGRATIONS',
} as const;

export class LocalServiceConfigError extends Error {
  override readonly name = 'LocalServiceConfigError';

  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`Configuração inválida em '${field}': ${reason}.`);
  }
}

export interface ConfigValidationOptions {
  /** Directórios onde a base nunca pode ficar (código e artefactos de build). */
  readonly protectedDirectories: readonly string[];
}

const CONFIG_KEYS = ['databasePath', 'environment', 'instanceId', 'logLevel', 'startupPolicy'] as const;
const POLICY_KEYS = ['onMissingDatabase', 'onPendingMigrations'] as const;

// Restrito para impedir injecção nos registos estruturados.
const INSTANCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[], prefix: string): void => {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected !== undefined) {
    throw new LocalServiceConfigError(`${prefix}${unexpected}`, 'propriedade não suportada');
  }
};

const oneOf = <const Allowed extends readonly string[]>(
  value: unknown,
  allowed: Allowed,
  field: string,
): Allowed[number] => {
  if (value === undefined || value === '') throw new LocalServiceConfigError(field, 'é obrigatório');
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) throw new LocalServiceConfigError(field, `deve ser um de: ${allowed.join(', ')}`);
  return match;
};

const databasePathFrom = (value: unknown, options: ConfigValidationOptions): string => {
  if (typeof value !== 'string') throw new LocalServiceConfigError('databasePath', 'é obrigatório');
  try {
    return resolveDatabaseLocation(value, options);
  } catch (error) {
    if (error instanceof PersistenceError) throw new LocalServiceConfigError('databasePath', error.reason);
    throw error;
  }
};

/** Valida configuração programática; propriedades desconhecidas são recusadas. */
export const parseLocalServiceConfig = (
  input: unknown,
  options: ConfigValidationOptions,
): LocalServiceConfig => {
  if (!isRecord(input)) throw new LocalServiceConfigError('config', 'é obrigatória');
  assertOnlyKeys(input, CONFIG_KEYS, '');
  const policy = input['startupPolicy'];
  if (!isRecord(policy)) throw new LocalServiceConfigError('startupPolicy', 'é obrigatória');
  assertOnlyKeys(policy, POLICY_KEYS, 'startupPolicy.');

  const instanceId = input['instanceId'];
  if (instanceId === undefined || instanceId === '') {
    throw new LocalServiceConfigError('instanceId', 'é obrigatório');
  }
  if (typeof instanceId !== 'string' || !INSTANCE_ID.test(instanceId)) {
    throw new LocalServiceConfigError('instanceId', 'deve ter 1 a 64 caracteres [A-Za-z0-9._-]');
  }

  return Object.freeze({
    databasePath: databasePathFrom(input['databasePath'], options),
    environment: oneOf(input['environment'], LOCAL_SERVICE_ENVIRONMENTS, 'environment'),
    instanceId,
    logLevel: input['logLevel'] === undefined ? 'info' : oneOf(input['logLevel'], LOG_LEVELS, 'logLevel'),
    startupPolicy: Object.freeze({
      onMissingDatabase: oneOf(policy['onMissingDatabase'], MISSING_DATABASE_POLICIES, 'startupPolicy.onMissingDatabase'),
      onPendingMigrations: oneOf(
        policy['onPendingMigrations'],
        PENDING_MIGRATION_POLICIES,
        'startupPolicy.onPendingMigrations',
      ),
    }),
  });
};

/** Constrói a configuração a partir de um ambiente injectado (normalmente `process.env`). */
export const loadLocalServiceConfigFromEnv = (
  env: Readonly<Record<string, string | undefined>>,
  options: ConfigValidationOptions,
): LocalServiceConfig => {
  const read = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === '' ? undefined : value;
  };
  return parseLocalServiceConfig(
    {
      databasePath: read(LOCAL_SERVICE_ENV.databasePath),
      environment: read(LOCAL_SERVICE_ENV.environment),
      instanceId: read(LOCAL_SERVICE_ENV.instanceId),
      logLevel: read(LOCAL_SERVICE_ENV.logLevel),
      startupPolicy: {
        onMissingDatabase: read(LOCAL_SERVICE_ENV.onMissingDatabase),
        onPendingMigrations: read(LOCAL_SERVICE_ENV.onPendingMigrations),
      },
    },
    options,
  );
};
