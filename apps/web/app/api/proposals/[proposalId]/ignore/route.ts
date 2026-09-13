import { NextResponse } from 'next/server';
import { ignoreProposal } from '@/lib/api';
import { bffErrorResponse } from '@/lib/bff-errors';

export async function POST(
  _request: Request,
  { params }: { params: { proposalId: string } },
) {
  try {
    return NextResponse.json(await ignoreProposal(params.proposalId));
  } catch (error) {
    return bffErrorResponse(error, 'ignore failed');
  }
}
