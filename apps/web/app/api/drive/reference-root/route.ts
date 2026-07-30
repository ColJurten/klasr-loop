import { NextResponse } from 'next/server';
import { selectReferenceRoot } from '@/lib/api';
import { bffErrorResponse } from '@/lib/bff-errors';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { folderExternalId?: string };
    if (!body.folderExternalId) {
      return NextResponse.json({ error: 'folderExternalId required' }, { status: 400 });
    }
    return NextResponse.json(await selectReferenceRoot(body.folderExternalId));
  } catch (error) {
    return bffErrorResponse(error, 'reference selection failed');
  }
}
