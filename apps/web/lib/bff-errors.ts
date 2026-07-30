import { NextResponse } from 'next/server';
import { ApiUpstreamError } from './api';

export function bffErrorResponse(error: unknown, fallback: string): NextResponse {
  const message = error instanceof Error ? error.message : fallback;
  if (error instanceof ApiUpstreamError) {
    const status = error.status >= 500 ? 502 : error.status;
    return NextResponse.json({ error: message }, { status });
  }
  const candidateStatus = (error as { status?: unknown }).status;
  const status = typeof candidateStatus === 'number' && candidateStatus < 500 ? candidateStatus : 502;
  return NextResponse.json({ error: message }, { status });
}
