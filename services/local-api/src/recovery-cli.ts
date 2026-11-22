import type { RecoveryCodePresentation } from './authentication/recovery-code.js';
import type { LocalService } from './local-service.js';
import type { Logger } from './logger.js';

/*
 * Interface local da recuperação do administrador inicial (E1.07-D3-R1; D-233, DP-08). Só por
 * terminal interactivo: o código e as palavras-passe nunca chegam por argumentos, variáveis de
 * ambiente nem ficheiros, e nunca são escritos nos registos (só sequências e resultados).
 */

export const RECOVERY_COMMANDS = Object.freeze(['rotate', 'recover'] as const);
export type RecoveryCommand = (typeof RECOVERY_COMMANDS)[number];

/**
 * Motivos por que uma leitura do terminal termina sem valor (E1.07-D3-R1-C1, RV-R1M-01/02):
 * - `interrupted`: Ctrl+C;
 * - `end-of-input`: fim da entrada (Ctrl+D, Ctrl+Z ou *stream* terminada/fechada);
 * - `terminal-error`: erro de leitura ou de escrita do terminal;
 * - `unsupported-key`: tecla ou sequência não suportada (setas, Delete, Tab, Esc, …); a entrada é anulada.
 */
export const RECOVERY_TERMINAL_FAILURES = Object.freeze(['interrupted', 'end-of-input', 'terminal-error', 'unsupported-key'] as const);
export type RecoveryTerminalFailure = (typeof RECOVERY_TERMINAL_FAILURES)[number];

/** Nunca transporta o que foi escrito: só o motivo. */
export class RecoveryTerminalError extends Error {
  override readonly name = 'RecoveryTerminalError';

  constructor(readonly failure: RecoveryTerminalFailure) {
    super(`Leitura do terminal terminada: ${failure}.`);
  }
}

/**
 * Terminal interactivo. `interactive` só é verdadeiro com entrada e saída TTY. As leituras resolvem
 * com o valor escrito até Enter, ou rejeitam com `RecoveryTerminalError`; nunca ficam pendentes.
 */
export interface RecoveryTerminal {
  readonly interactive: boolean;
  readLine(prompt: string): Promise<string>;
  /** Leitura sem eco. */
  readSecret(prompt: string): Promise<string>;
  write(text: string): void;
}

export type RecoveryOutcome = 'ok' | 'refused' | 'throttled' | 'presentation-failed';

/** Tentativas de confirmação do último grupo antes de terminar com aviso. */
const CONFIRMATION_ATTEMPTS = 3;

const lastDataGroup = (formatted: string): string => {
  const groups = formatted.split('-');
  return groups[groups.length - 2] ?? '';
};

