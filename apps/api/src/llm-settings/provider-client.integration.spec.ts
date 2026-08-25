import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { resolve } from 'node:path';
import { ProviderClientService } from './provider-client.service';

describe('networked OpenAI-compatible provider fixture', () => {
  let fixture: ChildProcessWithoutNullStreams; let baseUrl: string;
  beforeAll(async () => {
    fixture = spawn(process.execPath, [resolve(process.cwd(), '../../scripts/byok-provider-fixture.mjs')], { env: { ...process.env, BYOK_FIXTURE_AUTH: 'Bearer synthetic-fixture-token' } });
    const port = await new Promise<string>((resolvePort, reject) => { fixture.stdout.once('data', (data) => resolvePort(String(data).trim())); fixture.once('error', reject); });
    baseUrl = `http://127.0.0.1:${port}/v1`;
  });
  afterAll(() => { fixture.kill('SIGTERM'); });

  it('discovers sorted nonempty models and validates through the real socket', async () => {
    const client = new ProviderClientService(); const config = { provider: 'openai-compatible' as const, apiKey: 'synthetic-fixture-token', baseUrl };
    await expect(client.discover(config)).resolves.toEqual(['fixture-a', 'fixture-z']);
    await expect(client.validate({ ...config, model: 'fixture-z' })).resolves.toBeUndefined();
    const stats = await fetch(baseUrl.replace('/v1', '/stats')).then((response) => response.json()) as { authorized: number; methods: Record<string, number>; models: Record<string, number> };
    expect(stats).toMatchObject({ authorized: 2, methods: { GET: 2, POST: 1 }, models: { 'fixture-z': 1 } });
  });

  it('maps rejected authorization and an inaccessible model without response disclosure', async () => {
    const client = new ProviderClientService();
    await expect(client.discover({ provider: 'openai-compatible', apiKey: 'synthetic-wrong-token', baseUrl })).rejects.toThrow('provider_unauthorized');
    await expect(client.validate({ provider: 'openai-compatible', apiKey: 'synthetic-fixture-token', baseUrl, model: 'fixture-missing' })).rejects.toThrow('provider_model_not_found');
  });

  it('separates a refused selected model from an unavailable endpoint', async () => {
    const client = new ProviderClientService(); const config = { provider: 'openai-compatible' as const, apiKey: 'synthetic-fixture-token', baseUrl };
    await expect(client.validate({ ...config, model: 'fixture-legacy' })).rejects.toThrow('provider_model_incompatible');
    await expect(client.validate({ ...config, model: 'fixture-unprocessable' })).rejects.toThrow('provider_model_incompatible');
    // The same 400 during discovery stays an endpoint problem instead of blaming the model.
    const refusing = { ...config, baseUrl: baseUrl.replace('/v1', '/refuse/v1') };
    await expect(client.discover(refusing)).rejects.toThrow('provider_unavailable_400');
    await expect(client.validate({ ...refusing, model: 'fixture-z' })).rejects.toThrow('provider_model_incompatible');
  });

  it('allows loopback only in explicit local or test modes', async () => {
    const nodeEnv = process.env.NODE_ENV; const localMvp = process.env.KLASR_LOCAL_MVP;
    try {
      process.env.NODE_ENV = 'development'; delete process.env.KLASR_LOCAL_MVP;
      await expect(new ProviderClientService().endpoint({ provider: 'openai-compatible', apiKey: 'synthetic', baseUrl })).rejects.toThrow('provider_unsafe_endpoint');
      process.env.KLASR_LOCAL_MVP = 'true';
      await expect(new ProviderClientService().endpoint({ provider: 'openai-compatible', apiKey: 'synthetic', baseUrl })).resolves.toBe(baseUrl);
    } finally {
      process.env.NODE_ENV = nodeEnv;
      if (localMvp === undefined) delete process.env.KLASR_LOCAL_MVP; else process.env.KLASR_LOCAL_MVP = localMvp;
    }
  });

  it.each([
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:172.16.0.1', '::ffff:192.168.0.1',
    '100.64.0.1', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
  ])('rejects special or mapped address %s outside the explicit local gate', async (address) => {
    const nodeEnv = process.env.NODE_ENV; const localMvp = process.env.KLASR_LOCAL_MVP;
    process.env.NODE_ENV = 'production'; delete process.env.KLASR_LOCAL_MVP;
    process.env.KLASR_LLM_ALLOWED_ORIGINS = `https://${address.includes(':') ? `[${address}]` : address}`;
    try {
      await expect(new ProviderClientService().endpoint({ provider: 'openai-compatible', apiKey: 'synthetic', baseUrl: `https://${address.includes(':') ? `[${address}]` : address}/v1` })).rejects.toThrow('provider_unsafe_endpoint');
    } finally { process.env.NODE_ENV = nodeEnv; process.env.KLASR_LOCAL_MVP = localMvp; delete process.env.KLASR_LLM_ALLOWED_ORIGINS; }
  });
});
