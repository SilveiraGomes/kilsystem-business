import { argon2Sync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ARGON2_VERSION,
  assertHashingParameters,
  createPasswordHasher,
  MINIMUM_PASSWORD_HASHING_PARAMETERS,
  PASSWORD_HASHING_PARAMETERS,
  PasswordHashingError,
  type Argon2idDerive,
  type PasswordHash,
} from '../services/local-api/src/authentication/password-hashing';
import { deferred, OTHER_TEST_PASSWORD, TEST_HASHING_PARAMETERS, TEST_PASSWORD } from './support/authentication-fixtures';

const testHasher = (options: Parameters<typeof createPasswordHasher>[0] = {}) =>
  createPasswordHasher({ parameters: TEST_HASHING_PARAMETERS, ...options });

const expectHashingError = async (action: () => Promise<unknown>, reason: string): Promise<void> => {
  await expect(action()).rejects.toMatchObject({ name: PasswordHashingError.name, reason });
};

describe('Password hashing (E1.07-B, D-090)', () => {
  describe('production configuration', () => {
    it('uses Argon2id with the second RFC 9106 recommendation, above the OWASP minimum', async () => {
      expect(PASSWORD_HASHING_PARAMETERS).toEqual({ memoryKiB: 65536, parallelism: 4, passes: 3 });
      expect(MINIMUM_PASSWORD_HASHING_PARAMETERS).toEqual({ memoryKiB: 19456, parallelism: 1, passes: 2 });

      const hashed = await createPasswordHasher().hash(TEST_PASSWORD);

      expect(hashed).toMatchObject({
        algorithm: 'argon2id',
        algorithmVersion: ARGON2_VERSION,
        memoryKiB: 65536,
        parallelism: 4,
        passes: 3,
      });
      expect(hashed.salt).toHaveLength(16);
      expect(hashed.hash).toHaveLength(32);
    });

    it('matches the native Node.js Argon2id derivation for the stored salt and parameters', async () => {
      const hashed = await testHasher().hash(TEST_PASSWORD);
      const expected = argon2Sync('argon2id', {
        memory: hashed.memoryKiB,
        message: Buffer.from(TEST_PASSWORD, 'utf8'),
        nonce: hashed.salt,
        parallelism: hashed.parallelism,
        passes: hashed.passes,
        tagLength: hashed.hash.length,
      });

      expect(hashed.hash.equals(expected)).toBe(true);
    });
  });

  describe('hashing and verification', () => {
    it('verifies the correct password and rejects any other', async () => {
      const hasher = testHasher();
      const hashed = await hasher.hash(TEST_PASSWORD);

      await expect(hasher.verify(TEST_PASSWORD, hashed)).resolves.toBe(true);
      for (const wrong of [OTHER_TEST_PASSWORD, TEST_PASSWORD.toUpperCase(), `${TEST_PASSWORD} `, TEST_PASSWORD.slice(0, -1)]) {
        await expect(hasher.verify(wrong, hashed)).resolves.toBe(false);
      }
    });

    it('produces different hashes with individual random salts for equal passwords', async () => {
      const hasher = testHasher();
      const [first, second] = await Promise.all([hasher.hash(TEST_PASSWORD), hasher.hash(TEST_PASSWORD)]);

      expect(first.salt.equals(second.salt)).toBe(false);
      expect(first.hash.equals(second.hash)).toBe(false);
      await expect(hasher.verify(TEST_PASSWORD, first)).resolves.toBe(true);
      await expect(hasher.verify(TEST_PASSWORD, second)).resolves.toBe(true);
    });

    it('does not truncate long passwords', async () => {
      const hasher = testHasher();
      const base = 'x'.repeat(255);
      const hashed = await hasher.hash(`${base}A`);

      await expect(hasher.verify(`${base}A`, hashed)).resolves.toBe(true);
      await expect(hasher.verify(`${base}B`, hashed)).resolves.toBe(false);
    });

    it('rejects malformed or tampered stored hashes', async () => {
      const hasher = testHasher();
      const hashed = await hasher.hash(TEST_PASSWORD);
      const malformed: readonly PasswordHash[] = [
        { ...hashed, algorithm: 'argon2i' as never },
        { ...hashed, algorithmVersion: 16 },
        { ...hashed, memoryKiB: 1024 },
        { ...hashed, memoryKiB: 4_000_000 },
        { ...hashed, passes: 0 },
        { ...hashed, parallelism: 64 },
        { ...hashed, salt: Buffer.alloc(8) },
        { ...hashed, hash: Buffer.alloc(16) },
        { ...hashed, hash: 'texto' as never },
      ];

      for (const stored of malformed) await expectHashingError(() => hasher.verify(TEST_PASSWORD, stored), 'malformed-hash');
      const flipped = Buffer.from(hashed.hash);
      flipped[0] = (flipped[0] ?? 0) ^ 0xff;
      await expect(hasher.verify(TEST_PASSWORD, { ...hashed, hash: flipped })).resolves.toBe(false);
    });

    it('reports whether a credential uses outdated parameters', async () => {
      const hasher = testHasher();
      const current = await hasher.hash(TEST_PASSWORD);

      expect(hasher.needsRehash(current)).toBe(false);
      expect(hasher.needsRehash({ ...current, passes: 4 })).toBe(true);
      expect(createPasswordHasher().needsRehash(current)).toBe(true);
    });

    it('returns only the derivation, never the password', async () => {
      const hashed = await testHasher().hash(TEST_PASSWORD);

      expect(Object.keys(hashed).sort()).toEqual([
        'algorithm',
        'algorithmVersion',
        'hash',
        'memoryKiB',
        'parallelism',
        'passes',
        'salt',
      ]);
      expect(JSON.stringify(hashed)).not.toContain(TEST_PASSWORD);
      expect(hashed.hash.toString('utf8')).not.toContain(TEST_PASSWORD);
    });
  });

  describe('parameter validation', () => {
    it.each([
      ['memory below the OWASP minimum', { ...MINIMUM_PASSWORD_HASHING_PARAMETERS, memoryKiB: 8192 }],
      ['a single pass at the minimum memory', { ...MINIMUM_PASSWORD_HASHING_PARAMETERS, passes: 1 }],
      ['excessive memory', { ...PASSWORD_HASHING_PARAMETERS, memoryKiB: 2_000_000 }],
      ['excessive parallelism', { ...PASSWORD_HASHING_PARAMETERS, parallelism: 32 }],
      ['non-integer passes', { ...PASSWORD_HASHING_PARAMETERS, passes: 2.5 }],
    ])('refuses %s', (_label, parameters) => {
      expect(() => assertHashingParameters(parameters)).toThrow(PasswordHashingError);
      expect(() => createPasswordHasher({ parameters })).toThrow('invalid-parameters');
    });

    it('refuses invalid concurrency limits', () => {
      expect(() => testHasher({ maxConcurrent: 0 })).toThrow('invalid-parameters');
      expect(() => testHasher({ maxQueued: -1 })).toThrow('invalid-parameters');
    });
  });

  describe('concurrency limit', () => {
    it('runs at most the configured number of derivations and refuses an overflowing queue', async () => {
      const gate = deferred();
      let active = 0;
      let peak = 0;
      const derive: Argon2idDerive = async ({ tagLength }) => {
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
        return Buffer.alloc(tagLength, 1);
      };
      const hasher = testHasher({ derive, maxConcurrent: 2, maxQueued: 3 });

      const accepted = Array.from({ length: 5 }, () => hasher.hash(TEST_PASSWORD));
      await expectHashingError(() => hasher.hash(TEST_PASSWORD), 'busy');
      await Promise.resolve();
      expect(active).toBe(2);
      gate.resolve();
      await Promise.all(accepted);

      expect(peak).toBe(2);
      expect(active).toBe(0);
    });
  });
});
