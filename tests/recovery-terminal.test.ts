import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { RecoveryTerminalError, type RecoveryTerminalFailure } from '../services/local-api/src/recovery-cli';
import { createProcessTerminal } from '../services/local-api/src/terminal';

/*
 * E1.07-D3-R1-C1 — terminal da CLI de recuperação (RV-R1M-01, RV-R1M-02). Ensaios com *streams*
 * simuladas que se declaram TTY: não substituem a validação numa consola física do Windows (PD-85).
 */

const SECRET = 'segredo-fictício';

const fakeTty = (options: { readonly rawModeFailsOnReset?: boolean } = {}) => {
  const input = new PassThrough();
  const rawModes: boolean[] = [];
  const refs: ('ref' | 'unref')[] = [];
  Object.assign(input, {
    isTTY: true,
    ref: () => {
      refs.push('ref');
      return input;
    },
    unref: () => {
      refs.push('unref');
      return input;
    },
    setRawMode: (mode: boolean) => {
      rawModes.push(mode);
      if (!mode && options.rawModeFailsOnReset === true) throw new Error('EBADF: terminal fechado');
      return input;
    },
  });
  const written: string[] = [];
  const output = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      written.push(String(chunk));
      callback();
    },
  });
  Object.assign(output, { isTTY: true });
  const terminal = createProcessTerminal(input as unknown as NodeJS.ReadStream, output as unknown as NodeJS.WriteStream);
  return {
    input,
    output,
    rawModes,
    refs,
    terminal,
    type: (text: string) => input.write(text),
    shown: () => written.join(''),
  };
};

type Tty = ReturnType<typeof fakeTty>;

/**
 * Depois de cada leitura terminada: modo *raw* reposto, *stream* parada e sem referência (não mantém
 * o processo vivo), nenhum ouvinte de teclas.
 */
const expectReleased = (tty: Tty): void => {
  expect(tty.rawModes.at(-1)).toBe(false);
  expect(tty.input.isPaused()).toBe(true);
  expect(tty.refs.at(-1)).toBe('unref');
  expect(tty.input.listenerCount('keypress')).toBe(0);
};

