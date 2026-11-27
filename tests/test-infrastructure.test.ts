import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { openSqliteDatabase } from '../packages/database/src/index';
import { isEvent, killAllChildren, trackTestChild } from './support/exclusivity/processes';
import { createTemporaryDatabase } from './support/sqlite-harness';
import {
  CLEANUP_MAX_ATTEMPTS,
  createTestDirectory,
  pendingTestDirectories,
  removeTestDirectory,
  TRANSIENT_CLEANUP_CODES,
  type CleanupRecord,
} from './support/temporary-directories';

/*
 * E1.07-PD65-T1 — infra-estrutura dos ensaios: remoção limitada e registada das pastas temporárias
 * próprias e espera por `close` dos processos filhos antes da limpeza. Não testa código funcional.
 */

const failure = (code: string | undefined): Error => Object.assign(new Error(`falha simulada ${String(code)}`), code === undefined ? {} : { code });

const scripted = (codes: readonly (string | undefined)[]) => {
  const remaining = [...codes];
  let calls = 0;
  return {
    calls: () => calls,
    remove: (directory: string) => {
      calls += 1;
      if (remaining.length > 0) throw failure(remaining.shift());
      rmSync(directory, { force: true, recursive: true });
    },
  };
};

describe('E1.07-PD65-T1 test temporary directories', () => {
  it('[PD65-T01] removes an own directory, confirms it no longer exists and forgets it', () => {
    const directory = createTestDirectory('infra');
    writeFileSync(path.join(directory, 'ficheiro.txt'), 'x');
    expect(path.dirname(directory)).toBe(path.resolve(tmpdir()));
    expect(path.basename(directory)).toMatch(/^kil-business-infra-[A-Za-z0-9]{6}$/);
    expect(pendingTestDirectories()).toContain(directory);

    removeTestDirectory(directory);

    expect(existsSync(directory)).toBe(false);
    expect(pendingTestDirectories()).not.toContain(directory);
  });

  it('[PD65-T02] refuses anything that is not the literal path of an own directory, deleting nothing', () => {
    const decoy = mkdtempSync(path.join(tmpdir(), 'kil-business-decoy-'));
    const own = createTestDirectory('infra');
    try {
      for (const target of [
        decoy, // nome válido, mas não criado por este registo
        tmpdir(),
        path.basename(own), // relativo
        path.join(own, 'interior'),
        [own, '..', path.basename(own)].join(path.sep), // não literal (sem normalização)
        path.join(path.dirname(tmpdir()), path.basename(own)), // fora de os.tmpdir()
      ]) {
        expect(() => removeTestDirectory(target), target).toThrow(/^Recusado/);
      }
      expect(() => createTestDirectory('../fora')).toThrow(/Prefixo/);
      expect(existsSync(decoy)).toBe(true);
      expect(existsSync(own)).toBe(true);
    } finally {
      rmSync(decoy, { recursive: true });
      removeTestDirectory(own);
    }
  });

  it('[PD65-T03] retries only EPERM/EBUSY/ENOTEMPTY, with bounded delays, and records every retry', () => {
    expect(TRANSIENT_CLEANUP_CODES).toEqual(['EPERM', 'EBUSY', 'ENOTEMPTY']);
    const directory = createTestDirectory('infra');
    const remover = scripted(['EPERM', 'EBUSY', 'ENOTEMPTY']);
    const waits: number[] = [];
    const records: CleanupRecord[] = [];

    removeTestDirectory(directory, { onRecord: (record) => records.push(record), remove: remover.remove, wait: (ms) => waits.push(ms) });

    expect(remover.calls()).toBe(4);
    expect(waits).toEqual([50, 100, 200]);
    expect(records).toEqual([
      { attempt: 1, code: 'EPERM', delayMs: 50, directory, outcome: 'retry' },
      { attempt: 2, code: 'EBUSY', delayMs: 100, directory, outcome: 'retry' },
      { attempt: 3, code: 'ENOTEMPTY', delayMs: 200, directory, outcome: 'retry' },
    ]);
    expect(existsSync(directory)).toBe(false);
  });

  it('[PD65-T04] never retries any other error, including EACCES, ENOENT, EISDIR or an error without a code', () => {
    for (const code of ['EACCES', 'ENOENT', 'EISDIR', 'ENOTDIR', undefined]) {
      const directory = createTestDirectory('infra');
      const remover = scripted([code]);
      const records: CleanupRecord[] = [];
      try {
        expect(() =>
          removeTestDirectory(directory, { onRecord: (record) => records.push(record), remove: remover.remove, wait: () => undefined }),
        ).toThrow(`falha simulada ${String(code)}`);
        expect(remover.calls(), String(code)).toBe(1);
        expect(records, String(code)).toEqual([]);
        // A falha não é escondida: a pasta continua registada como pendente.
        expect(pendingTestDirectories()).toContain(directory);
      } finally {
        removeTestDirectory(directory);
      }
    }
  });

  it('[PD65-T05] gives up after the attempt limit, records it and rethrows the original error', () => {
    const directory = createTestDirectory('infra');
    const persistent = failure('EBUSY');
    let calls = 0;
    const waits: number[] = [];
    const records: CleanupRecord[] = [];
    try {
      expect(() =>
        removeTestDirectory(directory, {
          onRecord: (record) => records.push(record),
          remove: () => {
            calls += 1;
            throw persistent;
          },
          wait: (ms) => waits.push(ms),
        }),
      ).toThrow(persistent);
      expect(calls).toBe(CLEANUP_MAX_ATTEMPTS);
      expect(waits).toEqual([50, 100, 200, 400]);
      expect(records.map((record) => record.outcome)).toEqual(['retry', 'retry', 'retry', 'retry', 'gave-up']);
      expect(pendingTestDirectories()).toContain(directory);
    } finally {
      removeTestDirectory(directory);
    }
  });

  it('[PD65-T12] (D-246) a persistent ENOTEMPTY gives up after 5 attempts and 750 ms, records it and stays visible', () => {
    const directory = createTestDirectory('infra');
    const persistent = failure('ENOTEMPTY');
    let calls = 0;
    const waits: number[] = [];
    const records: CleanupRecord[] = [];
    try {
      expect(() =>
        removeTestDirectory(directory, {
          onRecord: (record) => records.push(record),
          remove: () => {
            calls += 1;
            throw persistent;
          },
          wait: (ms) => waits.push(ms),
        }),
      ).toThrow(persistent);
      expect(calls).toBe(CLEANUP_MAX_ATTEMPTS);
      expect(waits.reduce((total, ms) => total + ms, 0)).toBe(750);
      expect(records.map((record) => [record.code, record.outcome])).toEqual([
        ['ENOTEMPTY', 'retry'],
        ['ENOTEMPTY', 'retry'],
        ['ENOTEMPTY', 'retry'],
        ['ENOTEMPTY', 'retry'],
        ['ENOTEMPTY', 'gave-up'],
      ]);
      // Limpeza incompleta visível: a pasta continua a existir e registada como pendente.
      expect(existsSync(directory)).toBe(true);
      expect(pendingTestDirectories()).toContain(directory);
    } finally {
      removeTestDirectory(directory);
    }
  });

  it('[PD65-T13] (D-246) detects an incomplete cleanup: a removal that reports success but leaves the directory fails and stays pending', () => {
    for (const before of [[], ['ENOTEMPTY'], ['EPERM', 'ENOTEMPTY']]) {
      const directory = createTestDirectory('infra');
      writeFileSync(path.join(directory, 'resto.txt'), 'x');
      const remaining = [...before];
      const records: CleanupRecord[] = [];
      try {
        expect(() =>
          removeTestDirectory(directory, {
            onRecord: (record) => records.push(record),
            // Depois das falhas indicadas, «remove» sem erro mas sem apagar nada.
            remove: () => {
              const code = remaining.shift();
              if (code !== undefined) throw failure(code);
            },
            wait: () => undefined,
          }),
        ).toThrow(/continua a existir/);
        expect(records.map((record) => record.code), before.join(',')).toEqual(before);
        expect(existsSync(directory)).toBe(true);
        expect(pendingTestDirectories()).toContain(directory);
      } finally {
        removeTestDirectory(directory);
      }
    }
  });

  it('[PD65-T14] (D-246) mixed transient codes share one limit of 5 attempts; a non-transient code after them is rethrown at once', () => {
    const directory = createTestDirectory('infra');
    const remover = scripted(['ENOTEMPTY', 'EPERM', 'EACCES']);
    const records: CleanupRecord[] = [];
    try {
      expect(() =>
        removeTestDirectory(directory, { onRecord: (record) => records.push(record), remove: remover.remove, wait: () => undefined }),
      ).toThrow('falha simulada EACCES');
      expect(remover.calls()).toBe(3);
      expect(records.map((record) => record.code)).toEqual(['ENOTEMPTY', 'EPERM']);
      expect(pendingTestDirectories()).toContain(directory);

      const exhausted = scripted(['EPERM', 'ENOTEMPTY', 'EBUSY', 'ENOTEMPTY', 'EPERM', 'ENOTEMPTY']);
      expect(() => removeTestDirectory(directory, { remove: exhausted.remove, wait: () => undefined })).toThrow('falha simulada EPERM');
      expect(exhausted.calls()).toBe(CLEANUP_MAX_ATTEMPTS);
      expect(pendingTestDirectories()).toContain(directory);
    } finally {
      removeTestDirectory(directory);
    }
  });

  it.runIf(process.platform === 'win32')('[PD65-T06] (Windows) a real open SQLite handle gives a transient failure that the retry absorbs once released', () => {
    const directory = createTestDirectory('infra');
    const database = openSqliteDatabase({ filename: path.join(directory, 'aberta.sqlite') });
    database.exec('CREATE TABLE t (x INTEGER)');
    const records: CleanupRecord[] = [];

    removeTestDirectory(directory, {
      onRecord: (record) => records.push(record),
      wait: () => {
        if (database.open) database.close();
      },
    });

    expect(records).toHaveLength(1);
    expect(TRANSIENT_CLEANUP_CODES).toContain(records[0]?.code);
    expect(existsSync(directory)).toBe(false);
  });
});

