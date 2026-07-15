import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { PENDING_COOKIE, STATE_COOKIE } from '../constants';

const DRIVE_PAGE = '/dashboard/drive';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  scope: string;
}

interface DriveAboutResponse {
  user: { permissionId: string };
}

function errorRedirect(request: NextRequest, error: string): NextResponse {
  const response = NextResponse.redirect(new URL(`${DRIVE_PAGE}?error=${error}`, request.url));
  response.cookies.delete(STATE_COOKIE);
  return response;
}

/**
 * Exchanges the Google authorization code for tokens, resolves the connected
 * account's stable id via Drive's own `about` endpoint (avoids requesting
 * profile/email scope just for that), and stashes the grant in a short-lived
 * httpOnly cookie for the Picker step to pick up. Never puts a token in a
 * URL or a log line.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const expectedState = request.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return errorRedirect(request, 'state_mismatch');
  }

  const redirectUri = new URL('/api/drive/callback', request.url).toString();
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResponse.ok) {
    return errorRedirect(request, 'token_exchange_failed');
  }
  const tokens = (await tokenResponse.json()) as TokenResponse;
  if (!tokens.refresh_token) {
    return errorRedirect(request, 'no_refresh_token');
  }

  const aboutResponse = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!aboutResponse.ok) {
    return errorRedirect(request, 'account_lookup_failed');
  }
  const about = (await aboutResponse.json()) as DriveAboutResponse;

  const pendingGrant = JSON.stringify({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    scopes: tokens.scope.split(' ').filter(Boolean),
    accountId: about.user.permissionId,
  });

  const response = NextResponse.redirect(new URL(`${DRIVE_PAGE}?step=pick`, request.url));
  response.cookies.delete(STATE_COOKIE);
  response.cookies.set(PENDING_COOKIE, pendingGrant, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 300,
    path: '/',
  });
  return response;
}