const expectFailure = async (read: Promise<string>, failure: RecoveryTerminalFailure): Promise<RecoveryTerminalError> => {
  const error: unknown = await read.then(
    () => undefined,
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(RecoveryTerminalError);
  if (!(error instanceof RecoveryTerminalError)) throw new Error('RecoveryTerminalError esperado.');
  expect(error.failure).toBe(failure);
  // O erro nunca transporta o que foi escrito.
  expect(`${error.message} ${error.stack ?? ''} ${JSON.stringify(error)}`).not.toContain('segredo');
  return error;
};

const UNSUPPORTED_KEYS: readonly (readonly [string, string])[] = [
  ['seta esquerda (CSI)', '\u001b[D'],
  ['seta direita (CSI)', '\u001b[C'],
  ['seta acima (CSI)', '\u001b[A'],
  ['seta abaixo (CSI)', '\u001b[B'],
  ['seta esquerda (SS3)', '\u001bOD'],
  ['Home (CSI H)', '\u001b[H'],
  ['Home (CSI 1~)', '\u001b[1~'],
  ['End (CSI F)', '\u001b[F'],
  ['End (CSI 4~)', '\u001b[4~'],
  ['Delete', '\u001b[3~'],
  ['Insert', '\u001b[2~'],
  ['Page Up', '\u001b[5~'],
  ['F5', '\u001b[15~'],
  ['Tab', '\t'],
  ['Esc seguido de Enter', '\u001b\r'],
  ['Alt+x', '\u001bx'],
  ['Ctrl+A', '\u0001'],
  ['Ctrl+U', '\u0015'],
  ['sequência CSI desconhecida', '\u001b[99Z'],
  ['início de colagem delimitada', '\u001b[200~'],
  ['controlo C1 (NEL)', '\u0085'],
];

describe('E1.07-D3-R1-C1 recovery CLI terminal', () => {
  it('[T-01] reads a secret without echo and releases the terminal after Enter', async () => {
    const tty = fakeTty();
    const read = tty.terminal.readSecret('Palavra-passe: ');
    tty.type(`${SECRET}\r`);
    await expect(read).resolves.toBe(SECRET);
    expect(tty.shown()).toBe('Palavra-passe: \n');
    expect(tty.rawModes).toEqual([true, false]);
    expectReleased(tty);
  });

  it('[T-02] echoes visible lines and the backspace erasure', async () => {
    const tty = fakeTty();
    const read = tty.terminal.readLine('Grupo: ');
    tty.type('abX\u007fc\r');
    await expect(read).resolves.toBe('abc');
    expect(tty.shown()).toBe('Grupo: abX\b \bc\n');
    expectReleased(tty);
  });

  it('[T-03] Backspace (DEL and BS) erases whole code points; accents and emoji are content', async () => {
    const tty = fakeTty();
    const first = tty.terminal.readSecret('> ');
    tty.type('\u007f\bfictícia😀\u007fX\bY\r');
    await expect(first).resolves.toBe('fictíciaY');
    const second = tty.terminal.readSecret('> ');
    tty.type('é😀\r');
    await expect(second).resolves.toBe('é😀');
    expectReleased(tty);
  });

  it('[T-04] Enter as CR, LF or CR LF ends the line once; the next read starts clean', async () => {
    const tty = fakeTty();
    const first = tty.terminal.readSecret('> ');
    tty.type('um\r\n');
    await expect(first).resolves.toBe('um');
    const second = tty.terminal.readSecret('> ');
    tty.type('dois\n');
    await expect(second).resolves.toBe('dois');
    const third = tty.terminal.readLine('> ');
    tty.type('\r');
    await expect(third).resolves.toBe('');
    expectReleased(tty);
  });

  it.each(UNSUPPORTED_KEYS)('[T-05] %s cancels the entry instead of entering the value', async (_name, sequence) => {
    for (const read of ['readSecret', 'readLine'] as const) {
      const tty = fakeTty();
      const pending = tty.terminal[read]('> ');
      tty.type(`${SECRET}${sequence}x\r`);
      await expectFailure(pending, 'unsupported-key');
      expectReleased(tty);
      // Nada do que foi escrito antes ou depois da tecla é devolvido nem ecoado na entrada secreta.
      if (read === 'readSecret') expect(tty.shown()).toBe('> \n');
    }
  });

  it('[T-06] Ctrl+C interrupts the read and restores the terminal', async () => {
    const tty = fakeTty();
    const read = tty.terminal.readSecret('> ');
    tty.type(`${SECRET}\u0003`);
    await expectFailure(read, 'interrupted');
    expectReleased(tty);
  });

  it('[T-07] EOF (stream end, Ctrl+D, Ctrl+Z) ends the read instead of leaving it pending', async () => {
    const ended = fakeTty();
    const read = ended.terminal.readSecret('> ');
    ended.type(SECRET);
    ended.input.end();
    await expectFailure(read, 'end-of-input');
    expectReleased(ended);
    // Depois do fim, nenhuma leitura espera.
    await expectFailure(ended.terminal.readLine('> '), 'end-of-input');

    for (const control of ['\u0004', '\u001a']) {
      const tty = fakeTty();
      const pending = tty.terminal.readLine('> ');
      tty.type(`ABCD${control}`);
      await expectFailure(pending, 'end-of-input');
      expectReleased(tty);
    }

    const closedBefore = fakeTty();
    closedBefore.input.destroy();
    await expectFailure(closedBefore.terminal.readSecret('> '), 'end-of-input');
  });

  it('[T-08] a read error of the input or the output fails the read without leaking the cause', async () => {
    const tty = fakeTty();
    const read = tty.terminal.readSecret('> ');
    tty.type('segredo parcial');
    await new Promise((resolve) => setImmediate(resolve));
    tty.input.destroy(new Error('EIO: segredo no detalhe'));
    await expectFailure(read, 'terminal-error');
    expectReleased(tty);
    await expectFailure(tty.terminal.readSecret('> '), 'terminal-error');

    const output = fakeTty();
    const pending = output.terminal.readLine('> ');
    output.output.emit('error', new Error('EPIPE'));
    await expectFailure(pending, 'terminal-error');
    expectReleased(output);
  });

  it('[T-09] an error between reads is not an uncaught exception and fails the next read', async () => {
    const tty = fakeTty();
    const first = tty.terminal.readLine('> ');
    tty.type('ok\r');
    await expect(first).resolves.toBe('ok');
    tty.input.emit('error', new Error('EIO'));
    await expectFailure(tty.terminal.readSecret('> '), 'terminal-error');
  });

  it('[T-10] a terminal that cannot leave raw mode still reports the real cause', async () => {
    const tty = fakeTty({ rawModeFailsOnReset: true });
    const read = tty.terminal.readSecret('> ');
    tty.type('\u0003');
    await expectFailure(read, 'interrupted');
    expect(tty.input.listenerCount('keypress')).toBe(0);
  });

  it('[T-11] is interactive only when both input and output are TTY', () => {
    const tty = fakeTty();
    expect(tty.terminal.interactive).toBe(true);
    const plainInput = new PassThrough();
    expect(createProcessTerminal(plainInput as unknown as NodeJS.ReadStream, tty.output as unknown as NodeJS.WriteStream).interactive).toBe(false);
    const plainOutput = new PassThrough();
    expect(createProcessTerminal(tty.input as unknown as NodeJS.ReadStream, plainOutput as unknown as NodeJS.WriteStream).interactive).toBe(false);
  });
});
