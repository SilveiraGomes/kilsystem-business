import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { SqliteDatabase } from '../packages/database/src/index';
import { createPasswordHasher, type PasswordHash } from '../services/local-api/src/authentication/password-hashing';
import {
  IDENTITY_GATE_DERIVATION,
  INSTALLATION_RECOVERY_DERIVATION,
  LOCAL_AUTHENTICATION_DERIVATION,
  LOCAL_SESSIONS_DERIVATION,
} from './support/argon2-test-classification';
import { OTHER_TEST_PASSWORD, TEST_HASHING_PARAMETERS, TEST_PASSWORD } from './support/authentication-fixtures';
import { newUser } from './support/identity-fixtures';
import { createServiceUnderTest, inspectDatabase, REPOSITORY_ROOT, serviceConfig, type ServiceUnderTest } from './support/local-service-harness';
import { createTemporaryDatabase, type TemporaryDatabase } from './support/sqlite-harness';
import {
  createDerivationTracker,
  deterministicTestDerive,
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

describe('E1.07-PD65-T4-C1 derivation through the local service', () => {
  let temporary: TemporaryDatabase | undefined;
  const running: ServiceUnderTest[] = [];

  afterEach(async () => {
    for (const harness of running.splice(0)) await harness.service.stop();
    temporary?.dispose();
    temporary = undefined;
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
