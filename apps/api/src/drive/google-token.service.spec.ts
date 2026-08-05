import { ConfigService } from '@nestjs/config';
import { GoogleTokenService } from './google-token.service';

describe('GoogleTokenService service-account acceptance branch', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: 'test' };
    global.fetch = jest.fn() as never;
  });

  afterAll(() => { process.env = originalEnv; });

  it('exchanges a signed JWT without reading the tenant OAuth connection', async () => {
    process.env.KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT = 'true';
    process.env.KLASR_GOOGLE_SERVICE_ACCOUNT_FILE = '/opaque/credential.json';
    const connections = { findByOrganization: jest.fn() };
    const service = new GoogleTokenService(connections as never, { decrypt: jest.fn() } as never, new ConfigService());
    const testService = service as unknown as { readCredential(path: string): string; signAssertion(input: string, key: string): string };
    jest.spyOn(testService, 'readCredential').mockImplementation((path: string) => {
      expect(path).toBe('/opaque/credential.json');
      return JSON.stringify({
          type: 'service_account',
          client_email: 'acceptance@example.invalid',
          private_key: 'test-key',
          token_uri: 'https://oauth2.googleapis.com/token',
      });
    });
    jest.spyOn(testService, 'signAssertion').mockReturnValue('signed-assertion');
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ access_token: 'opaque-token' }) });

    await expect(service.getAccessToken('org_1')).resolves.toBe('opaque-token');
    expect(connections.findByOrganization).not.toHaveBeenCalled();
    const request = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(request.body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(request.body.get('assertion')).toMatch(/\.signed-assertion$/);
  });

  it('refuses acceptance service-account mode in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT = 'true';
    process.env.KLASR_GOOGLE_SERVICE_ACCOUNT_FILE = '/opaque/credential.json';
    const service = new GoogleTokenService({} as never, {} as never, new ConfigService());
    await expect(service.getAccessToken('org_1')).rejects.toThrow('cannot run in production');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
