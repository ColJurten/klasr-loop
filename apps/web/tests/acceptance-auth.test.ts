import { afterEach, describe, expect, it, vi } from 'vitest';

describe('service-account acceptance browser authentication', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
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

  it('onboards the staging acceptance session as a user-scoped Google connection', async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: 'true',
      KLASR_LOCAL_MVP: 'false',
    };
    const request = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ userId: 'user_1', organizationId: 'org_1', membershipId: 'membership_1', role: 'ADMIN' }),
    });
    vi.stubGlobal('fetch', request);
    const { authOptions } = await import('../lib/auth');

    await authOptions.callbacks!.jwt!({
      token: {},
      user: { id: 'acceptance', email: 'google-staging-acceptance@klasr.test' },
      account: { provider: 'google-service-account-acceptance', type: 'credentials', providerAccountId: 'acceptance' },
      profile: undefined,
      trigger: 'signIn',
      isNewUser: false,
    });

    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({
      provider: 'google',
      emailVerified: true,
      providerAccountId: 'acceptance',
      refreshToken: 'service-account-acceptance',
      scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive'],
    });
  });

  it('keeps the internal local credentials adapter verified without trusting external providers', async () => {
    process.env = { ...originalEnv, NODE_ENV: 'test', KLASR_LOCAL_MVP: 'true' };
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ userId: 'user', organizationId: 'org', membershipId: 'membership', role: 'ADMIN' }) });
    vi.stubGlobal('fetch', request);
    const { authOptions } = await import('../lib/auth');

    await authOptions.callbacks!.jwt!({ token: {}, user: { id: 'local', email: 'local@klasr.test' }, account: { provider: 'local-mvp', type: 'credentials', providerAccountId: 'local' }, profile: undefined, trigger: 'signIn', isNewUser: false });

    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ provider: 'local-mvp', emailVerified: true });
  });

  it.each([
    ['azure-ad', 'oauth', { email_verified: true, preferred_username: 'owner@example.com', email: 'owner@example.com' }],
    ['future-provider', 'oauth', { email_verified: true, email: 'owner@example.com' }],
    ['future-credentials', 'credentials', undefined],
  ])('denies ownership from untrusted provider %s', async (provider, type, profile) => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', request);
    const { authOptions } = await import('../lib/auth');

    await expect(authOptions.callbacks!.jwt!({ token: {}, user: { id: 'external', email: 'owner@example.com' }, account: { provider, type, providerAccountId: 'external' }, profile, trigger: 'signIn', isNewUser: false })).rejects.toThrow('Provider cannot verify email ownership');
    expect(request).not.toHaveBeenCalled();
  });

  it('accepts Google only with its explicit email_verified signal', async () => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ userId: 'user', organizationId: 'org', membershipId: 'membership', role: 'ADMIN' }) });
    vi.stubGlobal('fetch', request);
    const { authOptions } = await import('../lib/auth');

    await authOptions.callbacks!.jwt!({ token: {}, user: { id: 'google', email: 'owner@example.com' }, account: { provider: 'google', type: 'oauth', providerAccountId: 'google' }, profile: { email_verified: true }, trigger: 'signIn', isNewUser: false });

    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ provider: 'google', emailVerified: true });
  });

  it.each([false, undefined, 'true'])('denies Google email_verified shape %p', async (email_verified) => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const { authOptions } = await import('../lib/auth');

    await expect(authOptions.callbacks!.jwt!({ token: {}, user: { id: 'google', email: 'owner@example.com' }, account: { provider: 'google', type: 'oauth', providerAccountId: 'google' }, profile: { email_verified }, trigger: 'signIn', isNewUser: false })).rejects.toThrow('Provider cannot verify email ownership');
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses to initialize acceptance authentication in production', async () => {
    process.env = { ...originalEnv, NODE_ENV: 'production', KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: 'true' };
    await expect(import('../lib/auth')).rejects.toThrow('cannot run in production');
  });
});
