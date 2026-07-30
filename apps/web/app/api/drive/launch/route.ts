import { NextResponse } from 'next/server';
import { launchDriveItem } from '@/lib/api';
import { bffErrorResponse } from '@/lib/bff-errors';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { itemExternalId?: string };
    if (!body.itemExternalId) {
      return NextResponse.json({ error: 'itemExternalId required' }, { status: 400 });
    }
    return NextResponse.json(await launchDriveItem(body.itemExternalId));
  } catch (error) {
    return bffErrorResponse(error, 'launch failed');
  }
}
