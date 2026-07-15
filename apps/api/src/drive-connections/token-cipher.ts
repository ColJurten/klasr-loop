import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts a Drive refresh token at rest (invariant: never store OAuth
 * secrets in plaintext). Key comes from TOKEN_ENCRYPTION_KEY (validated by
 * configValidationSchema — base64, 32 bytes after decoding).
 */
export function encryptToken(plainToken: string): string {
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainToken, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((buf) => buf.toString('base64')).join('.');
}

export function decryptToken(encryptedPayload: string): string {
  const key = loadKey();
  const [ivB64, authTagB64, encryptedB64] = encryptedPayload.split('.');
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error('Malformed encrypted token payload');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function loadKey(): Buffer {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}
