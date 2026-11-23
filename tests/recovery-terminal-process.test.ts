import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { build } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { REPOSITORY_ROOT } from './support/local-service-harness';
import { createTestDirectory, removeTestDirectory } from './support/temporary-directories';

/*
 * E1.07-D3-R1-C2 — terminal da recuperação num PROCESSO FILHO REAL (RV-C1M-02, RV-C1M-03/OM-04).
 * A entrada do filho é a sua `process.stdin` verdadeira (um *pipe*), não uma *stream* simulada; só o
 * modo *raw* é simulado. Nenhuma espera é por tempo: o filho relata `loop-empty` (evento
 * `beforeExit`) se o ciclo de eventos ficar vazio com uma leitura por concluir, e cada espera do pai
 * termina logo que o filho sai. Não substitui a validação numa consola física do Windows (PD-85).
 */

type ChildEvent = Readonly<Record<string, unknown>>;

interface TerminalChild {
  readonly process: ChildProcessWithoutNullStreams;
  readonly events: readonly ChildEvent[];
  readonly prompts: () => string;
  /** Primeiro evento que satisfaz `match`; rejeita se o filho terminar antes. */
  readonly waitFor: (match: (event: ChildEvent) => boolean) => Promise<ChildEvent>;
  readonly exited: Promise<number | null>;
  /** `close`: terminou e os *pipes* foram fechados; a limpeza espera por este evento. */
  readonly closed: Promise<void>;
}

let directory: string | undefined;
let bundle = '';
const children: TerminalChild[] = [];

beforeAll(async () => {
  directory = createTestDirectory('terminal-child');
  await build({
    build: {
      emptyOutDir: false,
      minify: false,
      outDir: directory,
      rollupOptions: {
        external: [/^node:/],
        input: { 'terminal-child': path.join(REPOSITORY_ROOT, 'tests', 'support', 'terminal', 'terminal-child.ts') },
        output: { entryFileNames: '[name].mjs', format: 'es' },
      },
      ssr: true,
      target: 'node22',
    },
    configFile: false,
    logLevel: 'silent',
    resolve: { conditions: ['source'] },
    root: REPOSITORY_ROOT,
    ssr: { noExternal: true, resolve: { conditions: ['source', 'import', 'default'], externalConditions: ['node'] }, target: 'node' },
  });
  bundle = path.join(directory, 'terminal-child.mjs');
}, 60_000);

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill();
    await child.closed;
  }
});

afterAll(() => {
  if (directory === undefined) return;
  removeTestDirectory(directory);
  expect(existsSync(directory)).toBe(false);
});

const spawnChild = (mode: string): TerminalChild => {
  const child = spawn(process.execPath, [bundle, mode], { stdio: ['pipe', 'pipe', 'pipe'] });
  const events: ChildEvent[] = [];
  const waiters: { readonly match: (event: ChildEvent) => boolean; readonly resolve: (event: ChildEvent) => void }[] = [];
  let prompts = '';
  child.stdout.setEncoding('utf8').on('data', (text: string) => {
    prompts += text;
  });
  createInterface({ input: child.stderr }).on('line', (line) => {
    let event: ChildEvent;
    try {
      event = JSON.parse(line) as ChildEvent;
    } catch {
      event = { event: 'stderr', line };
    }
    events.push(event);
    for (const waiter of [...waiters]) {
      if (waiter.match(event)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    }
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
  const closed = new Promise<void>((resolve) => {
    child.once('close', () => resolve());
  });
  const tracked: TerminalChild = {
    closed,
    events,
    exited,
    process: child,
    prompts: () => prompts,
    waitFor: (match) => {
      const seen = events.find(match);
      if (seen !== undefined) return Promise.resolve(seen);
      return new Promise<ChildEvent>((resolve, reject) => {
        waiters.push({ match, resolve });
        void exited.then((code) => {
          reject(new Error(`O processo filho terminou (${String(code)}) antes do evento esperado: ${JSON.stringify(events)}`));
        });
      });
    },
  };
  children.push(tracked);
  return tracked;
};

const ofKind = (kind: string) => (event: ChildEvent): boolean => event['event'] === kind;

describe('E1.07-D3-R1-C2 recovery terminal in a real child process', () => {
  it('[T-P01] (RV-C1M-02) a second read keeps the process alive until answered; then stdin is released and the process ends by itself', async () => {
    const child = spawnChild('two-reads');
    await child.waitFor((event) => event['event'] === 'reading' && event['read'] === 1);
    child.process.stdin.write('um\r');
    // Só depois da barreira do filho: sem `input.ref()`, o filho já teria terminado aqui.
    await child.waitFor((event) => event['event'] === 'reading' && event['read'] === 2);
    child.process.stdin.write('dois\r');

    // A entrada continua aberta (nunca é fechada pelo pai): o processo tem de terminar sozinho.
    await expect(child.exited).resolves.toBe(0);
    expect(child.process.stdin.writableEnded).toBe(false);
    expect(child.events.filter(ofKind('loop-empty'))).toEqual([]);
    expect(child.events.filter(ofKind('value'))).toEqual([
      { event: 'value', read: 1, value: 'um' },
      { event: 'value', length: 4, read: 2 },
    ]);
    // Modo *raw* ligado em cada leitura e reposto no fim de cada uma.
    expect(child.events.filter(ofKind('raw')).map((event) => event['mode'])).toEqual([true, false, true, false]);
    // A leitura secreta não ecoa.
    expect(child.prompts()).toBe('primeiro> um\nsegundo> \n');
    expect(child.events.filter(ofKind('stderr'))).toEqual([]);
  }, 30_000);

  it('[T-P02] (OM-04) a read on an input that already ended and closed fails at once instead of leaving the process with a pending read', async () => {
    const child = spawnChild('ended-before-read');
    child.process.stdin.end();

    await expect(child.exited).resolves.toBe(0);
    expect(child.events.filter(ofKind('closed'))).toEqual([{ destroyed: true, ended: true, event: 'closed' }]);
    expect(child.events.filter(ofKind('rejected'))).toEqual([{ event: 'rejected', failure: 'end-of-input' }]);
    expect(child.events.filter(ofKind('loop-empty'))).toEqual([]);
    expect(child.events.filter(ofKind('value'))).toEqual([]);
    expect(child.events.filter(ofKind('stderr'))).toEqual([]);
  }, 30_000);
});
