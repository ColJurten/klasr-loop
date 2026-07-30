import { TokenEncryptionService } from './token-encryption.service';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('TokenEncryptionService', () => {
  it('round-trips refresh tokens without returning the raw value', () => {
    const service = new TokenEncryptionService(KEY);

    const encrypted = service.encrypt('sensitive-fixture-value');

    expect(encrypted).not.toContain('sensitive-fixture-value');
    expect(service.decrypt(encrypted)).toBe('sensitive-fixture-value');
  });

  it('fails closed when ciphertext is tampered with', () => {
    const service = new TokenEncryptionService(KEY);
    const encrypted = service.encrypt('sensitive-fixture-value');

    expect(() => service.decrypt(`${encrypted.slice(0, -2)}aa`)).toThrow('Token decrypt failed');
  });
});
