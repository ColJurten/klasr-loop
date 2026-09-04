import { NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/same-origin';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ code: 'forbidden' }, { status: 403 });
  const response = await fetch(`${API_URL}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '' }, body: await request.text() });
  return NextResponse.json(response.ok ? {} : { code: response.status === 409 ? 'email_registered' : 'invalid_registration' }, { status: response.status });
}
