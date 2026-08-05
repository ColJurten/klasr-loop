import { NextResponse } from 'next/server';
import { listDriveItems } from '@/lib/api';
import { bffErrorResponse } from '@/lib/bff-errors';

const MAX_ID = 512;
const MAX_TOKEN = 2048;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parentId = searchParams.get('parentId') ?? 'root';
  const pageToken = searchParams.get('pageToken') ?? undefined;
  if (!parentId || parentId.length > MAX_ID || (pageToken && pageToken.length > MAX_TOKEN)) {
    return NextResponse.json({ error: 'Invalid Drive navigation parameters' }, { status: 400 });
  }
  try {
    return NextResponse.json(await listDriveItems(parentId, pageToken));
  } catch (error) {
    return bffErrorResponse(error, 'Drive listing failed');
  }
}
