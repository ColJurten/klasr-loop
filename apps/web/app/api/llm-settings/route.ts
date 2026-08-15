import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';
import { detectProvider, modelAllowlist } from '@/lib/llm-settings';

export async function GET() {
  const session = await getServerSession(authOptions); if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ providers: modelAllowlist(), configured: null, productionMode: 'environment' });
}
export async function POST(request: Request) {
  const session = await getServerSession(authOptions); if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json() as { apiKey?: string; model?: string };
  const key = body.apiKey?.trim() ?? ''; const provider = detectProvider(key); const allowed = modelAllowlist()[provider] ?? [];
  if (key.length < 12 || !body.model || !allowed.includes(body.model)) return NextResponse.json({ error: 'invalid_settings', provider, models: allowed }, { status: 400 });
  return NextResponse.json({ provider, model: body.model, validated: true, retained: false });
}
