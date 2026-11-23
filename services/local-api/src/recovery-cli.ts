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

/**
 * Desfechos (E1.07-D3-R1-C3): `refused`/`throttled` antes do *commit*; depois do *commit*,
 * `presentation-failed` (código não entregue ou não confirmado), `committed-incomplete` (código
 * entregue e confirmado pelo titular, mas um canal secundário — registo ou mensagem — falhou) e
 * `ok` (tudo concluído). Precedência: `presentation-failed` > `committed-incomplete` > `ok`.
 */
export type RecoveryOutcome = 'ok' | 'refused' | 'throttled' | 'presentation-failed' | 'committed-incomplete';

/** Tentativas de confirmação do último grupo antes de terminar com aviso. */
const CONFIRMATION_ATTEMPTS = 3;

const lastDataGroup = (formatted: string): string => {
  const groups = formatted.split('-');
  return groups[groups.length - 2] ?? '';
};

const normalizeGroup = (value: string): string =>
  value.toUpperCase().replace(/\s/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

/**
 * Registo de melhor esforço (E1.07-D3-R1-C2, RV-C1M-01): nunca lança. Devolve se o registo foi
 * escrito (E1.07-D3-R1-C3, RV-C2M-01): depois do *commit*, uma falha não faz a operação parecer não
 * executada, mas impede o desfecho de sucesso completo (`committed-incomplete`, saída 10).
 * O *sink* tem de ser síncrono: uma rejeição assíncrona não seria apanhada (RV-C2M-03).
 */
export const logBestEffort = (logger: Logger, ...record: Parameters<Logger['log']>): boolean => {
  try {
    logger.log(...record);
    return true;
  } catch {
    // Canal secundário: o estado confirmado continua no terminal (se existir) e no código de saída.
    return false;
  }
};

/** Até onde chegou a entrega do código quando não houve confirmação (E1.07-D3-R1-C3, RV-C2M-02). */
export type RecoveryPresentationGap = 'not-presented' | 'partially-presented' | 'presented-unconfirmed';

/**
 * Estado confirmado e falta de entrega, por comando e por fase, comunicados quando o código não foi
 * entregue ou confirmado. Nunca contêm o código e nunca dizem "nada foi alterado": a operação está
 * confirmada. A rotação é recomendada, nunca executada automaticamente.
 */
const UNDELIVERED_STATE: Readonly<Record<RecoveryCommand, Readonly<Record<RecoveryPresentationGap, string>>>> = Object.freeze({
  recover: Object.freeze({
    'not-presented':
      'A credencial do administrador inicial FOI substituída e as sessões dele foram revogadas, mas o novo código de recuperação não foi apresentado.',
    'partially-presented':
      'A credencial do administrador inicial FOI substituída e as sessões dele foram revogadas, mas a apresentação do novo código de recuperação falhou e pode ter ficado incompleta no ecrã.',
    'presented-unconfirmed':
      'A credencial do administrador inicial FOI substituída e as sessões dele foram revogadas, e o novo código de recuperação foi apresentado, mas não foi confirmado que ficou guardado.',
  }),
  rotate: Object.freeze({
    'not-presented': 'O novo código de recuperação FOI emitido e já está activo, mas não foi apresentado.',
    'partially-presented':
      'O novo código de recuperação FOI emitido e já está activo, mas a apresentação falhou e pode ter ficado incompleta no ecrã.',
    'presented-unconfirmed':
      'O novo código de recuperação FOI emitido, já está activo e foi apresentado, mas não foi confirmado que ficou guardado.',
  }),
});

const ROTATION_GUIDANCE: Readonly<Record<RecoveryCommand, string>> = Object.freeze({
  recover:
    'É necessário emitir outro: logo que possível, execute "recovery rotate" com a NOVA palavra-passe e guarde o código que for apresentado.',
  rotate:
    'É necessário emitir outro: logo que possível, execute "recovery rotate" com a palavra-passe do administrador inicial e guarde o código que for apresentado.',
});

export const undeliveredMessage = (command: RecoveryCommand, gap: RecoveryPresentationGap): string =>
  `\n${UNDELIVERED_STATE[command][gap]} ${ROTATION_GUIDANCE[command]}\n`;

/**
 * Apresenta o código uma vez (DP-08), já depois do *commit*. Pede a confirmação do último grupo de
 * dados; uma confirmação errada volta a mostrar o código, só neste processo. Qualquer falha do
 * terminal deixa o código por apresentar: o titular conhece a palavra-passe e pode emitir outro com
 * `recovery rotate` (E1.07-D3-R1-P §5). Nunca regista o código.
 *
 * E1.07-D3-R1-C2 (RV-C1M-01): nunca rejeita. Tudo o que se escreve depois do *commit* (incluindo o
 * anúncio da credencial substituída) passa por aqui; nenhuma falha resulta numa recusa ou num
 * "nada foi alterado".
 *
 * E1.07-D3-R1-C3 (RV-C2M-01/02/07): o desfecho distingue a entrega do código das falhas
 * secundárias. Sem confirmação do titular → `presentation-failed` (5), com a mensagem da fase
 * atingida. Com a confirmação do titular, uma falha da mensagem "Confirmado." ou do registo
 * `recovery.code_presented` dá `committed-incomplete` (10): o código foi entregue e confirmado e não
 * deve ser substituído por causa dessa falha.
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
  // Fase da entrega: `displaying` durante a escrita do código; `displayed` depois de uma escrita completa.
  let displaying = false;
  let displayed = false;
  let failure: unknown;
  try {
    if (announcement !== undefined) terminal.write(announcement);
    formatted = presentation.reveal();
    const show = (): void => {
      displaying = true;
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
      displaying = false;
      displayed = true;
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
        // Confirmado pelo titular: daqui em diante só há canais secundários.
        let complete = true;
        try {
          terminal.write('Confirmado.\n');
        } catch {
          complete = false;
        }
        const recorded = logBestEffort(logger, 'info', 'recovery.code_presented', {
          codeSequence: sequence,
          command,
          confirmed: true,
        });
        return complete && recorded ? 'ok' : 'committed-incomplete';
      }
      if (attempt < CONFIRMATION_ATTEMPTS) {
        terminal.write('Não coincide. O código volta a ser mostrado:\n');
        show();
      }
    }
  } catch (error) {
    failure = error;
  } finally {
    // Melhor esforço: as `string` de JavaScript não podem ser apagadas da memória.
    formatted = '';
  }

  const gap: RecoveryPresentationGap = displayed ? 'presented-unconfirmed' : displaying ? 'partially-presented' : 'not-presented';
  // O código não é registado; só a sequência, a fase e o tipo de falha.
  if (failure === undefined) {
    logBestEffort(logger, 'warn', 'recovery.code_presented', { codeSequence: sequence, command, confirmed: false, presentation: gap });
  } else {
    logBestEffort(logger, 'error', 'recovery.presentation_failed', {
      causeName: failure instanceof Error ? failure.name : null,
      codeSequence: sequence,
      command,
      presentation: gap,
      terminalFailure: failure instanceof RecoveryTerminalError ? failure.failure : null,
    });
  }
  try {
    terminal.write(`${failure === undefined ? '\nA confirmação falhou.' : ''}${undeliveredMessage(command, gap)}`);
  } catch {
    // Terminal indisponível: o código de saída 5 comunica o estado confirmado.
  }
  return 'presentation-failed';
};

/** Um registo falhado depois do *commit* impede o sucesso completo, nunca a entrega já confirmada. */
const withRecord = (outcome: RecoveryOutcome, recorded: boolean): RecoveryOutcome =>
  outcome === 'ok' && !recorded ? 'committed-incomplete' : outcome;

const runRotate = async (service: LocalService, terminal: RecoveryTerminal, logger: Logger): Promise<RecoveryOutcome> => {
  terminal.write('Emissão ou rotação do código de recuperação do administrador inicial.\n');
  const username = await terminal.readLine('Nome de utilizador do administrador inicial: ');
  const password = await terminal.readSecret('Palavra-passe: ');
  const result = await service.installationRecovery.rotate(username, password);
  if (result.ok) {
    // Depois do commit: nada a partir daqui pode rejeitar (RV-C1M-01).
    const recorded = logBestEffort(logger, 'info', 'recovery.code_issued', {
      codeSequence: result.code.sequence,
      command: 'rotate',
      issuedReason: result.issuedReason,
      supersededSequence: result.supersededSequence ?? null,
    });
    return withRecord(await present(result.code, terminal, logger, 'rotate'), recorded);
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
    const recorded = logBestEffort(logger, 'info', 'recovery.completed', {
      codeSequence: result.code.sequence,
      command: 'recover',
      consumedSequence: result.consumedSequence,
    });
    const outcome = await present(
      result.code,
      terminal,
      logger,
      'recover',
      'Credencial do administrador inicial substituída. As sessões dele foram revogadas.\n',
    );
    return withRecord(outcome, recorded);
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
 * nada da credencial nem dos códigos fica alterado). Depois do *commit* resolve sempre, com `ok`,
 * `committed-incomplete` ou `presentation-failed` (E1.07-D3-R1-C2, RV-C1M-01; E1.07-D3-R1-C3).
 */
export const runRecoveryCommand = (
  command: RecoveryCommand,
  service: LocalService,
  terminal: RecoveryTerminal,
  logger: Logger,
): Promise<RecoveryOutcome> =>
  command === 'rotate' ? runRotate(service, terminal, logger) : runRecover(service, terminal, logger);
