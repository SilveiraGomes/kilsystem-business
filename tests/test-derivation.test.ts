import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it, type RunnerTestFile } from 'vitest';

import type { SqliteDatabase } from '../packages/database/src/index';
import { createPasswordHasher, type PasswordHash } from '../services/local-api/src/authentication/password-hashing';
import {
  CLASSIFIED_DERIVATION_FILES,
  IDENTITY_GATE_DERIVATION,
  INSTALLATION_RECOVERY_DERIVATION,
  LOCAL_AUTHENTICATION_DERIVATION,
  LOCAL_SESSIONS_DERIVATION,
} from './support/argon2-test-classification';
import { OTHER_TEST_PASSWORD, TEST_HASHING_PARAMETERS, TEST_PASSWORD } from './support/authentication-fixtures';
import { expectFailureReasons } from './support/expected-failure';
import { newUser } from './support/identity-fixtures';
import { createServiceUnderTest, inspectDatabase, REPOSITORY_ROOT, serviceConfig, type ServiceUnderTest } from './support/local-service-harness';
import { RUNTIME_SKIP_ALLOWED } from './support/runtime-skips';
import { stopServicesThenDisposeNow } from './support/service-cleanup';
import { createTemporaryDatabase, type TemporaryDatabase } from './support/sqlite-harness';
import {
  createDerivationGuard,
  createDerivationTracker,
  deterministicTestDerive,
  failingTestsRun,
  fileDerivationGuard,
  fileExecution,
  isArgon2idHashOf,
  nativeArgon2idForTests,
  type DerivationClassification,
} from './support/test-derivation';

/*
 * E1.07-PD65-T4-C1 (D-246) — provas de que a derivação determinística dos testes não enfraquece os
 * percursos criptográficos: a produção continua a derivar com Argon2id real, a derivação de teste
 * distingue palavras-passe e entradas mas nunca passa por Argon2id, só os testes classificados a
 * podem usar, e as sentinelas dos percursos críticos têm de derivar com Argon2id real.
 */

const input = (overrides: Partial<Parameters<typeof deterministicTestDerive>[0]> = {}) => ({
  message: Buffer.from(TEST_PASSWORD, 'utf8'),
  nonce: Buffer.alloc(16, 7),
  parameters: TEST_HASHING_PARAMETERS,
  tagLength: 32,
  ...overrides,
});

const currentTest = (): string => expect.getState().currentTestName ?? '';

