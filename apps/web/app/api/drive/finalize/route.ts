import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { PENDING_COOKIE } from '../constants';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface PendingGrant {
  refreshToken: string;
  scopes: string[];
  accountId: string;
}

/**
 * Persists the completed Drive grant. organizationId is read from the
 * server-side session — never from the request body — so an admin can never
 * attach their Drive grant to a different organization.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const raw = request.cookies.get(PENDING_COOKIE)?.value;
  if (!raw) {
    return NextResponse.json({ error: 'No pending Drive grant' }, { status: 400 });
  }
  let pending: PendingGrant;
  try {
    pending = JSON.parse(raw) as PendingGrant;
  } catch {
    return NextResponse.json({ error: 'No pending Drive grant' }, { status: 400 });
  }
  const { rootFolder } = (await request.json()) as {
    rootFolder: { externalId: string; name: string };
  };

  const apiResponse = await fetch(`${API_URL}/drive-connections`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '',
    },
    body: JSON.stringify({
      organizationId: session.user.organizationId,
      provider: 'GOOGLE_DRIVE',
      externalId: pending.accountId,
      refreshToken: pending.refreshToken,
      scopes: pending.scopes,
      rootFolder,
    }),
  });

  const response = apiResponse.ok
    ? NextResponse.json({ connected: true })
    : NextResponse.json({ error: 'Failed to save Drive connection' }, { status: 502 });
  response.cookies.delete(PENDING_COOKIE);
  return response;
}
