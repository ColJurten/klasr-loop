import { randomBytes } from 'crypto';
import { decryptToken, encryptToken } from './token-cipher';

describe('token-cipher', () => {
  const ORIGINAL_KEY = process.env.TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
    }
  });

  it('decrypts back to the original plaintext', () => {
    const encrypted = encryptToken('refresh-token-value');
    expect(decryptToken(encrypted)).toBe('refresh-token-value');
  });

  it('never stores the plaintext token in the encrypted payload', () => {
    const encrypted = encryptToken('super-secret-refresh-token');
    expect(encrypted).not.toContain('super-secret-refresh-token');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const first = encryptToken('same-value');
    const second = encryptToken('same-value');
    expect(first).not.toBe(second);
  });

  it('rejects a tampered payload (GCM auth tag check)', () => {
    const encrypted = encryptToken('refresh-token-value');
    const [iv, authTag, ciphertext] = encrypted.split('.');
    const tamperedCiphertext = Buffer.from(ciphertext, 'base64');
    tamperedCiphertext[0] ^= 0xff;
    const tampered = [iv, authTag, tamperedCiphertext.toString('base64')].join('.');
    expect(() => decryptToken(tampered)).toThrow();
  });

  it('throws when TOKEN_ENCRYPTION_KEY is missing or the wrong length', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken('value')).toThrow(/32-byte/);
  });
});
