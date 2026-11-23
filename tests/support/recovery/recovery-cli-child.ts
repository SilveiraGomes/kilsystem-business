import { writeSync } from 'node:fs';
import { Writable } from 'node:stream';

import { openSqliteDatabase } from '../../../packages/database/src/index';
import { runLocalServiceCli } from '../../../services/local-api/src/cli';
import type { RecoveryTerminal } from '../../../services/local-api/src/recovery-cli';
import { createProcessTerminal } from '../../../services/local-api/src/terminal';

/*
 * Processo filho real da CLI de recuperação (E1.07-D3-R1-C3, RV-C2M-01/03). Corre
 * `runLocalServiceCli` com o terminal real (`createProcessTerminal`) sobre a `process.stdin`
 * verdadeira deste processo (um *pipe*); só o modo *raw* e a marca `interactive` são simulados,
 * porque um *pipe* não os tem. As falhas são injectadas apenas no *sink* do registo e nas escritas
 * do terminal. Os *prompts* e o terminal vão para o descritor 1; os registos e as sondas do ensaio
 * para o descritor 2, sempre com escritas síncronas. O processo nunca chama `process.exit`: tem de
 * terminar sozinho. Só dados fictícios.
 */

export interface RecoveryCliChildOptions {
  readonly args: readonly string[];
  readonly databasePath: string;
  /** Registos que lançam (por subcadeia da linha JSON). */
  readonly failLog: readonly string[];
  /** Depois do *commit*, falham todas as escritas do terminal e todos os registos. */
  readonly silentAfterCommit: boolean;
}

const options = JSON.parse(process.env['KIL_RECOVERY_CLI_CHILD'] ?? '{}') as RecoveryCliChildOptions;

const report = (event: Readonly<Record<string, unknown>>): void => {
  writeSync(2, `${JSON.stringify(event)}\n`);
};

let finished = false;
// Ciclo de eventos vazio antes do fim da CLI: o processo ia terminar com trabalho por concluir.
process.on('beforeExit', () => {
  if (finished) return;
  finished = true;
  report({ probe: 'loop-empty' });
  process.exitCode = 70;
});

const COMMIT_MARKERS = ['"recovery.code_issued"', '"recovery.completed"'];
let committed = false;

const input = process.stdin;
Object.assign(input, { setRawMode: () => input });
const output = new Writable({
  write(chunk: Buffer | string, _encoding, callback) {
    if (typeof chunk === 'string') writeSync(1, chunk);
    else writeSync(1, chunk);
    callback();
  },
});
const real = createProcessTerminal(input, output as unknown as NodeJS.WriteStream);
const terminal: RecoveryTerminal = {
  interactive: true,
  readLine: (prompt) => real.readLine(prompt),
  readSecret: (prompt) => real.readSecret(prompt),
  write: (text) => {
    if (options.silentAfterCommit && committed) throw new Error('terminal indisponível');
    real.write(text);
  },
};

const sink = (line: string): void => {
  if (COMMIT_MARKERS.some((marker) => line.includes(marker))) committed = true;
  if ((options.silentAfterCommit && committed) || options.failLog.some((marker) => line.includes(marker))) {
    throw new Error('registo indisponível');
  }
  writeSync(2, `${line}\n`);
};

/** Na mesma execução: uma ligação nova obtém de imediato a posse exclusiva (ninguém detém a base). */
const reopensExclusively = (): boolean => {
  try {
    openSqliteDatabase({ busyTimeoutMs: 0, exclusive: true, fileMustExist: true, filename: options.databasePath }).close();
    return true;
  } catch {
    return false;
  }
};

const exitCode = await runLocalServiceCli(
  options.args,
  process.env,
  { sink, terminal, waitForShutdownSignal: () => Promise.reject(new Error('não usado')) },
  { protectedDirectories: [] },
);
report({ exitCode, probe: 'result', reopened: reopensExclusively() });
finished = true;
process.exitCode = exitCode;
