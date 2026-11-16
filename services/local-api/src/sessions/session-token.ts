import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/*
 * Tokens de sessão opacos (E1.07-C, D-113): 32 bytes do gerador criptográfico do Node.js,
 * codificados em Base64URL sem preenchimento (43 caracteres). Só o digest SHA-256 dos 32 bytes é
 * persistido; o token é devolvido uma única vez, na emissão, e nunca é registado nem guardado.
 * Não são UUID, JWT nem tokens de renovação.
 */

export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TOKEN_LENGTH = 43;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const digestOf = (raw: Buffer): Buffer => createHash('sha256').update(raw).digest();

export interface GeneratedSessionToken {
  readonly token: string;
  readonly digest: Buffer;
}

export const generateSessionToken = (): GeneratedSessionToken => {
  const raw = randomBytes(SESSION_TOKEN_BYTES);
  return Object.freeze({ digest: digestOf(raw), token: raw.toString('base64url') });
};

/**
 * Digest de um token bem formado; `undefined` para qualquer outro valor (tipo, comprimento,
 * alfabeto ou codificação não canónica). Não lança e não reproduz o valor recebido.
 */
export const digestSessionToken = (value: unknown): Buffer | undefined => {
  if (typeof value !== 'string' || value.length !== SESSION_TOKEN_LENGTH || !TOKEN_PATTERN.test(value)) {
    return undefined;
  }
  const raw = Buffer.from(value, 'base64url');
  if (raw.length !== SESSION_TOKEN_BYTES || raw.toString('base64url') !== value) return undefined;
  return digestOf(raw);
};

/** Comparação em tempo constante de dois digests. */
export const sameDigest = (left: Buffer, right: Buffer): boolean =>
  left.length === right.length && timingSafeEqual(left, right);
