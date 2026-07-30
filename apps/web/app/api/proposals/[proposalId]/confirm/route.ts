import { NextResponse } from 'next/server';
import { confirmProposal } from '@/lib/api';

export async function POST(
  request: Request,
  { params }: { params: { proposalId: string } },
) {
  try {
    const body = (await request.json().catch(() => ({}))) as { overrideDestinationPath?: string };
    return NextResponse.json(await confirmProposal(params.proposalId, body.overrideDestinationPath));
  } catch {
    return NextResponse.json({ error: 'confirm failed' }, { status: 401 });
  }
}
