import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPOSITORY_ROOT } from './support/local-service-harness';
import { SIMULATE_FILE_SYMLINK_EPERM_ENV } from './support/runtime-skips';
import { createTestDirectory, removeTestDirectory } from './support/temporary-directories';

/*
 * E1.07-PD87-C2 (RV-C1M-05, RV-C1M-01/02/04) — as verificações do `afterAll` e do `aroundEach` de
 * `tests/setup.ts` provadas por comportamento: o Vitest corre, num processo filho, ficheiros de ensaio
 * que têm de falhar (ou passar) por uma razão exacta. Retirar `finishFile`, `unmetFailureReasons` ou
 * a verificação das pastas pendentes faz passar um ficheiro de ensaio que tem de falhar, e este teste
 * falha — sem depender do texto de `tests/setup.ts`. Não altera a configuração principal: os ensaios
 * usam `tests/guard-fixtures/vitest.guard-fixtures.config.ts` e limites próprios de cada teste.
 */

const VITEST_ENTRY = path.join(REPOSITORY_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const FIXTURES_CONFIG = path.join('tests', 'guard-fixtures', 'vitest.guard-fixtures.config.ts');
const CHILD_TEST_TIMEOUT = 120_000;

interface JsonAssertion {
  readonly title: string;
  readonly status: string;
  readonly failureMessages: readonly string[];
  readonly duration?: number;
}

interface JsonFile {
  readonly name: string;
  readonly status: string;
  readonly message: string;
  readonly assertionResults: readonly JsonAssertion[];
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

const isAssertion = (value: unknown): value is JsonAssertion =>
  isRecord(value) &&
  typeof value['title'] === 'string' &&
  typeof value['status'] === 'string' &&
  Array.isArray(value['failureMessages']) &&
  value['failureMessages'].every((message) => typeof message === 'string');

const isFile = (value: unknown): value is JsonFile =>
  isRecord(value) &&
  typeof value['name'] === 'string' &&
  typeof value['status'] === 'string' &&
  typeof value['message'] === 'string' &&
  Array.isArray(value['assertionResults']) &&
  value['assertionResults'].every(isAssertion);

const parseReport = (text: string): readonly JsonFile[] => {
  const report: unknown = JSON.parse(text);
  if (!isRecord(report) || !Array.isArray(report['testResults']) || !report['testResults'].every(isFile)) {
    throw new Error('Relatório JSON do Vitest com forma inesperada.');
  }
  return report['testResults'];
};

/** Ambiente do filho sem as variáveis do *worker* do Vitest em curso. */
const childEnvironment = (extra: Readonly<Record<string, string>>): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('VITEST') && key !== SIMULATE_FILE_SYMLINK_EPERM_ENV) environment[key] = value;
  }
  return { ...environment, ...extra };
};

/** Corre o Vitest num processo filho e lê o relatório JSON; espera por `close` antes de remover a pasta. */
const runVitest = async (
  args: readonly string[],
  extra: Readonly<Record<string, string>> = {},
): Promise<{ readonly exitCode: number | null; readonly files: readonly JsonFile[]; readonly stderr: string }> => {
  const directory = createTestDirectory('infra');
  try {
    const output = path.join(directory, 'relatorio.json');
    let stderr = '';
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [VITEST_ENTRY, 'run', ...args, '--reporter=json', `--outputFile=${output}`], {
        cwd: REPOSITORY_ROOT,
        env: childEnvironment(extra),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout.resume();
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.once('error', reject);
      child.once('close', (code) => {
        resolve(code);
      });
    });
    return { exitCode, files: parseReport(readFileSync(output, 'utf8')), stderr };
  } finally {
    removeTestDirectory(directory);
  }
};

const fileNamed = (files: readonly JsonFile[], name: string): JsonFile => {
  const found = files.find((file) => path.basename(file.name) === name);
  if (found === undefined) throw new Error(`Ficheiro de ensaio sem resultado: ${name}`);
  return found;
};

const statuses = (file: JsonFile): readonly (readonly [string, string])[] =>
  file.assertionResults.map((assertion) => [assertion.title, assertion.status] as const);