describe('E1.07-PD65-T4-C1 test password derivation', () => {
  it('[T4C-01] the deterministic test derivation depends on the password, salt, every parameter and the length, and never equals Argon2id', async () => {
    const base = await deterministicTestDerive(input());
    expect(base).toHaveLength(32);
    expect(await deterministicTestDerive(input())).toEqual(base);
    const variants = [
      input({ message: Buffer.from(OTHER_TEST_PASSWORD, 'utf8') }),
      input({ nonce: Buffer.alloc(16, 8) }),
      input({ parameters: { ...TEST_HASHING_PARAMETERS, memoryKiB: TEST_HASHING_PARAMETERS.memoryKiB + 1 } }),
      input({ parameters: { ...TEST_HASHING_PARAMETERS, passes: TEST_HASHING_PARAMETERS.passes + 1 } }),
      input({ parameters: { ...TEST_HASHING_PARAMETERS, parallelism: TEST_HASHING_PARAMETERS.parallelism + 1 } }),
    ];
    for (const variant of variants) expect((await deterministicTestDerive(variant)).equals(base)).toBe(false);
    // O tamanho também conta: um pedido maior não começa pelos mesmos bytes.
    expect((await deterministicTestDerive(input({ tagLength: 33 }))).subarray(0, 32).equals(base)).toBe(false);
    expect((await nativeArgon2idForTests(input())).equals(base)).toBe(false);
  });

  it('[T4C-02] the production hasher without injection stores real Argon2id; a deterministic credential is never accepted by it, nor the reverse', async () => {
    const production = createPasswordHasher({ parameters: TEST_HASHING_PARAMETERS });
    const deterministic = createPasswordHasher({ derive: deterministicTestDerive, parameters: TEST_HASHING_PARAMETERS });
    const real = await production.hash(TEST_PASSWORD);
    const fake = await deterministic.hash(TEST_PASSWORD);

    expect(isArgon2idHashOf(real, TEST_PASSWORD)).toBe(true);
    expect(isArgon2idHashOf(real, OTHER_TEST_PASSWORD)).toBe(false);
    expect(isArgon2idHashOf(fake, TEST_PASSWORD)).toBe(false);

    expect(await deterministic.verify(TEST_PASSWORD, fake)).toBe(true);
    expect(await deterministic.verify(OTHER_TEST_PASSWORD, fake)).toBe(false);
    expect(await production.verify(TEST_PASSWORD, fake)).toBe(false);
    expect(await deterministic.verify(TEST_PASSWORD, real)).toBe(false);
  });

  it('[T4C-03] the tracker starts on real Argon2id, refuses the deterministic mode outside the classification and checks sentinels', async () => {
    const tracker = createDerivationTracker({ argon2idRequired: ['[T4C-03]'], deterministicAllowed: ['[outro-teste]'] });
    expect(tracker.mode()).toBe('argon2id');
    expect(() => tracker.useDeterministic()).toThrow(/não autorizada/);
    expect(() => tracker.verifyAndReset(currentTest())).toThrow(/sentinela sem nenhuma derivação Argon2id/);

    await tracker.derive(input());
    expect(tracker.counts()).toEqual({ argon2id: 1, deterministic: 0 });
    tracker.verifyAndReset(currentTest());
    expect(tracker.counts()).toEqual({ argon2id: 0, deterministic: 0 });

    // Uma sentinela também listada como determinística continua obrigada ao Argon2id real.
    const both = createDerivationTracker({ argon2idRequired: ['[T4C-03]'], deterministicAllowed: ['[T4C-03]'] });
    expect(() => both.useDeterministic()).toThrow(/não autorizada/);
  });

  it('[T4C-04] an authorised test uses only the deterministic derivation, must derive at least once and returns to Argon2id afterwards', async () => {
    const classification: DerivationClassification = { argon2idRequired: ['[sentinela]'], deterministicAllowed: ['[T4C-04]'] };
    const tracker = createDerivationTracker(classification);
    tracker.useDeterministic();
    const derived = await tracker.derive(input());
    expect(derived).toEqual(await deterministicTestDerive(input()));
    expect(tracker.counts()).toEqual({ argon2id: 0, deterministic: 1 });
    tracker.verifyAndReset(currentTest());
    expect(tracker.mode()).toBe('argon2id');

    const idle = createDerivationTracker(classification);
    idle.useDeterministic();
    expect(() => idle.verifyAndReset(currentTest())).toThrow(/sem derivações/);

    const mixed = createDerivationTracker(classification);
    await mixed.derive(input());
    mixed.useDeterministic();
    await mixed.derive(input());
    expect(() => mixed.verifyAndReset(currentTest())).toThrow(/derivação real num teste determinístico/);

    const reset = createDerivationTracker(classification);
    reset.useDeterministic();
    reset.reset();
    expect(reset.mode()).toBe('argon2id');
  });

  it('[T4C-05] the classification is coherent with the test files: disjoint, existing, applied only where allowed and covering every critical path', () => {
    const files: readonly (readonly [string, DerivationClassification])[] = [
      ['local-sessions.test.ts', LOCAL_SESSIONS_DERIVATION],
      ['local-authentication.test.ts', LOCAL_AUTHENTICATION_DERIVATION],
      ['identity-persistence-gate.test.ts', IDENTITY_GATE_DERIVATION],
      ['installation-recovery.test.ts', INSTALLATION_RECOVERY_DERIVATION],
    ];
    const declaration = /^\s*(?:it(?:\.each\([^)]*\))?\(|\]\)\()'([^']*)'/;
    for (const [file, classification] of files) {
      const lines = readFileSync(path.join(REPOSITORY_ROOT, 'tests', file), 'utf8').split('\n');
      const tests: { title: string; body: string }[] = [];
      lines.forEach((line, index) => {
        const match = declaration.exec(line);
        if (match?.[1] === undefined) return;
        tests.push({ body: '', title: match[1] });
        const current = tests.at(-1);
        if (current !== undefined) current.body = lines.slice(index, index + 400).join('\n');
      });
      tests.forEach((test, index) => {
        const next = tests[index + 1];
        if (next !== undefined) test.body = test.body.slice(0, Math.max(0, test.body.indexOf(`'${next.title}'`)));
      });
      const withMark = (mark: string) => tests.filter((test) => test.title.includes(mark));

      expect(classification.deterministicAllowed.filter((mark) => classification.argon2idRequired.includes(mark)), file).toEqual([]);
      for (const mark of classification.deterministicAllowed) {
        expect(withMark(mark), `${file} ${mark}`).toHaveLength(1);
        expect(withMark(mark)[0]?.body, `${file} ${mark}`).toContain('derivation.useDeterministic();');
      }
      for (const mark of classification.argon2idRequired) {
        expect(withMark(mark).length, `${file} ${mark}`).toBeGreaterThanOrEqual(1);
        for (const test of withMark(mark)) expect(test.body, `${file} ${mark}`).not.toContain('useDeterministic');
      }
      const calls = lines.filter((line) => line.includes('derivation.useDeterministic();')).length;
      expect(calls, file).toBe(classification.deterministicAllowed.length);
    }
    // Percursos críticos com sentinela de Argon2id real (D-246).
    expect(INSTALLATION_RECOVERY_DERIVATION.argon2idRequired).toEqual(expect.arrayContaining(['[R-F02]', '[R-F04]', '[R-F07]']));
    expect(LOCAL_AUTHENTICATION_DERIVATION.argon2idRequired).toContain('authenticates an ACTIVE identity with a valid credential and returns a minimal result');
    expect(IDENTITY_GATE_DERIVATION.argon2idRequired).toEqual(expect.arrayContaining(['[G18]']));
    expect(LOCAL_SESSIONS_DERIVATION.argon2idRequired).toEqual(expect.arrayContaining(['[S02]', '[S28]', '[S35]']));
  });
});

