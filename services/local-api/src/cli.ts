import {
  loadLocalServiceConfigFromEnv,
  LocalServiceConfigError,
  type LocalServiceConfig,
} from './config.js';
import { createLocalService, type LocalServiceDependencies } from './local-service.js';
import { createJsonLogger } from './logger.js';
import { RECOVERY_COMMANDS, runRecoveryCommand, type RecoveryCommand, type RecoveryTerminal } from './recovery-cli.js';

export type { RecoveryTerminal } from './recovery-cli.js';

export const LOCAL_SERVICE_EXIT_CODES = Object.freeze({
  ok: 0,
  startupFailed: 1,
  invalidConfiguration: 2,
  /** Recuperação ou rotação recusadas (E1.07-D3-R1); nada foi alterado. */
  recoveryRefused: 3,
  /** Limitação de tentativas da recuperação ou da autenticação. */
  recoveryThrottled: 4,
  /** Operação confirmada, mas o novo código não foi apresentado ou confirmado: emitir outro com `recovery rotate`. */
  recoveryPresentationFailed: 5,
});

export interface LocalServiceCliIo {
  /** Recebe uma linha JSON por registo. */
  readonly sink: (line: string) => void;
  /** Resolve com o nome do sinal quando o encerramento é pedido (ex.: Ctrl+C). */
  readonly waitForShutdownSignal: () => Promise<string>;
  /** Terminal interactivo; obrigatório para os subcomandos `recovery` (E1.07-D3-R1). */
  readonly terminal?: RecoveryTerminal;
}

export interface LocalServiceCliOptions {
  readonly protectedDirectories: readonly string[];
  readonly openDatabase?: LocalServiceDependencies['openDatabase'];
}

type ParsedArguments =
  | { readonly kind: 'serve'; readonly check: boolean }
  | { readonly kind: 'recovery'; readonly command: RecoveryCommand }
  | { readonly kind: 'invalid'; readonly unsupported: number };

/**
 * Formas aceites: sem argumentos, `--check`, `recovery rotate` e `recovery recover`. Os subcomandos
 * de recuperação não aceitam argumentos adicionais: o código e as palavras-passe só entram pelo
 * terminal (E1.07-D3-R1). Os valores recebidos nunca são registados, só a sua contagem.
 */
const parseArguments = (args: readonly string[]): ParsedArguments => {
  if (args[0] === 'recovery') {
    const command = RECOVERY_COMMANDS.find((candidate) => candidate === args[1]);
    return command !== undefined && args.length === 2
      ? { command, kind: 'recovery' }
      : { kind: 'invalid', unsupported: args.length };
  }
  const unsupported = args.filter((argument) => argument !== '--check');
  return unsupported.length > 0 ? { kind: 'invalid', unsupported: unsupported.length } : { check: args.includes('--check'), kind: 'serve' };
};

const RECOVERY_EXIT_CODES = Object.freeze({
  ok: LOCAL_SERVICE_EXIT_CODES.ok,
  'presentation-failed': LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed,
  refused: LOCAL_SERVICE_EXIT_CODES.recoveryRefused,
  throttled: LOCAL_SERVICE_EXIT_CODES.recoveryThrottled,
});

/**
 * Executa o serviço local. Sem argumentos, mantém-se em `READY` até ao pedido de encerramento;
 * com `--check`, arranca e encerra de imediato (verificação de arranque). Com `recovery rotate` ou
 * `recovery recover` (E1.07-D3-R1), arranca como instância proprietária da base — o serviço normal
 * tem de estar parado (E1.07-X) —, executa a operação interactiva e encerra.
 */
export const runLocalServiceCli = async (
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  io: LocalServiceCliIo,
  { openDatabase, protectedDirectories }: LocalServiceCliOptions,
): Promise<number> => {
  const bootstrap = createJsonLogger({ instanceId: 'bootstrap', level: 'info', sink: io.sink });
  const parsed = parseArguments(args);
  if (parsed.kind === 'invalid') {
    bootstrap.log('error', 'service.arguments_invalid', { unsupportedArguments: parsed.unsupported });
    return LOCAL_SERVICE_EXIT_CODES.invalidConfiguration;
  }
  if (parsed.kind === 'recovery' && io.terminal?.interactive !== true) {
    bootstrap.log('error', 'recovery.terminal_required', { command: parsed.command });
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
  // A recuperação nunca cria uma base: sem base existente não há nada a recuperar.
  if (parsed.kind === 'recovery') {
    config = { ...config, startupPolicy: { ...config.startupPolicy, onMissingDatabase: 'fail' } };
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

  let exitCode: number = LOCAL_SERVICE_EXIT_CODES.ok;
  if (parsed.kind === 'recovery' && io.terminal !== undefined) {
    try {
      exitCode = RECOVERY_EXIT_CODES[await runRecoveryCommand(parsed.command, service, io.terminal, logger)];
    } catch (error) {
      logger.log('error', 'recovery.interrupted', {
        causeName: error instanceof Error ? error.name : null,
        command: parsed.command,
      });
      exitCode = LOCAL_SERVICE_EXIT_CODES.recoveryRefused;
    }
  } else if (parsed.kind === 'serve' && !parsed.check) {
    logger.log('info', 'service.waiting_for_shutdown');
    const signal = await io.waitForShutdownSignal();
    logger.log('info', 'service.shutdown_requested', { signal });
  }

  try {
    await service.stop();
  } catch {
    return LOCAL_SERVICE_EXIT_CODES.startupFailed;
  }
  return exitCode;
};
