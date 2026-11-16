import { describe, expect, it } from 'vitest';

import {
  createCommonPasswordList,
  normalizePasswordInput,
  PASSWORD_MAX_INPUT_UNITS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordPolicyError,
  preparePassword,
  type PasswordPolicyViolation,
} from '../packages/shared-types/src/index';
import { TEST_PASSWORD, UNICODE_TEST_PASSWORD } from './support/authentication-fixtures';

const USERNAME = 'operador.teste';

const violationOf = (action: () => unknown): PasswordPolicyViolation | undefined => {
  try {
    action();
  } catch (error) {
    if (error instanceof PasswordPolicyError) return error.violation;
    throw error;
  }
  return undefined;
};

/** Texto com `count` code points distintos o suficiente para não ser uma repetição. */
const ofLength = (count: number): string =>
  Array.from({ length: count }, (_, index) => String.fromCodePoint(0x61 + (index % 26))).join('');

describe('Password policy (E1.07-B, D-091)', () => {
  describe('length limits', () => {
    it('documents the minimum of 15 and the maximum of 256 code points', () => {
      expect([PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MAX_INPUT_UNITS]).toEqual([15, 256, 1024]);
    });

    it.each([
      [14, 'too-short'],
      [15, undefined],
      [64, undefined],
      [256, undefined],
      [257, 'too-long'],
    ] as const)('applies the length rule to %i code points', (length, violation) => {
      expect(violationOf(() => preparePassword(ofLength(length), { username: USERNAME }))).toBe(violation);
    });

    it('counts code points, not UTF-16 units, so astral characters count once', () => {
      const emoji = '😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰';
      expect(emoji.length).toBe(30);

      expect(preparePassword(emoji, { username: USERNAME })).toBe(emoji);
      expect(violationOf(() => preparePassword(emoji.slice(0, 28), { username: USERNAME }))).toBe('too-short');
    });

    it('rejects excessive raw input before normalising it', () => {
      expect(violationOf(() => normalizePasswordInput('a'.repeat(PASSWORD_MAX_INPUT_UNITS + 1)))).toBe('too-long');
    });
  });

  describe('characters and normalisation', () => {
    it('keeps spaces, case and Unicode exactly, with no trimming or truncation', () => {
      const spaced = '  Frase COM espaços nas pontas  ';
      expect(preparePassword(spaced, { username: USERNAME })).toBe(spaced);
      expect(preparePassword(UNICODE_TEST_PASSWORD, { username: USERNAME })).toBe(UNICODE_TEST_PASSWORD);
      const longest = ofLength(PASSWORD_MAX_LENGTH);
      expect(preparePassword(longest, { username: USERNAME })).toHaveLength(PASSWORD_MAX_LENGTH);
    });

    it('normalises to NFC so that composed and decomposed forms are equal', () => {
      const composed = 'café com açúcar e canela';
      const decomposed = composed.normalize('NFD');
      expect(decomposed).not.toBe(composed);

      expect(preparePassword(decomposed, { username: USERNAME })).toBe(composed);
      expect(normalizePasswordInput(decomposed)).toBe(normalizePasswordInput(composed));
    });

    it.each([
      ['NUL', 'frase de teste\u0000longa'],
      ['tab', 'frase de teste\tlonga'],
      ['DEL', 'frase de teste\u007flonga'],
    ])('rejects the control character %s', (_label, value) => {
      expect(violationOf(() => preparePassword(value, { username: USERNAME }))).toBe('control-character');
    });

    it('rejects malformed Unicode and non-text values', () => {
      expect(violationOf(() => normalizePasswordInput('frase de teste \uD800 longa'))).toBe('malformed-unicode');
      expect(violationOf(() => normalizePasswordInput(123456789012345))).toBe('not-text');
      expect(violationOf(() => normalizePasswordInput(undefined))).toBe('not-text');
    });
  });

  describe('creation rules', () => {
    it('imposes no composition rules', () => {
      for (const password of ['apenas letras minusculas', '123456789012345678', 'ESPAÇOS E MAIÚSCULAS']) {
        expect(preparePassword(password, { username: USERNAME })).toBe(password);
      }
    });

    it('rejects a single repeated character and the username itself', () => {
      expect(violationOf(() => preparePassword('a'.repeat(20), { username: USERNAME }))).toBe('single-repeated-character');
      expect(violationOf(() => preparePassword('Operador.Teste.Longo', { username: 'operador.teste.longo' }))).toBe(
        'matches-username',
      );
    });

    it('checks a local common-password list against the whole password, ignoring case', () => {
      const common = createCommonPasswordList(['palavra-passe-comum-123']);

      expect(violationOf(() => preparePassword('PALAVRA-PASSE-COMUM-123', { commonPasswords: common, username: USERNAME }))).toBe(
        'common-password',
      );
      expect(
        preparePassword('prefixo palavra-passe-comum-123', { commonPasswords: common, username: USERNAME }),
      ).toBe('prefixo palavra-passe-comum-123');
    });

    it('accepts already stored short secrets only through the verification path', () => {
      expect(normalizePasswordInput('curta')).toBe('curta');
      expect(violationOf(() => preparePassword('curta', { username: USERNAME }))).toBe('too-short');
    });

    it('explains the violated rule without echoing the password', () => {
      const secret = 'Segredo Privado Muito Longo \u0000';
      try {
        preparePassword(secret, { username: USERNAME });
        throw new Error('Era esperada uma recusa.');
      } catch (error) {
        expect(error).toBeInstanceOf(PasswordPolicyError);
        expect((error as Error).message).toContain('control-character');
        expect((error as Error).message).not.toContain('Segredo');
      }
      expect(preparePassword(TEST_PASSWORD, { username: USERNAME })).toBe(TEST_PASSWORD);
    });
  });
});
