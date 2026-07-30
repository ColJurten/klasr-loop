import { Inject, Injectable, Optional } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

@Injectable()
export class TokenEncryptionService {
  private readonly key: Buffer;

  constructor(@Optional() @Inject('TOKEN_ENCRYPTION_KEY') key = process.env.TOKEN_ENCRYPTION_KEY ?? '') {
    this.key = parseKey(key);
  }

  encrypt(value: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(value: string): string {
    try {
      const [version, ivRaw, tagRaw, ciphertextRaw] = value.split('.');
      if (version !== VERSION || !ivRaw || !tagRaw || !ciphertextRaw) {
        throw new Error('Invalid token envelope');
      }
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivRaw, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64url').subarray(0, TAG_BYTES));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Token decrypt failed');
    }
  }
}

function parseKey(raw: string): Buffer {
  const direct = Buffer.from(raw, 'base64');
  if (direct.length === 32) return direct;
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes as base64 or 64 hex characters');
}
