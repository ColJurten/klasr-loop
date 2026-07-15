export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const STATE_COOKIE = 'drive_oauth_state';
export const PENDING_COOKIE = 'drive_pending_grant';

/**
 * Must match, byte-for-byte, an "Authorized redirect URI" registered on the
 * GOOGLE_CLIENT_ID's OAuth client in Google Cloud Console — Google rejects
 * anything else with redirect_uri_mismatch. Strips a trailing slash off
 * NEXTAUTH_URL so a value like "http://localhost:3000/" doesn't silently
 * produce a double slash that no registered URI would match.
 */
export function driveCallbackRedirectUri(): string {
  const base = (process.env.NEXTAUTH_URL ?? '').replace(/\/+$/, '');
  return `${base}/api/drive/callback`;
}
