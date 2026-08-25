import { NextResponse } from 'next/server';
import { ApiUpstreamError, deleteLlmSettings, discoverLlmModels, getLlmSettings, LlmSettingsInput, saveLlmSettings } from '@/lib/api';

export async function GET() { return proxy(() => getLlmSettings()); }
export async function POST(request: Request) { return proxy(async () => discoverLlmModels(await request.json() as LlmSettingsInput)); }
export async function PUT(request: Request) { return proxy(async () => saveLlmSettings(await request.json() as LlmSettingsInput)); }
export async function DELETE() { return proxy(() => deleteLlmSettings()); }
async function proxy(action: () => Promise<unknown>) {
  try { return NextResponse.json(await action()); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur inattendue.' }, { status: error instanceof ApiUpstreamError ? error.status : 500 }); }
}