describe('E1.07-PD87 binding of the derivation trackers to the test hooks (RV-02)', () => {
  const classification: DerivationClassification = { argon2idRequired: ['[sentinela]'], deterministicAllowed: ['[T4C-07]'] };

  /** Um teste sintético completo: beginTest (setup) → reset (beforeEach) → corpo → verifyAndReset (afterEach) → endTest (setup). */
  const cycle = async (
    steps: { readonly reset?: 'before' | 'late' | 'never'; readonly verify?: boolean; readonly direct?: number } = {},
    directAllowed: readonly string[] = [],
  ): Promise<readonly string[]> => {
    const guard = createDerivationGuard();
    const tracker = createDerivationTracker(classification, { guard });
    guard.beginTest(currentTest());
    if ((steps.reset ?? 'before') === 'before') tracker.reset();
    tracker.useDeterministic();
    await tracker.derive(input());
    for (let call = 0; call < (steps.direct ?? 0); call += 1) guard.countDirect();
    if (steps.reset === 'late') tracker.reset();
    if (steps.verify ?? true) tracker.verifyAndReset(currentTest());
    return guard.endTest(currentTest(), { directAllowed, expectedTrackers: 1 });
  };

  it('[T4C-07] the guard reports a missing verification, a missing or late reset and direct deterministic derivations', async () => {
    expect(await cycle()).toEqual([]);
    expect((await cycle({ verify: false })).join('\n')).toMatch(/verificação do tracker não executada/);
    expect((await cycle({ reset: 'never' })).join('\n')).toMatch(/tracker não reposto antes do teste/);
    expect((await cycle({ reset: 'late' })).join('\n')).toMatch(/reset\(\) depois de o teste ter começado a derivar/);
    expect((await cycle({ direct: 2 })).join('\n')).toMatch(/derivação determinística fora de um tracker autorizado \(2×\)/);
    expect(await cycle({ direct: 2 }, ['[T4C-07]'])).toEqual([]);

    // PD87-C1 (RV-PD87M-01): sem beginTest a guarda já não fica calada — o teste e cada tracker não
    // começado são problemas; o número de trackers e o contador directo continuam verificados por teste.
    const guard = createDerivationGuard();
    const one = { directAllowed: [], expectedTrackers: 1 };
    expect(guard.endTest(currentTest(), one)).toEqual([
      `beginTest() não executado para este teste (guarda inactiva no beforeEach): ${currentTest()}`,
      `trackers de derivação registados: 0, esperados: 1: ${currentTest()}`,
    ]);
    const tracker = createDerivationTracker(classification, { guard });
    expect(guard.tracked()).toBe(1);
    expect(guard.endTest(currentTest(), one)).toEqual([
      `beginTest() não executado para este teste (guarda inactiva no beforeEach): ${currentTest()}`,
      `tracker não iniciado pela guarda (beginTest() no beforeEach): ${currentTest()}`,
    ]);
    const started = (): void => {
      guard.beginTest(currentTest());
      tracker.reset();
      tracker.verifyAndReset(currentTest());
    };
    started();
    expect(guard.endTest(currentTest(), one)).toEqual([]);
    started();
    expect(guard.endTest(currentTest(), { directAllowed: [], expectedTrackers: 0 }).join('\n')).toMatch(/registados: 1, esperados: 0/);
    started();
    guard.countDirect();
    expect(guard.endTest(currentTest(), one).length).toBe(1);
    started();
    expect(guard.endTest(currentTest(), one)).toEqual([]);

    // Um tracker criado dentro de um teste, sem guarda explícita, é efémero e não fica registado na guarda do ficheiro.
    const before = fileDerivationGuard.tracked();
    createDerivationTracker(classification);
    expect(fileDerivationGuard.tracked()).toBe(before);
  });

  it('[T4C-08] the guard is wired into tests/setup.ts and the four classified files use the file-level tracker', () => {
    // Verificação textual complementar; a activação é verificada por comportamento por [C1-G02]/[C1-G03],
    // por finishFile e, para o afterAll, em processo filho por [C2-P01] (PD87-C2, RV-C1M-05).
    const setup = readFileSync(path.join(REPOSITORY_ROOT, 'tests', 'setup.ts'), 'utf8');
    expect(setup).toMatch(/aroundEach\(async \(runTest, \{ task \}\) => \{\s*fileDerivationGuard\.beginTest\(task\.fullTestName\);/);
    expect(setup).toContain('fileDerivationGuard.endTest(task.fullTestName');
    expect(setup).toContain('CLASSIFIED_DERIVATION_FILES.includes(path.basename(task.file.filepath)) ? 1 : 0');
    expect(setup).toContain('new Error(`ligação do tracker de derivação (PD-87):\\n${problems.join(\'\\n\')}`)');
    expect(setup).toContain('observeFailures(task, guardFailure === undefined ? [] : [guardFailure]);');
    expect(setup).toContain('if (guardFailure !== undefined) throw guardFailure;');
    expect(setup).toContain('...fileDerivationGuard.finishFile(fileExecution(file), RUNTIME_SKIP_ALLOWED),');
    expect(setup).toContain('...unmetFailureReasons(file),');
    const files = [
      ['local-sessions.test.ts', 'LOCAL_SESSIONS_DERIVATION'],
      ['local-authentication.test.ts', 'LOCAL_AUTHENTICATION_DERIVATION'],
      ['identity-persistence-gate.test.ts', 'IDENTITY_GATE_DERIVATION'],
      ['installation-recovery.test.ts', 'INSTALLATION_RECOVERY_DERIVATION'],
    ] as const;
    expect(files.map(([file]) => file)).toEqual(CLASSIFIED_DERIVATION_FILES);
    for (const [file, name] of files) {
      const text = readFileSync(path.join(REPOSITORY_ROOT, 'tests', file), 'utf8');
      // Um único tracker, criado ao nível do describe com a classificação do ficheiro e sem guarda própria.
      expect(text.match(/createDerivationTracker\(/g), file).toHaveLength(1);
      expect(text, file).toContain(`  const derivation = createDerivationTracker(${name});`);
    }
    // O tracker deste ficheiro de testes é o da guarda real: a guarda tem trackers registados só nos ficheiros classificados.
    expect(fileDerivationGuard.tracked()).toBe(0);
  });

  it.fails('[T4C-09] a direct deterministic derivation in a test outside DIRECT_DETERMINISTIC_ALLOWED makes that test fail (guard active)', async () => {
    // PD87-C1 (RV-PD87M-02): só esta razão, e nenhuma outra, conta como a falha esperada.
    expectFailureReasons([
      /^Error: ligação do tracker de derivação \(PD-87\):\nderivação determinística fora de um tracker autorizado \(1×\): .*\[T4C-09\] a direct deterministic derivation[^\n]*$/,
    ]);
    await deterministicTestDerive(input());
  });

  it('[C1-G01] the guard fails a test that was not begun, a test begun before the previous ended, an unbalanced file and a tracker reused across tests', async () => {
    const guard = createDerivationGuard();
    const none = { directAllowed: [], expectedTrackers: 0 };
    expect(guard.endTest('a', none)).toEqual(['beginTest() não executado para este teste (guarda inactiva no beforeEach): a']);
    guard.beginTest('b');
    expect(() => guard.beginTest('c')).toThrow('endTest() não executado para o teste anterior (afterEach da guarda): b');
    expect(guard.endTest('c', none)).toEqual([]);
    guard.beginTest('d');
    expect(guard.endTest('outro', none)).toEqual(['beginTest() não executado para este teste (guarda inactiva no beforeEach): outro']);
    expect(guard.counts()).toEqual({ active: undefined, begun: 3, ended: 3 });
    const ran = (executed: number) => ({ executed, skippedAtRuntime: [] });
    expect(guard.finishFile(ran(3), [])).toEqual([]);
    expect(guard.finishFile(ran(4), [])).toEqual(['testes executados: 4, começados pela guarda: 3, terminados: 3']);
    guard.beginTest('e');
    expect(guard.finishFile(ran(4), [])).toEqual([
      'endTest() não executado para o último teste (desmontagem da guarda): e',
      'testes executados: 4, começados pela guarda: 4, terminados: 3',
    ]);

    // RV-PD87M-06: cada teste começa do zero — um reset() do teste anterior não serve ao seguinte.
    const reused = createDerivationGuard();
    const tracker = createDerivationTracker(classification, { guard: reused });
    const one = { directAllowed: [], expectedTrackers: 1 };
    reused.beginTest('primeiro');
    tracker.reset();
    tracker.verifyAndReset('primeiro');
    expect(reused.endTest('primeiro', one)).toEqual([]);
    reused.beginTest('segundo');
    await tracker.derive(input());
    tracker.verifyAndReset('segundo');
    expect(reused.endTest('segundo', one)).toEqual(['tracker não reposto antes do teste (reset() no beforeEach): segundo']);
    reused.beginTest('terceiro');
    tracker.reset();
    expect(reused.endTest('terceiro', one)).toEqual(['verificação do tracker não executada (verifyAndReset() no afterEach): terceiro']);
  });

  it('[C1-G02] inside a running test, the real guard has begun exactly this test (beforeEach of tests/setup.ts ran)', () => {
    const { active, begun, ended } = fileDerivationGuard.counts();
    expect(active).toBe(currentTest());
    expect(begun).toBe(ended + 1);
  });

  it('[C1-G03] every executed test of this file so far was begun and ended by the real guard (afterEach of tests/setup.ts ran)', ({ task }) => {
    const done = fileExecution(task.file).executed;
    const { begun, ended } = fileDerivationGuard.counts();
    // Os testes já terminados deste ficheiro (com qualquer ordem ou filtro) e o teste em curso.
    expect({ begun, ended }).toEqual({ begun: done + 1, ended: done });
  });
});

describe('E1.07-PD87-C2 runtime skips, file execution and the guard (RV-C1M-01)', () => {
  const none = { directAllowed: [], expectedTrackers: 0 };
  const run = (guard: ReturnType<typeof createDerivationGuard>, name: string, direct = 0): readonly string[] => {
    guard.beginTest(name);
    for (let call = 0; call < direct; call += 1) guard.countDirect();
    return guard.endTest(name, none);
  };

  it('[C2-G01] a test skipped at runtime counts as executed, is accepted only when authorised, and its discarded guard problems are reported', () => {
    // Autorizado e sem problemas: aceite; o ignorado conta como executado (começado e terminado).
    const authorised = createDerivationGuard();
    expect(run(authorised, '[X02] ligação')).toEqual([]);
    expect(run(authorised, 'normal')).toEqual([]);
    expect(authorised.finishFile({ executed: 2, skippedAtRuntime: ['[X02] ligação'] }, ['[X02]'])).toEqual([]);

    // Não autorizado: recusado, mesmo com a contagem certa.
    const unauthorised = createDerivationGuard();
    expect(run(unauthorised, 'crítico')).toEqual([]);
    expect(unauthorised.finishFile({ executed: 1, skippedAtRuntime: ['crítico'] }, ['[X02]'])).toEqual([
      'teste ignorado em execução sem autorização (RUNTIME_SKIP_ALLOWED): crítico',
    ]);

    // Autorizado, mas com um problema da guarda que o Vitest descarta ao marcar o teste `skip`.
    const discarded = createDerivationGuard();
    expect(run(discarded, '[X02] derivou', 1)).toEqual(['derivação determinística fora de um tracker autorizado (1×): [X02] derivou']);
    expect(run(discarded, 'outro', 1)).toHaveLength(1);
    expect(discarded.finishFile({ executed: 2, skippedAtRuntime: ['[X02] derivou'] }, ['[X02]'])).toEqual([
      'problemas da guarda num teste ignorado em execução (descartados pelo Vitest): [X02] derivou\nderivação determinística fora de um tracker autorizado (1×): [X02] derivou',
    ]);
    // Os problemas de um teste não ignorado já foram comunicados pelo próprio teste, e o registo é limpo no fim do ficheiro.
    expect(discarded.finishFile({ executed: 2, skippedAtRuntime: ['[X02] derivou'] }, ['[X02]'])).toEqual([]);

    // Um ignorado em execução que a guarda não começou continua a desequilibrar a contagem.
    const unbalanced = createDerivationGuard();
    expect(run(unbalanced, 'normal')).toEqual([]);
    expect(unbalanced.finishFile({ executed: 2, skippedAtRuntime: ['[X02] sem guarda'] }, ['[X02]'])).toEqual([
      'testes executados: 2, começados pela guarda: 1, terminados: 1',
    ]);
  });

  it('[C2-G02] fileExecution counts finished and runtime-skipped tests, not tests skipped before running; failingTestsRun lists the it.fails that ran', () => {
    const test = (fullTestName: string, mode: string, result?: Readonly<Record<string, unknown>>, fails = false) => ({ fails, fullTestName, mode, result, type: 'test' });
    const file = {
      tasks: [
        test('passou', 'run', { state: 'pass' }),
        test('ignorado em execução', 'skip', { pending: true, state: 'skip' }),
        test('ignorado antes', 'skip', { state: 'skip' }),
        test('filtrado', 'skip'),
        test('por fazer', 'todo'),
        test('em curso', 'run', { state: 'run' }),
        { tasks: [test('negativo', 'run', { state: 'pass' }, true), test('falhou', 'run', { state: 'fail' })], type: 'suite' },
      ],
    } as unknown as RunnerTestFile;
    expect(fileExecution(file)).toEqual({ executed: 4, skippedAtRuntime: ['ignorado em execução'] });
    expect(failingTestsRun(file).map((task) => task.fullTestName)).toEqual(['negativo']);
  });

  it('[C2-G03] inside a running test, the name the guard uses (task.fullTestName) is the name the trackers verify (currentTestName)', ({ task }) => {
    expect(task.fullTestName).toBe(currentTest());
    expect(fileDerivationGuard.counts().active).toBe(currentTest());
  });

  it('[C2-S01] only [X02] may be skipped at runtime, and no Argon2id sentinel can be', () => {
    expect(RUNTIME_SKIP_ALLOWED).toEqual(['[X02]']);
    expect(Object.isFrozen(RUNTIME_SKIP_ALLOWED)).toBe(true);
    const sentinels = [INSTALLATION_RECOVERY_DERIVATION, LOCAL_AUTHENTICATION_DERIVATION, IDENTITY_GATE_DERIVATION, LOCAL_SESSIONS_DERIVATION].flatMap(
      (classification) => classification.argon2idRequired,
    );
    expect(sentinels.length).toBeGreaterThan(0);
    for (const mark of RUNTIME_SKIP_ALLOWED) {
      expect(sentinels.filter((sentinel) => sentinel.includes(mark) || mark.includes(sentinel)), mark).toEqual([]);
    }
  });
});

describe('E1.07-PD65-T4-C1 derivation through the local service', () => {
  let temporary: TemporaryDatabase | undefined;
  const running: ServiceUnderTest[] = [];

  afterEach(async () => {
    // PD87-C2 (PD-57): a base só é apagada depois de parar os serviços e confirmar as ligações fechadas.
    const database = temporary;
    temporary = undefined;
    await stopServicesThenDisposeNow(running.splice(0), { dispose: () => database?.dispose() });
  });

  const storedCredential = (database: SqliteDatabase, userId: string): PasswordHash => {
    const row = database
      .prepare('SELECT algorithm, algorithm_version AS algorithmVersion, memory_kib AS memoryKiB, passes, parallelism, salt, hash FROM password_credentials WHERE user_id = ?')
      .get(userId) as PasswordHash;
    return row;
  };

  it.each([
    { label: 'default (production derivation)', deterministic: false },
    { label: 'deterministic test derivation', deterministic: true },
  ])('[T4C-06] the service derives with the injected function only when asked: $label', async ({ deterministic }) => {
    temporary = createTemporaryDatabase();
    const database = temporary;
    const harness = createServiceUnderTest(serviceConfig(database.filename), undefined, {
      passwordHashing: deterministic ? { derive: deterministicTestDerive, parameters: TEST_HASHING_PARAMETERS } : { parameters: TEST_HASHING_PARAMETERS },
    });
    running.push(harness);
    await harness.service.start();
    const user = newUser();
    await harness.service.identityProvisioning.users.create(user);
    await harness.service.identityProvisioning.credentials.create(user.id, TEST_PASSWORD);

    await expect(harness.service.authentication.authenticate(user.username, TEST_PASSWORD)).resolves.toMatchObject({ ok: true });
    await expect(harness.service.authentication.authenticate(user.username, OTHER_TEST_PASSWORD)).resolves.toMatchObject({ ok: false });
    const stored = inspectDatabase(database.filename, () => database.open(), (connection) => storedCredential(connection, user.id));
    expect(isArgon2idHashOf(stored, TEST_PASSWORD)).toBe(!deterministic);
  });
});