describe('E1.07-PD87-C2 guard checks proven in a child process (RV-C1M-05)', () => {
  it(
    '[C2-P01] each fixture passes or fails at the end of the file for exactly its reason',
    async () => {
      const { exitCode, files, stderr } = await runVitest(['--config', FIXTURES_CONFIG, '--no-file-parallelism']);
      expect(exitCode, stderr).toBe(1);
      expect(files.map((file) => path.basename(file.name)).sort()).toEqual([
        'aftereach-throws.fixture.ts',
        'control.fixture.ts',
        'interrupted.fixture.ts',
        'pending-directory.fixture.ts',
        'secondary-failure.fixture.ts',
        'unauthorised-skip.fixture.ts',
        'undeclared-reason.fixture.ts',
        'wrong-reason.fixture.ts',
      ]);

      // Controlo: o ficheiro passa; os ignorados antes de correr não contam como executados.
      const control = fileNamed(files, 'control.fixture.ts');
      expect({ message: control.message, status: control.status }).toEqual({ message: '', status: 'passed' });
      expect(statuses(control)).toEqual([
        ['passes', 'passed'],
        ['fails for the declared reason', 'passed'],
        ['is skipped before running', 'skipped'],
        ['is a todo', 'todo'],
      ]);

      // Cada um destes só pode falhar no `afterAll`, e só pela razão indicada (os testes passaram).
      const endOfFile = /^fim do ficheiro de testes \(PD65-T1, PD-87\):\n/;
      const failsAtEnd: readonly (readonly [string, RegExp])[] = [
        ['wrong-reason.fixture.ts', /^teste negativo falhou por outra razão: \[GF-WRONG-REASON\][^\n]*\n {2}esperado: \/\^Error: razão declarada\$\/\n {2}observado: Error: outra razão$/],
        ['undeclared-reason.fixture.ts', /^teste negativo \(it\.fails\) sem razão esperada declarada \(expectFailureReasons\): \[GF-UNDECLARED\] > fails without declaring the reason$/],
        ['unauthorised-skip.fixture.ts', /^teste ignorado em execução sem autorização \(RUNTIME_SKIP_ALLOWED\): \[GF-SKIP\] > \[GF-SKIP\] is skipped at runtime without authorisation$/],
        ['interrupted.fixture.ts', /^teste negativo falhou por outra razão: \[GF-INTERRUPTED\][^\n]*\n {2}esperado: [^\n]*\n {2}observado: Error: Test timed out in 200ms\./],
        ['secondary-failure.fixture.ts', /^teste negativo falhou por outra razão: \[GF-SECONDARY\][^\n]*\n {2}esperado: [^\n]*\n {2}observado: Error: razão declarada \| SecondaryCleanupError: /],
        ['pending-directory.fixture.ts', /^pastas temporárias de ensaio não removidas: [^\n]*kil-business-infra-[A-Za-z0-9]{6}$/],
      ];
      for (const [name, reason] of failsAtEnd) {
        const file = fileNamed(files, name);
        expect(file.status, name).toBe('failed');
        expect(file.message, name).toMatch(endOfFile);
        expect(file.message.replace(endOfFile, ''), name).toMatch(reason);
        expect(file.assertionResults.filter((assertion) => assertion.status === 'failed'), name).toEqual([]);
      }

      // RV-C1M-04: o `afterEach` do `describe` lança no primeiro teste; o primeiro falha só com esse erro,
      // o segundo passa e o ficheiro não tem falhas no `afterAll` (sem falha artificial da guarda).
      const afterEachThrows = fileNamed(files, 'aftereach-throws.fixture.ts');
      expect(afterEachThrows.message).toBe('');
      expect(statuses(afterEachThrows)).toEqual([
        ['first', 'failed'],
        ['second', 'passed'],
      ]);
      const [first] = afterEachThrows.assertionResults;
      expect(first?.failureMessages).toHaveLength(1);
      expect(first?.failureMessages[0]).toMatch(/^Error: falha do afterEach do describe\n/);
    },
    CHILD_TEST_TIMEOUT,
  );

  it(
    '[C2-P02] (RV-C1M-01) [X02] without the privilege for file symbolic links is skipped at runtime and its file passes, in a partial run',
    async () => {
      const { exitCode, files, stderr } = await runVitest(['tests/database-exclusivity.test.ts', '-t', '\\[X02\\]'], {
        [SIMULATE_FILE_SYMLINK_EPERM_ENV]: '1',
      });
      expect(exitCode, stderr).toBe(0);
      expect(files).toHaveLength(1);
      const [file] = files;
      expect({ message: file?.message, status: file?.status }).toEqual({ message: '', status: 'passed' });
      const ran = file?.assertionResults.filter((assertion) => assertion.duration !== undefined) ?? [];
      // Só o [X02] correu (os outros foram filtrados por `-t`), e acabou ignorado em execução.
      expect(ran.map((assertion) => [assertion.title, assertion.status])).toEqual([
        ['[X02] resolves junctions and symbolic links to the final file', 'skipped'],
      ]);
      expect(file?.assertionResults.every((assertion) => assertion.status === 'skipped')).toBe(true);
    },
    CHILD_TEST_TIMEOUT,
  );
});
