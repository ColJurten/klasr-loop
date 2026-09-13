import { NextResponse } from 'next/server';
import { ApiUpstreamError, enrollLocalPassword, getLocalPasswordEligibility } from '@/lib/api';
import { isSameOrigin } from '@/lib/same-origin';

export async function GET() { return proxy(() => getLocalPasswordEligibility()); }
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ code: 'forbidden' }, { status: 403 });
  const body = await request.json() as { password?: unknown };
  return proxy(() => enrollLocalPassword(typeof body.password === 'string' ? body.password : ''));
}

async function proxy(action: () => Promise<unknown>) {
  try { return NextResponse.json(await action()); }
  catch (error) {
    const status = error instanceof ApiUpstreamError ? error.status : 500;
    return NextResponse.json({ code: status === 409 ? 'already_enrolled' : status === 401 ? 'unauthenticated' : 'forbidden' }, { status });
  }
}
