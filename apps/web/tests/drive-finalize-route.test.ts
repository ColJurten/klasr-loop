import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { POST } from '@/app/api/drive/finalize/route';

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedFetch = vi.fn();
vi.stubGlobal('fetch', mockedFetch);

function requestWithPendingCookie(pending: object | null, rootFolder: object) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (pending) headers.set('cookie', `drive_pending_grant=${JSON.stringify(pending)}`);
  return new NextRequest('http://localhost/api/drive/finalize', {
    method: 'POST',
    headers,
    body: JSON.stringify({ rootFolder }),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/drive/finalize', () => {
  const pending = {
    refreshToken: 'refresh-token-value',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    accountId: 'account-1',
  };
  const rootFolder = { externalId: 'folder-1', name: 'Comptabilité' };

  it('returns 403 when the caller is not an ADMIN', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'MEMBER' },
    } as never);

    const response = await POST(requestWithPendingCookie(pending, rootFolder));

    expect(response.status).toBe(403);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when there is no pending grant cookie', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);

    const response = await POST(requestWithPendingCookie(null, rootFolder));

    expect(response.status).toBe(400);
  });

  it('sends organizationId from the session, not the request body, to the internal API', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'session-org', role: 'ADMIN' },
    } as never);
    mockedFetch.mockResolvedValueOnce({ ok: true });

    // rootFolder is the only client-controlled field; there is no
    // organizationId field for a client to even attempt to override.
    await POST(requestWithPendingCookie(pending, rootFolder));

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockedFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.organizationId).toBe('session-org');
    expect(body.refreshToken).toBe('refresh-token-value');
    expect(body.rootFolder).toEqual(rootFolder);
  });

  it('clears the pending cookie and reports failure when the internal API rejects', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);
    mockedFetch.mockResolvedValueOnce({ ok: false });

    const response = await POST(requestWithPendingCookie(pending, rootFolder));

    expect(response.status).toBe(502);
    expect(response.cookies.get('drive_pending_grant')?.value).toBe('');
  });
});
