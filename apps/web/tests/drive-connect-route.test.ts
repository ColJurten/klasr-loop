import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));

import { getServerSession } from 'next-auth';
import { GET } from '@/app/api/drive/connect/route';

const mockedGetServerSession = vi.mocked(getServerSession);
const ORIGINAL_NEXTAUTH_URL = process.env.NEXTAUTH_URL;

beforeEach(() => {
  process.env.NEXTAUTH_URL = 'http://localhost:3000';
});

afterEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_URL = ORIGINAL_NEXTAUTH_URL;
});

describe('GET /api/drive/connect', () => {
  it('returns 403 when there is no session', async () => {
    mockedGetServerSession.mockResolvedValue(null as never);

    const response = await GET(new Request('http://localhost/api/drive/connect'));

    expect(response.status).toBe(403);
  });

  it('returns 403 for a MEMBER (only an ADMIN can connect Drive)', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'MEMBER' },
    } as never);

    const response = await GET(new Request('http://localhost/api/drive/connect'));

    expect(response.status).toBe(403);
  });

  it('redirects an ADMIN to Google with drive.file scope, offline access, and a state cookie', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);

    const response = await GET(new Request('http://localhost/api/drive/connect'));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(location.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(location.searchParams.get('access_type')).toBe('offline');
    expect(location.searchParams.get('prompt')).toBe('consent');
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/drive/callback');
    expect(location.searchParams.get('state')).toBeTruthy();

    const stateCookie = response.cookies.get('drive_oauth_state');
    expect(stateCookie?.value).toBe(location.searchParams.get('state'));
    expect(stateCookie?.httpOnly).toBe(true);
  });

  it('mints a different state on every call (not reusable across requests)', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);

    const first = await GET(new Request('http://localhost/api/drive/connect'));
    const second = await GET(new Request('http://localhost/api/drive/connect'));

    const firstState = new URL(first.headers.get('location')!).searchParams.get('state');
    const secondState = new URL(second.headers.get('location')!).searchParams.get('state');
    expect(firstState).not.toBe(secondState);
  });
});
