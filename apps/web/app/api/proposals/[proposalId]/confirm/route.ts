import { NextResponse } from 'next/server';
import { confirmProposal } from '@/lib/api';
import { bffErrorResponse } from '@/lib/bff-errors';

export async function POST(
  request: Request,
  { params }: { params: { proposalId: string } },
) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      overrideDestinationPath?: string;
      destinationFolderExternalId?: string;
      finalName?: string;
    };
    return NextResponse.json(await confirmProposal(params.proposalId, body));
  } catch (error) {
    return bffErrorResponse(error, 'confirm failed');
  }
}
