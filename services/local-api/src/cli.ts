import {
  loadLocalServiceConfigFromEnv,
  LocalServiceConfigError,
  type LocalServiceConfig,
} from './config.js';
import {
  createLocalService,
  LocalServiceStopError,
  type LocalService,
  type LocalServiceDependencies,
  type LocalServiceStopFailure,
} from './local-service.js';
import { createJsonLogger } from './logger.js';
import {
  logBestEffort,
  RECOVERY_COMMANDS,
  RecoveryTerminalError,
  runRecoveryCommand,
  type RecoveryCommand,
  type RecoveryOutcome,
  type RecoveryTerminal,
  type RecoveryTerminalFailure,
} from './recovery-cli.js';

export { RecoveryTerminalError, type RecoveryTerminal, type RecoveryTerminalFailure } from './recovery-cli.js';

export const LOCAL_SERVICE_EXIT_CODES = Object.freeze({
  ok: 0,
  startupFailed: 1,
  invalidConfiguration: 2,
  /** Recuperação ou rotação recusadas, ou falhadas antes de confirmar (E1.07-D3-R1); nada foi alterado. */
  recoveryRefused: 3,
  /** Limitação de tentativas da recuperação ou da autenticação. */
  recoveryThrottled: 4,
  /**
   * Operação confirmada, mas o novo código não foi entregue ou não foi confirmado pelo titular
   * (incluindo cancelamento, fim da entrada ou erro do terminal durante a confirmação, e falha de
   * todos os canais depois do *commit*): é necessário emitir outro com `recovery rotate` autenticado,
   * logo que possível; a rotação nunca é automática. Prevalece sobre 10 e 0 (E1.07-D3-R1-C3).
   */
  recoveryPresentationFailed: 5,
  /** E1.07-D3-R1-C1: Ctrl+C durante a introdução de dados; nada foi alterado. */
  recoveryCancelled: 6,
  /** E1.07-D3-R1-C1: a entrada terminou (Ctrl+D, Ctrl+Z, *stream* fechada) antes de concluída; nada foi alterado. */
  recoveryInputEnded: 7,
  /** E1.07-D3-R1-C1: erro de leitura ou de escrita do terminal durante a introdução de dados; nada foi alterado. */
  recoveryTerminalFailed: 8,
  /** E1.07-D3-R1-C1: tecla ou sequência não suportada (setas, Delete, Tab, Esc…); entrada anulada, nada foi alterado. */
  recoveryInputRejected: 9,
  /**
   * E1.07-D3-R1-C3 (RV-C2M-01): operação confirmada e código entregue e confirmado pelo titular, mas
   * a finalização ficou incompleta — falhou um registo, a mensagem final ou o encerramento do
   * serviço. Não houve *rollback* nem repetição; o código confirmado é o activo e **não** deve ser
   * substituído por causa desta falha. Nunca usado se a entrega do código for incerta (então 5).
   */
  recoveryCommittedIncomplete: 10,
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

const RECOVERY_EXIT_CODES: Readonly<Record<RecoveryOutcome, number>> = Object.freeze({
  'committed-incomplete': LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete,
  ok: LOCAL_SERVICE_EXIT_CODES.ok,
  'presentation-failed': LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed,
  refused: LOCAL_SERVICE_EXIT_CODES.recoveryRefused,
  throttled: LOCAL_SERVICE_EXIT_CODES.recoveryThrottled,
});

/** Desfechos que só existem depois do *commit* da operação (E1.07-D3-R1-C2/C3). */
const COMMITTED_OUTCOMES: ReadonlySet<RecoveryOutcome> = new Set(['ok', 'committed-incomplete', 'presentation-failed']);

/** Resultado do encerramento do serviço, separado do resultado da operação (E1.07-D3-R1-C3). */
type ServiceStopResult = 'stopped' | LocalServiceStopFailure | 'unexpected';

const stopService = async (service: LocalService): Promise<ServiceStopResult> => {
  try {
    await service.stop();
    return 'stopped';
  } catch (error) {
    // O próprio serviço registou a falha quando o registo estava disponível; aqui só se classifica.
    return error instanceof LocalServiceStopError ? error.reason : 'unexpected';
  }
};

/** Código confirmado activo, por comando, no aviso da saída 10 (nunca contém o código). */
const COMMITTED_INCOMPLETE_STATE: Readonly<Record<RecoveryCommand, string>> = Object.freeze({
  recover:
    'A credencial do administrador inicial FOI substituída (use a NOVA palavra-passe) e o novo código de recuperação que confirmou é o código activo: guarde-o.',
  rotate: 'O novo código de recuperação FOI emitido e o código que confirmou é o código activo: guarde-o.',
});

const STOP_DETAILS: Readonly<Record<Exclude<ServiceStopResult, 'stopped'>, string>> = Object.freeze({
  'record-failed': 'o serviço parou e libertou a base, mas o registo do encerramento falhou',
  'release-failed': 'o encerramento do serviço não confirmou a libertação da base; ela fica livre quando este processo terminar',
  unexpected: 'o encerramento do serviço falhou; a base fica livre quando este processo terminar',
});

const committedIncompleteMessage = (command: RecoveryCommand, outcome: RecoveryOutcome, stop: ServiceStopResult): string => {
  const details = [
    ...(outcome === 'committed-incomplete' ? ['o registo da operação ou a mensagem de confirmação não foram escritos'] : []),
    ...(stop === 'stopped' ? [] : [STOP_DETAILS[stop]]),
  ];
  return `\nAtenção: ${COMMITTED_INCOMPLETE_STATE[command]} A finalização ficou incompleta (${details.join('; ')}). A operação não foi revertida nem repetida e não é necessário emitir outro código por causa deste aviso.\n`;
};

/** Leituras interrompidas ANTES de qualquer operação (as da confirmação são tratadas na apresentação). */
const TERMINAL_FAILURES: Readonly<Record<RecoveryTerminalFailure, { readonly exitCode: number; readonly message: string }>> =
  Object.freeze({
    'end-of-input': {
      exitCode: LOCAL_SERVICE_EXIT_CODES.recoveryInputEnded,
      message: 'A entrada terminou antes de concluída. Nada foi alterado.',
    },
    interrupted: { exitCode: LOCAL_SERVICE_EXIT_CODES.recoveryCancelled, message: 'Operação cancelada. Nada foi alterado.' },
    'terminal-error': { exitCode: LOCAL_SERVICE_EXIT_CODES.recoveryTerminalFailed, message: 'Erro do terminal. Nada foi alterado.' },
    'unsupported-key': {
      exitCode: LOCAL_SERVICE_EXIT_CODES.recoveryInputRejected,
      message:
        'Tecla não suportada (setas, Home, End, Delete, Tab, Esc ou combinações com Ctrl/Alt): a entrada foi anulada e nada foi alterado. Escreva só os caracteres e use o retrocesso para corrigir.',
    },
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
    // Nada foi executado: 1 tanto se o encerramento concluir como se falhar (a libertação é sempre tentada).
    await stopService(service);
    return LOCAL_SERVICE_EXIT_CODES.startupFailed;
  }

  let exitCode: number = LOCAL_SERVICE_EXIT_CODES.ok;
  let committedOutcome: RecoveryOutcome | undefined;
  if (parsed.kind === 'recovery' && io.terminal !== undefined) {
    try {
      const outcome = await runRecoveryCommand(parsed.command, service, io.terminal, logger);
      if (COMMITTED_OUTCOMES.has(outcome)) committedOutcome = outcome;
      exitCode = RECOVERY_EXIT_CODES[outcome];
    } catch (error) {
      // `runRecoveryCommand` só rejeita antes do commit: aqui "nada foi alterado" é exacto. Os registos
      // são de melhor esforço para que o serviço seja sempre parado e a base libertada.
      if (error instanceof RecoveryTerminalError) {
        const { exitCode: terminalExitCode, message } = TERMINAL_FAILURES[error.failure];
        logBestEffort(logger, 'warn', 'recovery.input_aborted', { command: parsed.command, terminalFailure: error.failure });
        try {
          io.terminal.write(`${message}\n`);
        } catch {
          // Terminal indisponível: o código de saída já indica a causa.
        }
        exitCode = terminalExitCode;
      } else {
        // Falha inesperada antes da confirmação: as transacções são atómicas, nada foi alterado.
        logBestEffort(logger, 'error', 'recovery.failed', {
          causeName: error instanceof Error ? error.name : null,
          command: parsed.command,
        });
        exitCode = LOCAL_SERVICE_EXIT_CODES.recoveryRefused;
      }
    }
  } else if (parsed.kind === 'serve' && !parsed.check) {
    logger.log('info', 'service.waiting_for_shutdown');
    const signal = await io.waitForShutdownSignal();
    logger.log('info', 'service.shutdown_requested', { signal });
  }

  // O encerramento corre sempre, e o seu resultado é avaliado à parte do resultado da operação.
  const stop = await stopService(service);
  if (committedOutcome === undefined || parsed.kind !== 'recovery') {
    return stop === 'stopped' ? exitCode : LOCAL_SERVICE_EXIT_CODES.startupFailed;
  }
  // Depois do commit, 1 diria "base inalterada" (RV-C1M-01). Precedência: 5 > 10 > 0 (E1.07-D3-R1-C3).
  if (committedOutcome === 'presentation-failed') return LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed;
  if (committedOutcome === 'ok' && stop === 'stopped') return LOCAL_SERVICE_EXIT_CODES.ok;
  logBestEffort(logger, 'warn', 'recovery.finalization_incomplete', {
    command: parsed.command,
    secondaryChannels: committedOutcome === 'ok' ? 'complete' : 'incomplete',
    serviceStop: stop,
  });
  if (io.terminal !== undefined) {
    try {
      io.terminal.write(committedIncompleteMessage(parsed.command, committedOutcome, stop));
    } catch {
      // Terminal indisponível: a saída 10 comunica o desfecho.
    }
  }
  return LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete;
};
