import { NextResponse } from 'next/server';
import { rejectProposal } from '@/lib/api';
import { bffErrorResponse } from '@/lib/bff-errors';

export async function POST(
  _request: Request,
  { params }: { params: { proposalId: string } },
) {
  try {
    return NextResponse.json(await rejectProposal(params.proposalId));
  } catch (error) {
    return bffErrorResponse(error, 'reject failed');
  }
}
