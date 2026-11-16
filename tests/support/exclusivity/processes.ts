import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import { build } from 'vite';

import { REPOSITORY_ROOT } from '../local-service-harness';
import type { ServiceProcessOptions } from './service-process';

/*
 * Processos reais para os ensaios de exclusividade (E1.07-X). As entradas de teste são compiladas
 * com o Vite a partir de `src/` (sem `dist/`) para uma pasta temporária própria; o `better-sqlite3`
 * fica externo e é carregado do workspace pelo caminho absoluto.
 */
export interface ChildBundle {
  readonly directory: string;
  readonly serviceProcess: string;
  readonly serviceCli: string;
  readonly dispose: () => void;
}

export const buildChildBundle = async (): Promise<ChildBundle> => {
  const directory = mkdtempSync(path.join(tmpdir(), 'kil-business-exclusivity-'));
  const requireFromDatabase = createRequire(path.join(REPOSITORY_ROOT, 'packages', 'database', 'package.json'));
  const betterSqlite = pathToFileURL(requireFromDatabase.resolve('better-sqlite3')).href;
  await build({
    build: {
      emptyOutDir: false,
      minify: false,
      outDir: directory,
      rollupOptions: {
        external: [/^node:/, 'better-sqlite3'],
        input: {
          'service-cli': path.join(REPOSITORY_ROOT, 'tests', 'support', 'exclusivity', 'service-cli.ts'),
          'service-process': path.join(REPOSITORY_ROOT, 'tests', 'support', 'exclusivity', 'service-process.ts'),
        },
        output: { entryFileNames: '[name].mjs', format: 'es', paths: { 'better-sqlite3': betterSqlite } },
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
  return {
    directory,
    dispose: () => {
      rmSync(directory, { force: true, recursive: true });
    },
    serviceCli: path.join(directory, 'service-cli.mjs'),
    serviceProcess: path.join(directory, 'service-process.mjs'),
  };
};

export type ChildEvent = Readonly<Record<string, unknown>>;

export interface TestChild {
  readonly process: ChildProcessWithoutNullStreams;
  readonly events: readonly ChildEvent[];
  /** Primeiro evento (já recebido ou futuro) que satisfaz `match`. */
  readonly waitFor: (match: (event: ChildEvent) => boolean, timeoutMs?: number) => Promise<ChildEvent>;
  readonly send: (command: string) => void;
  readonly exited: Promise<number | null>;
}

const children = new Set<TestChild>();

const track = (child: ChildProcessWithoutNullStreams): TestChild => {
  const events: ChildEvent[] = [];
  const waiters: { readonly match: (event: ChildEvent) => boolean; readonly resolve: (event: ChildEvent) => void }[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    let event: ChildEvent;
    try {
      event = JSON.parse(line) as ChildEvent;
    } catch {
      return;
    }
    events.push(event);
    for (const waiter of [...waiters]) {
      if (waiter.match(event)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    }
  });
  child.stderr.resume();
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
  const tracked: TestChild = {
    events,
    exited,
    process: child,
    send: (command) => {
      child.stdin.write(`${command}\n`);
    },
    waitFor: (match, timeoutMs = 30_000) =>
      new Promise<ChildEvent>((resolve, reject) => {
        const seen = events.find(match);
        if (seen !== undefined) {
          resolve(seen);
          return;
        }
        const timer = setTimeout(() => reject(new Error('Evento esperado não recebido.')), timeoutMs);
        waiters.push({
          match,
          resolve: (event) => {
            clearTimeout(timer);
            resolve(event);
          },
        });
      }),
  };
  children.add(tracked);
  void exited.then(() => children.delete(tracked));
  return tracked;
};

export const spawnServiceProcess = (bundle: ChildBundle, options: ServiceProcessOptions): TestChild =>
  track(
    spawn(process.execPath, [bundle.serviceProcess], {
      env: { ...process.env, KIL_EXCLUSIVITY_CHILD: JSON.stringify(options) },
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
  );

export interface CliOptions {
  readonly databasePath: string;
  readonly instanceId: string;
  readonly onMissingDatabase?: 'create' | 'fail';
  readonly onPendingMigrations?: 'apply' | 'fail';
}

/** Ponto de entrada real do serviço (`main.ts`), configurado só por variáveis de ambiente. */
export const spawnServiceCli = (bundle: ChildBundle, options: CliOptions): TestChild =>
  track(
    spawn(process.execPath, [bundle.serviceCli], {
      env: {
        ...process.env,
        LOCAL_DATABASE_PATH: options.databasePath,
        LOCAL_SERVICE_ENVIRONMENT: 'test',
        LOCAL_SERVICE_INSTANCE_ID: options.instanceId,
        LOCAL_SERVICE_LOG_LEVEL: 'info',
        LOCAL_SERVICE_ON_MISSING_DATABASE: options.onMissingDatabase ?? 'create',
        LOCAL_SERVICE_ON_PENDING_MIGRATIONS: options.onPendingMigrations ?? 'apply',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    }),
  );

export const isEvent =
  (name: string) =>
  (event: ChildEvent): boolean =>
    event['probe'] === name || event['event'] === name;

/** Primeiro desfecho do arranque do CLI: `service.ready` ou `service.start_failed`. */
export const cliOutcome = (event: ChildEvent): boolean =>
  event['event'] === 'service.ready' || event['event'] === 'service.start_failed';

/** Primeiro desfecho do arranque do processo de serviço: `ready` ou `failed`. */
export const processOutcome = (event: ChildEvent): boolean => event['probe'] === 'ready' || event['probe'] === 'failed';

/** Termina à força todos os processos ainda vivos criados por estes ensaios. */
export const killAllChildren = async (): Promise<void> => {
  const alive = [...children];
  for (const child of alive) if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill('SIGKILL');
  await Promise.all(alive.map((child) => child.exited));
};
