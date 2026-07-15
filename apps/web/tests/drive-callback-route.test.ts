import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { GET } from '@/app/api/drive/callback/route';

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedFetch = vi.fn();

function requestWithState({
  code,
  state,
  cookieState,
}: {
  code?: string;
  state?: string;
  cookieState?: string;
}) {
  const url = new URL('http://localhost/api/drive/callback');
  if (code) url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  const headers = new Headers();
  if (cookieState) headers.set('cookie', `drive_oauth_state=${cookieState}`);
  return new NextRequest(url, { headers });
}

vi.stubGlobal('fetch', mockedFetch);

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/drive/callback', () => {
  it('returns 403 when the caller is not an ADMIN', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'MEMBER' },
    } as never);

    const response = await GET(requestWithState({ code: 'abc', state: 's1', cookieState: 's1' }));

    expect(response.status).toBe(403);
  });

  it('redirects with state_mismatch when the state cookie does not match', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);

    const response = await GET(
      requestWithState({ code: 'abc', state: 'attacker-state', cookieState: 'real-state' }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('error=state_mismatch');
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('redirects with token_exchange_failed when Google rejects the code', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);
    mockedFetch.mockResolvedValueOnce({ ok: false });

    const response = await GET(requestWithState({ code: 'abc', state: 's1', cookieState: 's1' }));

    expect(response.headers.get('location')).toContain('error=token_exchange_failed');
  });

  it('redirects with no_refresh_token when Google omits it', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'at', scope: 'drive.file' }),
    });

    const response = await GET(requestWithState({ code: 'abc', state: 's1', cookieState: 's1' }));

    expect(response.headers.get('location')).toContain('error=no_refresh_token');
  });

  it('on success, stores the grant in a pending cookie (never in the URL) and redirects to the picker step', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);
    mockedFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'access-token-value',
          refresh_token: 'refresh-token-value',
          scope: 'https://www.googleapis.com/auth/drive.file',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { permissionId: 'account-1' } }),
      });

    const response = await GET(requestWithState({ code: 'abc', state: 's1', cookieState: 's1' }));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('step=pick');
    expect(response.headers.get('location')).not.toContain('refresh-token-value');
    expect(response.headers.get('location')).not.toContain('access-token-value');

    const pendingCookie = response.cookies.get('drive_pending_grant');
    expect(pendingCookie?.httpOnly).toBe(true);
    const stored = JSON.parse(pendingCookie!.value);
    expect(stored.refreshToken).toBe('refresh-token-value');
    expect(stored.accountId).toBe('account-1');
  });
});
