import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

import { build } from 'vite';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { openSqliteDatabase, type SqliteDatabase } from '../packages/database/src/index';
import { LOCAL_SERVICE_EXIT_CODES } from '../services/local-api/src/cli';
import { LOCAL_SERVICE_ENV } from '../services/local-api/src/config';
import { OTHER_TEST_PASSWORD, TEST_HASHING_PARAMETERS, TEST_PASSWORD } from './support/authentication-fixtures';
import { newId } from './support/fixtures';
import { uniqueUsername } from './support/identity-fixtures';
import { createServiceUnderTest, REPOSITORY_ROOT, serviceConfig, type ServiceUnderTest } from './support/local-service-harness';
import type { RecoveryCliChildOptions } from './support/recovery/recovery-cli-child';
import { stopServicesThenDisposeNow } from './support/service-cleanup';
import { createTemporaryDatabase, type TemporaryDatabase } from './support/sqlite-harness';
import { createTestDirectory, removeTestDirectory } from './support/temporary-directories';

/*
 * E1.07-D3-R1-C3 — CLI de recuperação num PROCESSO FILHO REAL (RV-C2M-01/03/07). O filho corre
 * `runLocalServiceCli` e o terminal real sobre a sua `process.stdin` verdadeira (*pipe*), compilados
 * pelo Vite a partir de `src/` (sem `dist/`), com SQLite real e o Argon2id de produção. O pai
 * responde a cada *prompt* só depois de o ver, nunca fecha a entrada e nunca mata o filho: o filho
 * tem de terminar sozinho. Nenhuma espera é por tempo; o limite do teste só actua se o filho não
 * terminar. Não substitui a validação numa consola física do Windows (PD-85).
 */

type ChildEvent = Readonly<Record<string, unknown>>;

interface CliChild {
  readonly process: ChildProcessWithoutNullStreams;
  readonly events: readonly ChildEvent[];
  readonly output: () => string;
  /** Resolve quando a saída acumulada satisfaz `pattern`; rejeita se o filho terminar antes. */
  readonly waitForOutput: (pattern: RegExp) => Promise<RegExpMatchArray>;
  readonly exited: Promise<number | null>;
  /** `close`: terminou e os *pipes* foram fechados; a limpeza espera por este evento. */
  readonly closed: Promise<void>;
}

