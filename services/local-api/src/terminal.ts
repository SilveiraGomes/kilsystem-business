import type { RecoveryTerminal } from './recovery-cli.js';

/*
 * Terminal do processo para a recuperação (E1.07-D3-R1; D-233, DP-08). Só é interactivo quando a
 * entrada e a saída são TTY; caso contrário, a CLI recusa os subcomandos de recuperação. A leitura
 * secreta usa o modo *raw* sem eco; nada é guardado além da variável devolvida ao chamador.
 */

const ENTER = new Set(['\r', '\n']);
const BACKSPACE = new Set(['\u007f', '\b']);
const INTERRUPT = '\u0003';

export class TerminalInterruptedError extends Error {
  override readonly name = 'TerminalInterruptedError';

  constructor() {
    super('Entrada interrompida pelo utilizador.');
  }
}

export const createProcessTerminal = (
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): RecoveryTerminal => {
  // `isTTY` fica indefinido quando a entrada ou a saída são redireccionadas.
  const interactive = input.isTTY === true && output.isTTY === true;

  const ask = (prompt: string, echo: boolean): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      output.write(prompt);
      let value = '';
      const finish = (error?: Error): void => {
        input.off('data', onData);
        input.setRawMode(false);
        input.pause();
        output.write('\n');
        if (error === undefined) resolve(value);
        else reject(error);
        value = '';
      };
      const onData = (chunk: string): void => {
        for (const character of chunk) {
          if (ENTER.has(character)) {
            finish();
            return;
          }
          if (character === INTERRUPT) {
            finish(new TerminalInterruptedError());
            return;
          }
          if (BACKSPACE.has(character)) {
            if (value.length > 0) {
              value = Array.from(value).slice(0, -1).join('');
              if (echo) output.write('\b \b');
            }
          } else if (character >= ' ') {
            value += character;
            if (echo) output.write(character);
          }
        }
      };
      input.setEncoding('utf8');
      input.setRawMode(true);
      input.resume();
      input.on('data', onData);
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
