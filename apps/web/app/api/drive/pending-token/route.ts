import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { PENDING_COOKIE } from '../constants';

/**
 * Hands the Picker step an access token to open Google Picker with — and
 * ONLY the access token. The refresh token stays server-side in the httpOnly
 * cookie until /api/drive/finalize persists it; it must never reach the browser.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const raw = request.cookies.get(PENDING_COOKIE)?.value;
  if (!raw) {
    return NextResponse.json({ error: 'No pending Drive grant' }, { status: 404 });
  }

  const { accessToken } = JSON.parse(raw) as { accessToken: string };
  return NextResponse.json({ accessToken });
}
