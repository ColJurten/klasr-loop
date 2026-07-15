import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { GET } from '@/app/api/drive/pending-token/route';

const mockedGetServerSession = vi.mocked(getServerSession);

function requestWithPendingCookie(pending: object | null) {
  const headers = new Headers();
  if (pending) headers.set('cookie', `drive_pending_grant=${JSON.stringify(pending)}`);
  return new NextRequest('http://localhost/api/drive/pending-token', { headers });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/drive/pending-token', () => {
  it('returns 403 when the caller is not an ADMIN', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'MEMBER' },
    } as never);

    const response = await GET(
      requestWithPendingCookie({ accessToken: 'at', refreshToken: 'rt', accountId: 'a' }),
    );

    expect(response.status).toBe(403);
  });

  it('returns 404 when there is no pending grant cookie', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);

    const response = await GET(requestWithPendingCookie(null));

    expect(response.status).toBe(404);
  });

  it('returns 404 when the pending grant cookie is malformed', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);

    const response = await GET(
      new NextRequest('http://localhost/api/drive/pending-token', {
        headers: new Headers({ cookie: 'drive_pending_grant=not-json' }),
      }),
    );

    expect(response.status).toBe(404);
  });

  it('exposes only the access token — the refresh token never reaches the response body', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);

    const response = await GET(
      requestWithPendingCookie({
        accessToken: 'access-token-value',
        refreshToken: 'refresh-token-value',
        accountId: 'account-1',
      }),
    );

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ accessToken: 'access-token-value' });
    expect(JSON.stringify(body)).not.toContain('refresh-token-value');
  });
});
