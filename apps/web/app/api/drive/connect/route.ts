import { randomBytes } from 'crypto';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { DRIVE_SCOPE, STATE_COOKIE, driveCallbackRedirectUri } from '../constants';

/**
 * Starts the org-level Drive OAuth grant (org admin only). Deliberately not
 * routed through NextAuth's provider config: this is an incremental-scope
 * grant on top of an already-signed-in session, not a sign-in — NextAuth v4
 * providers apply one fixed scope on every sign-in.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const state = randomBytes(32).toString('hex');
  const redirectUri = driveCallbackRedirectUri();

  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID ?? '');
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', DRIVE_SCOPE);
  authorizeUrl.searchParams.set('access_type', 'offline');
  authorizeUrl.searchParams.set('prompt', 'consent');
  authorizeUrl.searchParams.set('include_granted_scopes', 'true');
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    // Always secure, not NODE_ENV-gated: browsers exempt localhost from the
    // Secure requirement, so this doesn't break local dev, and it avoids a
    // deployment ever emitting this cookie over plain HTTP by misconfiguration.
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return response;
}
