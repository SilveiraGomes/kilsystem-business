import { writeSync } from 'node:fs';
import { Writable } from 'node:stream';

import { RecoveryTerminalError } from '../../../services/local-api/src/recovery-cli';
import { createProcessTerminal } from '../../../services/local-api/src/terminal';

/*
 * Processo filho real dos ensaios do terminal da recuperação (E1.07-D3-R1-C2: RV-C1M-02 e OM-04).
 * A entrada é a `process.stdin` verdadeira deste processo (um *pipe*); só o modo *raw* é simulado,
 * porque um *pipe* não o tem. Os eventos vão para o descritor 2 e os *prompts* para o descritor 1,
 * sempre com escritas síncronas: nenhuma escrita pendente mantém o processo vivo, por isso só a
 * entrada decide se o ciclo de eventos continua.
 */

type Report = Readonly<Record<string, string | number | boolean | null>>;

const report = (event: Report): void => {
  writeSync(2, `${JSON.stringify(event)}\n`);
};

let finished = false;
// Ciclo de eventos vazio antes do fim do ensaio: o processo ia terminar com uma leitura por concluir.
process.on('beforeExit', () => {
  if (finished) return;
  finished = true;
  report({ event: 'loop-empty' });
  process.exitCode = 70;
});

const input = process.stdin;
Object.assign(input, {
  setRawMode: (mode: boolean) => {
    report({ event: 'raw', mode });
    return input;
  },
});
const output = new Writable({
  write(chunk: Buffer | string, _encoding, callback) {
    if (typeof chunk === 'string') writeSync(1, chunk);
    else writeSync(1, chunk);
    callback();
  },
});
const terminal = (): ReturnType<typeof createProcessTerminal> =>
  createProcessTerminal(input, output as unknown as NodeJS.WriteStream);
const failureOf = (error: unknown): string => (error instanceof RecoveryTerminalError ? error.failure : 'unexpected');

const mode = process.argv[2];
if (mode === 'two-reads') {
  const reader = terminal();
  const first = reader.readLine('primeiro> ');
  report({ event: 'reading', read: 1 });
  report({ event: 'value', read: 1, value: await first });
  const second = reader.readSecret('segundo> ');
  // Barreira: corre no fim desta volta do ciclo de eventos. Sem a referência da entrada, o ciclo fica
  // vazio logo a seguir e o processo termina antes de o pai enviar a segunda resposta.
  setImmediate(() => {
    report({ event: 'reading', read: 2 });
  });
  report({ event: 'value', length: (await second).length, read: 2 });
  finished = true;
} else if (mode === 'ended-before-read') {
  // A entrada termina e fecha antes de existir o terminal: o fim já foi emitido quando a leitura começa.
  await new Promise<void>((resolve) => {
    input.once('close', resolve);
    input.resume();
  });
  report({ destroyed: input.destroyed, ended: input.readableEnded, event: 'closed' });
  try {
    await terminal().readLine('depois> ');
    report({ event: 'value' });
  } catch (error) {
    report({ event: 'rejected', failure: failureOf(error) });
  }
  finished = true;
} else {
  report({ event: 'unknown-mode' });
  finished = true;
  process.exitCode = 2;
}
