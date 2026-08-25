// @vitest-environment node
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));

import { getServerSession } from 'next-auth';

const session = { user: { name: 'Camille', email: 'camille@example.test', organizationId: 'org_session', membershipId: 'mem_1', role: 'ADMIN' } };

interface UpstreamReply { status: number; body: string; contentType?: string }
let reply: UpstreamReply = { status: 200, body: '{"configured":false}' };
let server: Server;
let receivedTenantPaths: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    receivedTenantPaths.push(request.url ?? '');
    response.writeHead(reply.status, { 'content-type': reply.contentType ?? 'application/json' });
    response.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  process.env.API_URL = `http://127.0.0.1:${port}/api/v1`;
  process.env.INTERNAL_API_SECRET = 'bff-regression-secret';
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

beforeEach(() => {
  vi.mocked(getServerSession).mockResolvedValue(session as never);
  receivedTenantPaths = [];
});

/** Drives the real BFF route over a real socket: no fetch mock, no interception. */
async function callSettingsRoute(upstream: UpstreamReply): Promise<{ status: number; payload: Record<string, unknown>; raw: string }> {
  reply = upstream;
  const { GET } = await import('@/app/api/llm-settings/route');
  const response = await GET();
  const raw = await response.text();
  return { status: response.status, payload: JSON.parse(raw) as Record<string, unknown>, raw };
}

describe('llm-settings BFF surfaces only bounded upstream error text', () => {
  it('passes a safe upstream success through unchanged and never sends a client tenant id', async () => {
    const { status, payload } = await callSettingsRoute({ status: 200, body: JSON.stringify({ configured: true, provider: 'openai-compatible', model: 'fixture-z' }) });

    expect(status).toBe(200);
    expect(payload).toEqual({ configured: true, provider: 'openai-compatible', model: 'fixture-z' });
    expect(receivedTenantPaths).toEqual(['/api/v1/organizations/org_session/llm-settings']);
  });

  it('keeps the flat Nest {code,message} French feedback and its status', async () => {
    const { status, payload } = await callSettingsRoute({ status: 400, body: JSON.stringify({ code: 'invalid_key', message: 'Clé API refusée par le fournisseur.' }) });

    expect(status).toBe(400);
    expect(payload).toEqual({ error: 'Clé API refusée par le fournisseur.' });
  });

  it('extracts the string from a nested Nest {message:{code,message}} body', async () => {
    const { status, payload } = await callSettingsRoute({
      status: 400,
      body: JSON.stringify({ statusCode: 400, message: { code: 'model_incompatible', message: 'Le modèle sélectionné est incompatible.' } }),
    });

    expect(status).toBe(400);
    expect(payload).toEqual({ error: 'Le modèle sélectionné est incompatible.' });
  });

  it('falls back to a generic status message for array, deeply nested and non-string values', async () => {
    await expect(callSettingsRoute({ status: 400, body: JSON.stringify({ message: ['apiKey should not be empty', 'model must be a string'] }) }))
      .resolves.toMatchObject({ status: 400, payload: { error: 'API error 400' } });
    await expect(callSettingsRoute({ status: 400, body: JSON.stringify({ message: { code: 'x', message: { deep: 'value' } } }) }))
      .resolves.toMatchObject({ payload: { error: 'API error 400' } });
    await expect(callSettingsRoute({ status: 400, body: JSON.stringify({ message: 42, error: { code: 7 } }) }))
      .resolves.toMatchObject({ payload: { error: 'API error 400' } });
    await expect(callSettingsRoute({ status: 400, body: JSON.stringify([{ message: 'array root' }]) }))
      .resolves.toMatchObject({ payload: { error: 'API error 400' } });
  });

  it('falls back for oversized messages, oversized bodies and malformed bodies', async () => {
    await expect(callSettingsRoute({ status: 400, body: JSON.stringify({ message: 'z'.repeat(301) }) }))
      .resolves.toMatchObject({ payload: { error: 'API error 400' } });
    await expect(callSettingsRoute({ status: 400, body: JSON.stringify({ message: { code: 'c', message: 'y'.repeat(20_000) } }) }))
      .resolves.toMatchObject({ payload: { error: 'API error 400' } });
    await expect(callSettingsRoute({ status: 502, body: '<html><body>upstream gateway page</body></html>', contentType: 'text/html' }))
      .resolves.toMatchObject({ status: 502, payload: { error: 'API error 502' } });
    await expect(callSettingsRoute({ status: 400, body: '' }))
      .resolves.toMatchObject({ payload: { error: 'API error 400' } });
  });

  it('rejects messages carrying control characters that could forge log or UI lines', async () => {
    const injected = ['Clé refusée.', 'x-internal-secret: leaked'].join(String.fromCharCode(10));

    await expect(callSettingsRoute({ status: 400, body: JSON.stringify({ message: injected }) }))
      .resolves.toMatchObject({ payload: { error: 'API error 400' } });
  });

  it('never forwards credential material that an upstream body carries alongside the message', async () => {
    const { raw } = await callSettingsRoute({
      status: 400,
      body: JSON.stringify({
        message: { code: 'invalid_key', message: 'Clé API refusée par le fournisseur.' },
        apiKey: 'synthetic-fixture-token',
        encryptedApiKey: 'v1:synthetic-ciphertext-envelope',
        upstreamBody: { prompt: 'document excerpt', choices: ['secret content'] },
      }),
    });

    expect(raw).toContain('Clé API refusée par le fournisseur.');
    expect(raw).not.toContain('synthetic-fixture-token');
    expect(raw).not.toContain('synthetic-ciphertext-envelope');
    expect(raw).not.toContain('document excerpt');
  });
});
