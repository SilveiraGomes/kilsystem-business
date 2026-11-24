import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/*
 * E1.07-PD65-T1 — pastas temporárias dos ensaios. Cada pasta é criada por `createTestDirectory` e
 * removida por `removeTestDirectory`, que só aceita o caminho literal de uma pasta deste registo,
 * filha directa de `os.tmpdir()` e com o prefixo `kil-business-`. Em Windows, um *handle* ainda
 * aberto (processo filho a terminar, antivírus, indexação) pode fazer `rmSync` falhar com `EPERM`
 * ou `EBUSY` durante alguns milissegundos; só esses dois códigos são repetidos, um número limitado
 * de vezes, e cada repetição é registada. Qualquer outro erro, ou o esgotamento das tentativas,
 * propaga-se: a limpeza nunca falha em silêncio.
 */

/** Códigos transitórios observados na PD-65 (X34). `ENOTEMPTY`, `EACCES` e outros não são repetidos. */
export const TRANSIENT_CLEANUP_CODES: readonly string[] = Object.freeze(['EPERM', 'EBUSY']);
export const CLEANUP_MAX_ATTEMPTS = 5;
/** Espera antes da tentativa n+1: 50, 100, 200, 400 ms (no máximo 750 ms no total). */
export const cleanupDelayMs = (attempt: number): number => 50 * 2 ** (attempt - 1);

/** Variável de ambiente opcional: ficheiro JSONL onde cada repetição e cada desistência são acrescentadas. */
export const CLEANUP_LOG_ENV = 'KIL_TEST_CLEANUP_LOG';

const DIRECTORY_NAME = /^kil-business-[a-z0-9]+(?:-[a-z0-9]+)*-[A-Za-z0-9]{6}$/;

export interface CleanupRecord {
  readonly directory: string;
  readonly attempt: number;
  readonly code: string;
  readonly outcome: 'retry' | 'gave-up';
  readonly delayMs: number;
}

export interface RemoveOptions {
  /** Só para os testes do próprio *helper*. */
  readonly remove?: (directory: string) => void;
  readonly wait?: (milliseconds: number, attempt: number) => void;
  readonly onRecord?: (record: CleanupRecord) => void;
}

const created = new Set<string>();

const sleep = (milliseconds: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

const codeOf = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
};

const report = (record: CleanupRecord, onRecord: ((record: CleanupRecord) => void) | undefined): void => {
  onRecord?.(record);
  const line = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, ...record });
  process.stderr.write(`[kil-test-cleanup] ${line}\n`);
  const log = process.env[CLEANUP_LOG_ENV];
  if (log !== undefined && log !== '') appendFileSync(log, `${line}\n`);
};

/** Cria uma pasta `kil-business-<prefixo>-XXXXXX` em `os.tmpdir()` e regista-a para remoção. */
export const createTestDirectory = (prefix: string): string => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(prefix)) throw new Error(`Prefixo de pasta de ensaio inválido: ${prefix}`);
  const directory = mkdtempSync(path.join(tmpdir(), `kil-business-${prefix}-`));
  created.add(directory);
  return directory;
};

/** Pastas criadas por este módulo (neste processo) ainda não removidas com sucesso. */
export const pendingTestDirectories = (): readonly string[] => [...created];

const assertOwnDirectory = (directory: string): void => {
  if (!path.isAbsolute(directory)) throw new Error(`Recusado: caminho não absoluto (${directory}).`);
  if (path.resolve(directory) !== directory) throw new Error(`Recusado: caminho não literal (${directory}).`);
  if (path.dirname(directory).toLowerCase() !== path.resolve(tmpdir()).toLowerCase()) {
    throw new Error(`Recusado: fora da pasta temporária do sistema (${directory}).`);
  }
  if (!DIRECTORY_NAME.test(path.basename(directory))) throw new Error(`Recusado: nome não reconhecido (${directory}).`);
  if (!created.has(directory)) throw new Error(`Recusado: pasta não criada por este ensaio (${directory}).`);
};

/**
 * Remove uma pasta criada por `createTestDirectory`. Repete só `EPERM`/`EBUSY`, no máximo
 * `CLEANUP_MAX_ATTEMPTS` tentativas, e confirma que o caminho deixou de existir.
 */
export const removeTestDirectory = (directory: string, options: RemoveOptions = {}): void => {
  assertOwnDirectory(directory);
  const remove = options.remove ?? ((target: string) => rmSync(target, { force: true, recursive: true }));
  const wait = options.wait ?? sleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      remove(directory);
      break;
    } catch (error) {
      const code = codeOf(error);
      if (code === undefined || !TRANSIENT_CLEANUP_CODES.includes(code)) throw error;
      if (attempt >= CLEANUP_MAX_ATTEMPTS) {
        report({ attempt, code, delayMs: 0, directory, outcome: 'gave-up' }, options.onRecord);
        throw error;
      }
      const delayMs = cleanupDelayMs(attempt);
      report({ attempt, code, delayMs, directory, outcome: 'retry' }, options.onRecord);
      wait(delayMs, attempt);
    }
  }
  if (existsSync(directory)) throw new Error(`A pasta de ensaio continua a existir depois da remoção: ${directory}`);
  created.delete(directory);
};
