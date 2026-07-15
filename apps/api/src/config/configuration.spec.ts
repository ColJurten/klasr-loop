import { randomBytes } from 'crypto';
import { configValidationSchema } from './configuration';

const VALID_ENV = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/klasr',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

describe('configValidationSchema — TOKEN_ENCRYPTION_KEY', () => {
  it('accepts a base64-encoded 32-byte key', () => {
    const { error } = configValidationSchema.validate(VALID_ENV);
    expect(error).toBeUndefined();
  });

  it('rejects a key that decodes to the wrong byte length', () => {
    const { error } = configValidationSchema.validate({
      ...VALID_ENV,
      TOKEN_ENCRYPTION_KEY: randomBytes(16).toString('base64'),
    });
    expect(error?.message).toMatch(/32-byte/);
  });

  it('rejects a missing key at boot rather than failing later at first use', () => {
    const { error } = configValidationSchema.validate({
      DATABASE_URL: VALID_ENV.DATABASE_URL,
    });
    expect(error).toBeDefined();
  });
});
