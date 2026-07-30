import { NextResponse } from 'next/server';
import { listReferenceFolders } from '@/lib/api';
import { bffErrorResponse } from '@/lib/bff-errors';

export async function GET() {
  try {
    return NextResponse.json(await listReferenceFolders());
  } catch (error) {
    return bffErrorResponse(error, 'reference folder listing failed');
  }
}