/*
 * E1.07-PD65-P5 (RV-PD65-01) — libertação da base temporária: `dispose()` fecha as ligações próprias
 * antes de remover a pasta, pode ser chamado de novo sem erro nem segunda remoção, e uma falha real
 * não fica escondida por uma chamada posterior. Usa o prefixo `infra`: os registos são sintéticos.
 */
const codeOf = (error: unknown): unknown => (typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined);

const thrownBy = (work: () => void): unknown => {
  try {
    work();
  } catch (error) {
    return error;
  }
  return undefined;
};

/** Linhas `[kil-test-cleanup]` escritas em `stderr` sobre `directory` durante `work` (o `stderr` real continua a recebê-las). */
const cleanupLinesDuring = (directory: string, work: () => void): string[] => {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write');
  try {
    work();
  } finally {
    for (const [chunk] of spy.mock.calls) {
      const text = String(chunk);
      if (text.startsWith('[kil-test-cleanup]') && text.includes(JSON.stringify(directory).slice(1, -1))) lines.push(text);
    }
    spy.mockRestore();
  }
  return lines;
};

describe('E1.07-PD65-P5 temporary database disposal', () => {
  it('[PD65-T08] dispose() is idempotent: repeated calls neither fail nor remove or release anything twice', () => {
    const temporary = createTemporaryDatabase('infra');
    const connection = temporary.open();
    connection.exec('CREATE TABLE t (x INTEGER)');

    temporary.dispose();
    expect(connection.open).toBe(false);
    expect(existsSync(temporary.directory)).toBe(false);
    expect(pendingTestDirectories()).not.toContain(temporary.directory);

    // Um `afterEach` depois de um teste que já libertou a base: a 2.ª e a 3.ª chamada não tocam na pasta.
    const lines = cleanupLinesDuring(temporary.directory, () => {
      expect(thrownBy(() => temporary.dispose())).toBeUndefined();
      expect(thrownBy(() => temporary.dispose())).toBeUndefined();
    });
    expect(lines).toEqual([]);
    expect(pendingTestDirectories()).not.toContain(temporary.directory);
  });

  it('[PD65-T09] dispose() closes every own connection before removing the directory, so removal needs no retry', () => {
    const temporary = createTemporaryDatabase('infra');
    const writer = temporary.open();
    writer.exec('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1)');
    const reader = temporary.open();
    expect(reader.prepare('SELECT count(*) FROM t').pluck().get()).toBe(1);

    // Em Windows, remover antes de fechar dá `EPERM`/`EBUSY` até ao esgotamento das tentativas.
    const lines = cleanupLinesDuring(temporary.directory, () => {
      expect(thrownBy(() => temporary.dispose())).toBeUndefined();
    });

    expect([writer.open, reader.open]).toEqual([false, false]);
    expect(lines).toEqual([]);
    expect(existsSync(temporary.directory)).toBe(false);
    expect(pendingTestDirectories()).not.toContain(temporary.directory);
  });

  it.runIf(process.platform === 'win32')(
    '[PD65-T10] (Windows) a failed dispose() is not hidden: a repeated call fails again until the cause is released, then removes once',
    () => {
      const temporary = createTemporaryDatabase('infra');
      temporary.open().exec('CREATE TABLE t (x INTEGER)');
      // Ligação alheia ao harness: `dispose()` não a conhece nem a fecha, e mantém o ficheiro aberto.
      const foreign = openSqliteDatabase({ filename: temporary.filename });
      try {
        for (const call of ['1.ª', '2.ª']) {
          const error = thrownBy(() => temporary.dispose());
          expect(TRANSIENT_CLEANUP_CODES, `${call} chamada`).toContain(codeOf(error));
          expect(pendingTestDirectories(), `${call} chamada`).toContain(temporary.directory);
        }
      } finally {
        foreign.close();
      }

      expect(thrownBy(() => temporary.dispose())).toBeUndefined();
      expect(existsSync(temporary.directory)).toBe(false);
      expect(pendingTestDirectories()).not.toContain(temporary.directory);
      expect(thrownBy(() => temporary.dispose())).toBeUndefined();
    },
    15_000,
  );
});

