import { emitKeypressEvents, type Key } from 'node:readline';

import { RecoveryTerminalError, type RecoveryTerminal, type RecoveryTerminalFailure } from './recovery-cli.js';

/*
 * Terminal do processo para a recuperação (E1.07-D3-R1; D-233, DP-08). Só é interactivo quando a
 * entrada e a saída são TTY; caso contrário, a CLI recusa os subcomandos de recuperação. A leitura
 * secreta usa o modo *raw* sem eco; nada é guardado além da variável devolvida ao chamador.
 *
 * E1.07-D3-R1-C1 (RV-R1M-01/02): as teclas são descodificadas pelo `readline` do Node, não por um
 * analisador próprio. Como a entrada secreta não tem eco nem cursor visível, só são aceites
 * caracteres imprimíveis, o retrocesso (apaga o último carácter) e Enter. Qualquer outra tecla
 * (setas, Home, End, Delete, Insert, Tab, Esc, teclas de função, combinações com Ctrl/Alt e
 * sequências desconhecidas) anula a entrada inteira em vez de entrar no valor. Ctrl+C cancela;
 * Ctrl+D, Ctrl+Z e o fim da *stream* são fim da entrada; um erro da *stream* é erro do terminal.
 * Em todos estes casos a leitura termina (nunca fica pendente) e o modo *raw* é reposto.
 */

/** Um só ponto de código, sem caracteres de controlo (C0, DEL, C1). */
const PRINTABLE = /^[^\p{Cc}]$/u;

type Keystroke =
  | { readonly kind: 'enter' }
  | { readonly kind: 'backspace' }
  | { readonly kind: 'character'; readonly value: string }
  | { readonly kind: 'failure'; readonly failure: RecoveryTerminalFailure };

const classifyKeystroke =(text: string | undefined, key: Key | undefined): Keystroke => {
  const ctrl = key?.ctrl === true;
  const meta = key?.meta === true;
  if (ctrl && key?.name === 'c') return { failure: 'interrupted', kind: 'failure' };
  if (ctrl && (key?.name === 'd' || key?.name === 'z')) return { failure: 'end-of-input', kind: 'failure' };
  if (!ctrl && !meta) {
    if (key?.name === 'return' || key?.name === 'enter') return { kind: 'enter' };
    if (key?.name === 'backspace') return { kind: 'backspace' };
    if (text !== undefined && PRINTABLE.test(text)) return { kind: 'character', value: text };
  }
  return { failure: 'unsupported-key', kind: 'failure' };
};

export const createProcessTerminal = (
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): RecoveryTerminal => {
  // `isTTY` fica indefinido quando a entrada ou a saída são redireccionadas.
  const interactive = input.isTTY === true && output.isTTY === true;

  // Estado da *stream*, persistente entre leituras: depois do fim ou de um erro, nenhuma leitura espera.
  let streamFailure: RecoveryTerminalFailure | undefined;
  let abortActiveRead: ((failure: RecoveryTerminalFailure) => void) | undefined;
  let watching = false;
  const streamEnded = (): void => {
    streamFailure ??= 'end-of-input';
    abortActiveRead?.(streamFailure);
  };
  const streamErrored = (): void => {
    streamFailure = 'terminal-error';
    abortActiveRead?.('terminal-error');
  };
  /** Só na primeira leitura: o serviço normal (sem recuperação) não muda de comportamento. */
  const watchStreams = (): void => {
    if (watching) return;
    watching = true;
    emitKeypressEvents(input);
    input.on('end', streamEnded);
    input.on('close', streamEnded);
    input.on('error', streamErrored);
    output.on('error', streamErrored);
  };

  const ask = (prompt: string, echo: boolean): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      watchStreams();
      if (streamFailure === undefined && (input.readableEnded || input.destroyed)) streamFailure = 'end-of-input';
      if (streamFailure !== undefined) {
        reject(new RecoveryTerminalError(streamFailure));
        return;
      }
      let value = '';
      let settled = false;
      const settle = (failure?: RecoveryTerminalFailure): void => {
        if (settled) return;
        settled = true;
        abortActiveRead = undefined;
        input.off('keypress', onKeypress);
        try {
          input.setRawMode(false);
        } catch {
          // Terminal já fechado: não há modo a repor.
        }
        input.pause();
        // Depois de `pause()`, a *stream* pode voltar a pedir leitura ao sistema (enche o *buffer*); sem
        // `unref()`, essa leitura pendente mantinha o processo vivo depois de o comando terminar.
        input.unref();
        const result = value;
        value = '';
        try {
          output.write('\n');
        } catch {
          // A saída pode já não existir; o resultado não depende dela.
        }
        if (failure === undefined) resolve(result);
        else reject(new RecoveryTerminalError(failure));
      };
      const onKeypress = (text: string | undefined, key: Key | undefined): void => {
        if (settled) return;
        const keystroke = classifyKeystroke(text, key);
        switch (keystroke.kind) {
          case 'enter':
            settle();
            return;
          case 'failure':
            settle(keystroke.failure);
            return;
          case 'backspace':
            if (value.length > 0) {
              value = Array.from(value).slice(0, -1).join('');
              if (echo) output.write('\b \b');
            }
            return;
          case 'character':
            value += keystroke.value;
            if (echo) output.write(keystroke.value);
            return;
        }
      };
      abortActiveRead = settle;
      try {
        output.write(prompt);
        input.ref();
        input.setRawMode(true);
        input.on('keypress', onKeypress);
        input.resume();
      } catch {
        settle('terminal-error');
      }
    });

  return Object.freeze({
    interactive,
    readLine: (prompt: string) => ask(prompt, true),
    readSecret: (prompt: string) => ask(prompt, false),
    write: (text: string) => {
      output.write(text);
    },
  });
};
