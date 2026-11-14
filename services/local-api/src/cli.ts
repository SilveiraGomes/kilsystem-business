import {
  loadLocalServiceConfigFromEnv,
  LocalServiceConfigError,
  type LocalServiceConfig,
} from './config.js';
import { createLocalService, type LocalServiceDependencies } from './local-service.js';
import { createJsonLogger } from './logger.js';

export const LOCAL_SERVICE_EXIT_CODES = Object.freeze({
  ok: 0,
  startupFailed: 1,
  invalidConfiguration: 2,
});

export interface LocalServiceCliIo {
  /** Recebe uma linha JSON por registo. */
  readonly sink: (line: string) => void;
  /** Resolve com o nome do sinal quando o encerramento é pedido (ex.: Ctrl+C). */
  readonly waitForShutdownSignal: () => Promise<string>;
}

export interface LocalServiceCliOptions {
  readonly protectedDirectories: readonly string[];
  readonly openDatabase?: LocalServiceDependencies['openDatabase'];
}

/**
 * Executa o serviço local. Sem argumentos, mantém-se em `READY` até ao pedido de encerramento;
 * com `--check`, arranca e encerra de imediato (verificação de arranque).
 */
export const runLocalServiceCli = async (
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: LocalServiceCliIo,
  { openDatabase, protectedDirectories }: LocalServiceCliOptions,
): Promise<number> => {
  const bootstrap = createJsonLogger({ instanceId: 'bootstrap', level: 'info', sink: io.sink });
  const unsupported = args.filter((argument) => argument !== '--check');
  if (unsupported.length > 0) {
    bootstrap.log('error', 'service.arguments_invalid', { unsupportedArguments: unsupported.length });
    return LOCAL_SERVICE_EXIT_CODES.invalidConfiguration;
  }

  let config: LocalServiceConfig;
  try {
    config = loadLocalServiceConfigFromEnv(env, { protectedDirectories });
  } catch (error) {
    if (!(error instanceof LocalServiceConfigError)) throw error;
    bootstrap.log('error', 'service.config_invalid', { field: error.field, reason: error.reason });
    return LOCAL_SERVICE_EXIT_CODES.invalidConfiguration;
  }

  const logger = createJsonLogger({ instanceId: config.instanceId, level: config.logLevel, sink: io.sink });
  const service = createLocalService(config, {
    logger,
    protectedDirectories,
    ...(openDatabase === undefined ? {} : { openDatabase }),
  });

  try {
    await service.start();
  } catch {
    await service.stop();
    return LOCAL_SERVICE_EXIT_CODES.startupFailed;
  }

  if (!args.includes('--check')) {
    logger.log('info', 'service.waiting_for_shutdown');
    const signal = await io.waitForShutdownSignal();
    logger.log('info', 'service.shutdown_requested', { signal });
  }

  try {
    await service.stop();
  } catch {
    return LOCAL_SERVICE_EXIT_CODES.startupFailed;
  }
  return LOCAL_SERVICE_EXIT_CODES.ok;
};
