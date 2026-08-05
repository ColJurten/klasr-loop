import { afterEach, describe, expect, it, vi } from 'vitest';

describe('service-account acceptance browser authentication', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
  });

  it('adds a staging credentials provider without enabling the local adapter flag', async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: 'true',
      KLASR_LOCAL_MVP: 'false',
    };
    const { authOptions } = await import('../lib/auth');
    const configuredIds = authOptions.providers.map((provider) =>
      'options' in provider && provider.options && 'id' in provider.options ? provider.options.id : provider.id,
    );
    expect(configuredIds).toContain('google-service-account-acceptance');
    expect(configuredIds).not.toContain('local-mvp');
  });

  it('refuses to initialize acceptance authentication in production', async () => {
    process.env = { ...originalEnv, NODE_ENV: 'production', KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: 'true' };
    await expect(import('../lib/auth')).rejects.toThrow('cannot run in production');
  });
});