const CODE_PATTERN = /(?:[0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z*~$=U]/;
const CONFIRMATION_PROMPT = /escreva o último grupo de 4 símbolos/;

let directory: string | undefined;
let bundle = '';
const children: CliChild[] = [];
/** PD65-P5: filhos já criados cujo `close` ainda não chegou (independente de `children`, que `closeChildren` esvazia). */
let unclosedChildren = 0;

beforeAll(async () => {
  directory = createTestDirectory('recovery-cli-child');
  const requireFromDatabase = createRequire(path.join(REPOSITORY_ROOT, 'packages', 'database', 'package.json'));
  const betterSqlite = pathToFileURL(requireFromDatabase.resolve('better-sqlite3')).href;
  await build({
    build: {
      emptyOutDir: false,
      minify: false,
      outDir: directory,
      rollupOptions: {
        external: [/^node:/, 'better-sqlite3'],
        input: { 'recovery-cli-child': path.join(REPOSITORY_ROOT, 'tests', 'support', 'recovery', 'recovery-cli-child.ts') },
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
  bundle = path.join(directory, 'recovery-cli-child.mjs');
}, 60_000);

/** Termina os filhos ainda vivos (só se uma asserção falhar a meio) e espera por `close` de todos. */
const closeChildren = async (): Promise<void> => {
  for (const child of children.splice(0)) {
    if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill();
    await child.closed;
  }
};

afterEach(closeChildren);

afterAll(() => {
  if (directory === undefined) return;
  removeTestDirectory(directory);
  expect(existsSync(directory)).toBe(false);
});

const spawnCli = (databasePath: string, options: Omit<RecoveryCliChildOptions, 'databasePath'>): CliChild => {
  const childOptions: RecoveryCliChildOptions = { ...options, databasePath };
  const child = spawn(process.execPath, [bundle], {
    env: {
      ...process.env,
      KIL_RECOVERY_CLI_CHILD: JSON.stringify(childOptions),
      [LOCAL_SERVICE_ENV.databasePath]: databasePath,
      [LOCAL_SERVICE_ENV.environment]: 'test',
      [LOCAL_SERVICE_ENV.instanceId]: 'recovery-cli-child',
      [LOCAL_SERVICE_ENV.logLevel]: 'debug',
      [LOCAL_SERVICE_ENV.onMissingDatabase]: 'fail',
      [LOCAL_SERVICE_ENV.onPendingMigrations]: 'fail',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return trackCli(child);
};

const trackCli = (child: ChildProcessWithoutNullStreams): CliChild => {
  unclosedChildren += 1;
  const events: ChildEvent[] = [];
  let output = '';
  const waiters: { readonly pattern: RegExp; readonly resolve: (match: RegExpMatchArray) => void }[] = [];
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code));
  });
  const closed = new Promise<void>((resolve) => {
    child.once('close', () => {
      unclosedChildren -= 1;
      resolve();
    });
  });
  child.stdout.setEncoding('utf8').on('data', (text: string) => {
    output += text;
    for (const waiter of [...waiters]) {
      const match = output.match(waiter.pattern);
      if (match !== null) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(match);
      }
    }
  });
  createInterface({ input: child.stderr }).on('line', (line) => {
    try {
      events.push(JSON.parse(line) as ChildEvent);
    } catch {
      events.push({ probe: 'stderr', line });
    }
  });
  const tracked: CliChild = {
    closed,
    events,
    exited,
    output: () => output,
    process: child,
    waitForOutput: (pattern) => {
      const seen = output.match(pattern);
      if (seen !== null) return Promise.resolve(seen);
      return new Promise<RegExpMatchArray>((resolve, reject) => {
        waiters.push({ pattern, resolve });
        void exited.then((code) => {
          reject(new Error(`O filho terminou (${String(code)}) antes de ${String(pattern)}: ${output}`));
        });
      });
    },
  };
  children.push(tracked);
  return tracked;
};

/** Responde a um *prompt* só depois de ele aparecer; a saída anterior é ignorada pelo índice. */
const answer = async (child: CliChild, prompt: string, value: string, from: number): Promise<number> => {
  const escaped = prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await child.waitForOutput(new RegExp(`^[\\s\\S]{${String(from)}}[\\s\\S]*${escaped}`));
  const at = child.output().lastIndexOf(prompt) + prompt.length;
  child.process.stdin.write(`${value}\r`);
  return at;
};

/** Lê o código apresentado e confirma-o com o último grupo de dados (como o titular). */
const confirmShownCode = async (child: CliChild): Promise<string> => {
  await child.waitForOutput(new RegExp(`${CODE_PATTERN.source}[\\s\\S]*${CONFIRMATION_PROMPT.source}`));
  const code = CODE_PATTERN.exec(child.output())?.[0] ?? '';
  child.process.stdin.write(`${code.split('-').at(-2) ?? ''}\r`);
  return code;
};

const fragmentsOf = (code: string): string[] => {
  const groups = code.split('-').slice(0, -1);
  return groups.slice(0, -1).map((group, index) => `${group}-${groups[index + 1] ?? ''}`).concat(groups.join('').match(/.{8}/g) ?? []);
};

interface Finished {
  readonly exitCode: number | null;
  readonly result: ChildEvent | undefined;
  readonly logs: readonly ChildEvent[];
}

const finished = async (child: CliChild): Promise<Finished> => {
  const exitCode = await child.exited;
  return {
    exitCode,
    logs: child.events.filter((event) => event['probe'] === undefined),
    result: child.events.find((event) => event['probe'] === 'result'),
  };
};

/*
 * PD65-P5 (RV-PD65-02): o filho termina logo, mas o neto (`detached`, como no PD65-T07) herda os
 * *pipes* e só termina sozinho 3 s depois; `exit` chega muito antes de `close`.
 */
const PIPE_HOLDER = [
  "const { spawn } = require('node:child_process');",
  "spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 3000)'], { detached: true, stdio: 'inherit', windowsHide: true });",
  'process.exit(0);',
].join('\n');

describe('E1.07-D3-R1-C3 recovery CLI in a real child process', () => {
  let temporary: TemporaryDatabase;
  const services: ServiceUnderTest[] = [];
  /** PD65-P5: filhos ainda sem `close` no instante em que a base do teste foi apagada. */
  let unclosedAtDispose: number | undefined;

  const createDatabase = (): TemporaryDatabase => {
    const database = createTemporaryDatabase();
    unclosedAtDispose = undefined;
    return {
      ...database,
      dispose: () => {
        unclosedAtDispose ??= unclosedChildren;
        database.dispose();
      },
    };
  };

  afterEach(async () => {
    // Este `afterEach` corre antes do exterior: a base só é apagada depois de `close` de todos os filhos.
    await closeChildren();
    // PD87-C2 (PD-57): e depois de parar os serviços do próprio teste e confirmar as ligações fechadas;
    // uma asserção falhada com o serviço de preparação activo já não apaga a base detida.
    await stopServicesThenDisposeNow(services.splice(0), temporary);
    // PD65-P5: protege a ordem acima — nenhum filho pode ter os *pipes* abertos quando a base é apagada.
    expect(unclosedAtDispose, 'filhos sem `close` quando a base foi apagada').toBe(0);
  });

  it('[PD65-T11] (PD65-P5) the database is only disposed after close of every child, even when close comes long after exit', async () => {
    temporary = createDatabase();
    const probe = trackCli(spawn(process.execPath, ['-e', PIPE_HOLDER], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }));

    expect(await probe.exited).toBe(0);
    // `exit` já chegou; o neto mantém os *pipes* abertos, por isso `close` ainda não.
    expect(probe.process.stdout.closed).toBe(false);
    expect(unclosedChildren).toBe(1);
    // O `afterEach` tem de esperar pelo `close` deste filho antes de apagar a base (verificado lá).
  }, 30_000);

  /** Depois do fim do filho, a base abre em exclusivo sem espera e o estado é lido dessa ligação. */
  const afterExit = <T>(read: (database: SqliteDatabase) => T): T => {
    const database = openSqliteDatabase({ busyTimeoutMs: 0, exclusive: true, fileMustExist: true, filename: temporary.filename });
    try {
      return read(database);
    } finally {
      database.close();
    }
  };
  const states = (database: SqliteDatabase): string[] =>
    database.prepare('SELECT state FROM installation_recovery_codes ORDER BY sequence').pluck().all() as string[];

  it('[R-P01] (RV-C2M-01/03/07) post-commit secondary failures give 10 or 5, the process ends by itself and the database is released', async () => {
    temporary = createDatabase();
    const username = uniqueUsername('admin');
    const prepared = createServiceUnderTest(serviceConfig(temporary.filename), undefined, { passwordHashing: { parameters: TEST_HASHING_PARAMETERS } });
    services.push(prepared);
    await prepared.service.start();
    await prepared.service.identityProvisioning.installation.initialise({ displayName: 'Administrador Fictício', id: newId(), username }, TEST_PASSWORD);
    await prepared.service.stop();

    const rotate = async (password: string, faults: Pick<RecoveryCliChildOptions, 'failLog' | 'silentAfterCommit'>, confirm = true) => {
      const child = spawnCli(temporary.filename, { args: ['recovery', 'rotate'], ...faults });
      const at = await answer(child, 'Nome de utilizador do administrador inicial: ', username, 0);
      await answer(child, 'Palavra-passe: ', password, at);
      const code = confirm ? await confirmShownCode(child) : '';
      return { child, code, ...(await finished(child)) };
    };

    // B: rotação confirmada; o registo da transição para STOPPING (antes da libertação) falha.
    const stopFails = await rotate(TEST_PASSWORD, { failLog: ['"to":"STOPPING"'], silentAfterCommit: false });
    expect(stopFails.exitCode).toBe(LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete);
    expect(stopFails.result).toMatchObject({ exitCode: LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete, reopened: true });
    expect(stopFails.child.output()).toContain('Confirmado.');
    expect(stopFails.child.output()).toMatch(/não é necessário emitir outro código/);
    expect(stopFails.logs.find((event) => event['event'] === 'recovery.finalization_incomplete')).toMatchObject({ serviceStop: 'record-failed' });
    expect(afterExit(states)).toEqual(['ACTIVE']);

    // C: depois do commit falham todas as escritas e todos os registos (incluindo os do encerramento).
    const silent = await rotate(TEST_PASSWORD, { failLog: [], silentAfterCommit: true }, false);
    expect(silent.exitCode).toBe(LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed);
    expect(silent.result).toMatchObject({ exitCode: LOCAL_SERVICE_EXIT_CODES.recoveryPresentationFailed, reopened: true });
    expect(silent.child.output()).not.toMatch(CODE_PATTERN);
    expect(afterExit(states)).toEqual(['SUPERSEDED', 'ACTIVE']);

    // A / P7: o registo do código já confirmado pelo titular falha.
    const p7 = await rotate(TEST_PASSWORD, { failLog: ['"recovery.code_presented"'], silentAfterCommit: false });
    expect(p7.exitCode).toBe(LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete);
    expect(p7.result).toMatchObject({ reopened: true });
    expect(p7.child.output()).not.toMatch(/É necessário emitir outro/);
    expect(afterExit(states)).toEqual(['SUPERSEDED', 'SUPERSEDED', 'ACTIVE']);

    // F + B: `recover` com o código confirmado em P7; o registo falha depois da substituição e o encerramento também.
    const recovery = spawnCli(temporary.filename, {
      args: ['recovery', 'recover'],
      failLog: ['"recovery.completed"', '"service.stopped"'],
      silentAfterCommit: false,
    });
    let at = await answer(recovery, 'Código de recuperação: ', p7.code, 0);
    at = await answer(recovery, 'Nova palavra-passe: ', OTHER_TEST_PASSWORD, at);
    await answer(recovery, 'Confirme a nova palavra-passe: ', OTHER_TEST_PASSWORD, at);
    const delivered = await confirmShownCode(recovery);
    const recovered = await finished(recovery);
    expect(recovered.exitCode).toBe(LOCAL_SERVICE_EXIT_CODES.recoveryCommittedIncomplete);
    expect(recovered.result).toMatchObject({ reopened: true });
    expect(recovery.output()).toMatch(/NOVA palavra-passe/);
    expect(afterExit(states)).toEqual(['SUPERSEDED', 'SUPERSEDED', 'CONSUMED', 'ACTIVE']);

    // Recuperação posterior: a NOVA palavra-passe roda o código entregue, sem falhas → 0.
    const clean = await rotate(OTHER_TEST_PASSWORD, { failLog: [], silentAfterCommit: false });
    expect(clean.exitCode).toBe(LOCAL_SERVICE_EXIT_CODES.ok);
    expect(afterExit((database) => [states(database), database.pragma('integrity_check', { simple: true })])).toEqual([
      ['SUPERSEDED', 'SUPERSEDED', 'CONSUMED', 'SUPERSEDED', 'ACTIVE'],
      'ok',
    ]);

    for (const child of [stopFails.child, silent.child, p7.child, recovery, clean.child]) {
      // A entrada nunca foi fechada pelo pai e nenhum filho ficou com uma leitura ou trabalho pendente.
      expect(child.process.stdin.writableEnded).toBe(false);
      expect(child.events.filter((event) => event['probe'] === 'loop-empty' || event['probe'] === 'stderr')).toEqual([]);
      const log = child.events.map((event) => JSON.stringify(event)).join('\n');
      for (const secret of [TEST_PASSWORD, OTHER_TEST_PASSWORD]) expect(log).not.toContain(secret);
      for (const code of [stopFails.code, p7.code, delivered, clean.code]) for (const fragment of fragmentsOf(code)) expect(log).not.toContain(fragment);
    }
  }, 120_000);
});
