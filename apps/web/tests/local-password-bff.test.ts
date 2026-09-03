// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
import { getServerSession } from 'next-auth';

const session = { user: { userId: 'user_session', organizationId: 'org_session', membershipId: 'membership_session', role: 'ADMIN' } };

beforeEach(() => {
  vi.resetModules();
  vi.mocked(getServerSession).mockResolvedValue(session as never);
  process.env.INTERNAL_API_SECRET = 'internal-test-secret';
  process.env.API_URL = 'http://api.test/api/v1';
  process.env.NEXTAUTH_URL = 'http://app.test';
});

it('derives identity from the authenticated session and forwards only the password body', async () => {
  const upstream = vi.fn().mockResolvedValue(new Response('{"enrolled":true}', { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', upstream);
  const { POST } = await import('@/app/api/auth/enroll-local/route');
  const response = await POST(new Request('http://app.test/api/auth/enroll-local', { method: 'POST', headers: { origin: 'http://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct horse battery', userId: 'attacker', organizationId: 'attacker' }) }));

  expect(response.status).toBe(200);
  expect(upstream).toHaveBeenCalledWith('http://api.test/api/v1/auth/local-password', expect.objectContaining({
    headers: expect.objectContaining({ 'x-user-id': 'user_session', 'x-organization-id': 'org_session', 'x-membership-id': 'membership_session' }),
    body: JSON.stringify({ password: 'correct horse battery' }),
  }));
});

it('denies unauthenticated and cross-origin requests before mutation', async () => {
  const upstream = vi.fn(); vi.stubGlobal('fetch', upstream);
  const { POST } = await import('@/app/api/auth/enroll-local/route');
  expect((await POST(new Request('http://app.test/api/auth/enroll-local', { method: 'POST', headers: { origin: 'http://evil.test', 'content-type': 'application/json' }, body: '{"password":"correct horse battery"}' }))).status).toBe(403);
  expect((await POST(new Request('http://app.test/api/auth/enroll-local', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"password":"correct horse battery"}' }))).status).toBe(403);
  vi.mocked(getServerSession).mockResolvedValue(null);
  expect((await POST(new Request('http://app.test/api/auth/enroll-local', { method: 'POST', headers: { origin: 'http://app.test', 'content-type': 'application/json' }, body: '{"password":"correct horse battery"}' }))).status).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
});
