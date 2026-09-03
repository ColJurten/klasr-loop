// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  process.env.INTERNAL_API_SECRET = 'internal-test-secret';
  process.env.API_URL = 'http://api.test/api/v1';
  process.env.NEXTAUTH_URL = 'http://app.test';
});

it.each([undefined, 'http://evil.test'])('rejects a missing or cross-origin registration origin', async (origin) => {
  const upstream = vi.fn(); vi.stubGlobal('fetch', upstream);
  const { POST } = await import('@/app/api/auth/register/route');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers.origin = origin;

  const response = await POST(new Request('http://app.test/api/auth/register', { method: 'POST', headers, body: '{}' }));

  expect(response.status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
});

it('allows same-origin registration through the existing upstream path', async () => {
  const upstream = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
  vi.stubGlobal('fetch', upstream);
  const { POST } = await import('@/app/api/auth/register/route');

  const response = await POST(new Request('http://app.test/api/auth/register', { method: 'POST', headers: { origin: 'http://app.test', 'content-type': 'application/json' }, body: '{"email":"local@example.test"}' }));

  expect(response.status).toBe(201);
  expect(upstream).toHaveBeenCalledTimes(1);
});

it('fails closed when the canonical application origin is not configured', async () => {
  delete process.env.NEXTAUTH_URL;
  const upstream = vi.fn(); vi.stubGlobal('fetch', upstream);
  const { POST } = await import('@/app/api/auth/register/route');
  const response = await POST(new Request('http://app.test/api/auth/register', { method: 'POST', headers: { origin: 'http://app.test' } }));
  expect(response.status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
});