const normalizeGroup = (value: string): string =>
  value.toUpperCase().replace(/\s/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

/**
 * Registo depois do *commit* (E1.07-D3-R1-C2, RV-C1M-01): melhor esforço. A operação já está
 * confirmada na base; uma falha do registo nunca pode fazê-la parecer não executada.
 */
export const logBestEffort = (logger: Logger, ...record: Parameters<Logger['log']>): void => {
  try {
    logger.log(...record);
  } catch {
    // Canal secundário: o estado confirmado continua no terminal (se existir) e no código de saída.
  }
};

/** Estado confirmado, comunicado quando o código não chega a ser apresentado (nunca contém o código). */
const UNPRESENTED_MESSAGES: Readonly<Record<RecoveryCommand, string>> = Object.freeze({
  recover:
    '\nA credencial do administrador inicial FOI substituída e as sessões dele foram revogadas, mas não foi possível apresentar o novo código de recuperação. Execute "recovery rotate" com a NOVA palavra-passe para emitir outro.\n',
  rotate:
    '\nO novo código de recuperação FOI emitido e já está activo, mas não foi possível apresentá-lo. Execute "recovery rotate" com a palavra-passe do administrador inicial para emitir outro.\n',
});

/**
 * Apresenta o código uma vez (DP-08), já depois do *commit*. Pede a confirmação do último grupo de
 * dados; uma confirmação errada volta a mostrar o código, só neste processo. Qualquer falha do
 * terminal deixa o código por apresentar: o titular conhece a palavra-passe e pode emitir outro com
 * `recovery rotate` (E1.07-D3-R1-P §5). Nunca regista o código.
 *
 * E1.07-D3-R1-C2 (RV-C1M-01): nunca rejeita. Tudo o que se escreve depois do *commit* (incluindo o
 * anúncio da credencial substituída) passa por aqui; qualquer falha resulta em `presentation-failed`
 * (saída 5), nunca numa recusa ou num "nada foi alterado".
 */
const present = async (
  presentation: RecoveryCodePresentation,
  terminal: RecoveryTerminal,
  logger: Logger,
  command: RecoveryCommand,
  announcement?: string,
): Promise<RecoveryOutcome> => {
  const sequence = presentation.sequence;
  let formatted = '';
  try {
    if (announcement !== undefined) terminal.write(announcement);
    formatted = presentation.reveal();
    const show = (): void => {
      terminal.write(
        [
          '',
          `Novo código de recuperação da instalação (n.º ${sequence}). É mostrado só agora e não volta a ser apresentado.`,
          'Guarde-o fora deste computador, em suporte físico, separado das cópias de segurança.',
          '',
          `    ${formatted}`,
          '',
          '',
        ].join('\n'),
      );
    };
    show();
    const expected = lastDataGroup(formatted);
    for (let attempt = 1; attempt <= CONFIRMATION_ATTEMPTS; attempt += 1) {
      let typed: string;
      try {
        typed = await terminal.readLine('Para confirmar que o guardou, escreva o último grupo de 4 símbolos (antes do controlo): ');
      } catch (error) {
        // Tecla não suportada: conta como confirmação falhada. Cancelamento, fim da entrada ou erro do
        // terminal terminam a apresentação: uma entrada incompleta nunca é uma confirmação.
        if (!(error instanceof RecoveryTerminalError) || error.failure !== 'unsupported-key') throw error;
        typed = '';
      }
      if (typed !== '' && normalizeGroup(typed) === expected) {
        terminal.write('Confirmado.\n');
        logBestEffort(logger, 'info', 'recovery.code_presented', { codeSequence: sequence, command, confirmed: true });
        return 'ok';
      }
      if (attempt < CONFIRMATION_ATTEMPTS) {
        terminal.write('Não coincide. O código volta a ser mostrado:\n');
        show();
      }
    }
    terminal.write(
      'A confirmação falhou. O código já está activo; se não o guardou, execute "recovery rotate" com a palavra-passe do administrador inicial para emitir outro.\n',
    );
    logBestEffort(logger, 'warn', 'recovery.code_presented', { codeSequence: sequence, command, confirmed: false });
    return 'presentation-failed';
  } catch (error) {
    // O código não é registado; só a sequência e o tipo de falha.
    logBestEffort(logger, 'error', 'recovery.presentation_failed', {
      causeName: error instanceof Error ? error.name : null,
      codeSequence: sequence,
      command,
      terminalFailure: error instanceof RecoveryTerminalError ? error.failure : null,
    });
    try {
      terminal.write(UNPRESENTED_MESSAGES[command]);
    } catch {
      // Terminal indisponível: o código de saída 5 comunica o estado confirmado.
    }
    return 'presentation-failed';
  } finally {
    // Melhor esforço: as `string` de JavaScript não podem ser apagadas da memória.
    formatted = '';
  }
};

const runRotate = async (service: LocalService, terminal: RecoveryTerminal, logger: Logger): Promise<RecoveryOutcome> => {
  terminal.write('Emissão ou rotação do código de recuperação do administrador inicial.\n');
  const username = await terminal.readLine('Nome de utilizador do administrador inicial: ');
  const password = await terminal.readSecret('Palavra-passe: ');
  const result = await service.installationRecovery.rotate(username, password);
  if (result.ok) {
    // Depois do commit: nada a partir daqui pode rejeitar (RV-C1M-01).
    logBestEffort(logger, 'info', 'recovery.code_issued', {
      codeSequence: result.code.sequence,
      command: 'rotate',
      issuedReason: result.issuedReason,
      supersededSequence: result.supersededSequence ?? null,
    });
    return present(result.code, terminal, logger, 'rotate');
  }
  if (result.reason === 'throttled') {
    terminal.write(`Demasiadas tentativas. Tente de novo dentro de ${result.retryAfterSeconds} s.\n`);
    logger.log('warn', 'recovery.refused', { command: 'rotate', outcome: 'throttled' });
    return 'throttled';
  }
  const messages: Readonly<Record<string, string>> = {
    'authentication-failed': 'Autenticação recusada.',
    'rotation-conflict': 'A credencial ou o código mudaram durante a operação. Nada foi alterado; repita a operação.',
    'rotation-refused':
      'Operação recusada: só o administrador inicial, activo e com o registo da instalação íntegro, pode emitir o código.',
  };
  terminal.write(`${messages[result.reason] ?? 'Operação recusada.'}\n`);
  logger.log('warn', 'recovery.refused', {
    cause: result.reason === 'rotation-refused' ? result.cause : null,
    command: 'rotate',
    outcome: result.reason,
  });
  return 'refused';
};

const runRecover = async (service: LocalService, terminal: RecoveryTerminal, logger: Logger): Promise<RecoveryOutcome> => {
  terminal.write('Recuperação da credencial do administrador inicial com o código de recuperação.\n');
  const code = await terminal.readSecret('Código de recuperação: ');
  const password = await terminal.readSecret('Nova palavra-passe: ');
  const confirmation = await terminal.readSecret('Confirme a nova palavra-passe: ');
  if (password !== confirmation) {
    terminal.write('As palavras-passe não coincidem. Nada foi alterado.\n');
    logger.log('warn', 'recovery.refused', { command: 'recover', outcome: 'password-mismatch' });
    return 'refused';
  }
  const result = await service.installationRecovery.recover(code, password);
  if (result.ok) {
    // Depois do commit: nada a partir daqui pode rejeitar (RV-C1M-01).
    logBestEffort(logger, 'info', 'recovery.completed', {
      codeSequence: result.code.sequence,
      command: 'recover',
      consumedSequence: result.consumedSequence,
    });
    return present(
      result.code,
      terminal,
      logger,
      'recover',
      'Credencial do administrador inicial substituída. As sessões dele foram revogadas.\n',
    );
  }
  if (result.reason === 'throttled') {
    terminal.write(`Demasiadas tentativas. Tente de novo dentro de ${result.retryAfterSeconds} s.\n`);
    logger.log('warn', 'recovery.refused', { command: 'recover', outcome: 'throttled' });
    return 'throttled';
  }
  const messages: Readonly<Record<string, string>> = {
    'invalid-recovery-code': 'Código de recuperação inválido.',
    'malformed-recovery-code': 'Código mal escrito: verifique os símbolos e o símbolo de controlo.',
    'password-rejected': 'A nova palavra-passe não cumpre a política. Nada foi alterado.',
    'recovery-conflict': 'O código ou a credencial mudaram durante a operação. Nada foi alterado; repita a operação.',
    'recovery-refused':
      'Recuperação recusada: o registo da instalação não está íntegro ou o administrador inicial não está activo. Consulte o procedimento de perda total.',
  };
  terminal.write(`${messages[result.reason] ?? 'Operação recusada.'}\n`);
  logger.log('warn', 'recovery.refused', {
    cause: result.reason === 'recovery-refused' ? result.cause : null,
    command: 'recover',
    outcome: result.reason,
    violation: result.reason === 'password-rejected' ? result.violation : null,
  });
  return 'refused';
};

/**
 * Só rejeita ANTES do *commit*: durante a leitura dos dados, ou porque a operação falhou (é atómica:
 * nada da credencial nem dos códigos fica alterado). Depois do *commit* resolve sempre, com `ok` ou
 * `presentation-failed` (E1.07-D3-R1-C2, RV-C1M-01).
 */
export const runRecoveryCommand = (
  command: RecoveryCommand,
  service: LocalService,
  terminal: RecoveryTerminal,
  logger: Logger,
): Promise<RecoveryOutcome> =>
  command === 'rotate' ? runRotate(service, terminal, logger) : runRecover(service, terminal, logger);