/*
 * O filho cria um neto que herda os três *pipes* e termina logo: `exit` do filho chega antes de
 * `close`, porque o neto mantém os *pipes* abertos até o teste criar o ficheiro de libertação. Em
 * Windows o neto tem de ser `detached`: o libuv põe cada filho num *job object* com
 * `KILL_ON_JOB_CLOSE`, que mataria o neto com o filho. O limite de 20 s só actua se o teste falhar.
 */
const GRANDCHILD =
  "const fs = require('node:fs'); setInterval(() => { if (fs.existsSync(process.argv[1])) process.exit(0); }, 20); setTimeout(() => process.exit(3), 20000);";
const childScript = (release: string): string =>
  [
    "const { spawn } = require('node:child_process');",
    `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(GRANDCHILD)}, ${JSON.stringify(release)}], { detached: true, stdio: 'inherit', windowsHide: true });`,
    "process.stdout.write(JSON.stringify({ probe: 'grandchild', pid: grandchild.pid }) + '\\n', () => process.exit(0));",
  ].join('\n');

describe('E1.07-PD65-T1 child process cleanup', () => {
  it('[PD65-T07] killAllChildren waits for close of a child that already exited while its pipes were still open', async () => {
    const directory = createTestDirectory('infra');
    const release = path.join(directory, 'libertar');
    const child = trackTestChild(spawn(process.execPath, ['-e', childScript(release)], { stdio: ['pipe', 'pipe', 'pipe'] }));
    try {
      await child.waitFor(isEvent('grandchild'));
      expect(await child.exited).toBe(0);

      let cleaned = false;
      const cleanup = killAllChildren().then(() => {
        cleaned = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      // Só `close` liberta a limpeza, e o neto ainda não foi libertado.
      expect(cleaned).toBe(false);
      expect(child.process.stdout.closed).toBe(false);

      writeFileSync(release, '');
      await cleanup;
      expect(child.process.stdout.closed).toBe(true);
      expect(child.process.stderr.closed).toBe(true);
    } finally {
      writeFileSync(release, '');
      await child.closed;
      removeTestDirectory(directory);
    }
  }, 30_000);
});
