export function modelAllowlist(): Record<string, string[]> {
  return {
    anthropic: split(process.env.KLASR_ANTHROPIC_MODELS),
    openai: split(process.env.KLASR_OPENAI_MODELS),
    mistral: split(process.env.KLASR_MISTRAL_MODELS),
    compatible: split(process.env.KLASR_COMPATIBLE_MODELS),
  };
}
export function detectProvider(key: string): string {
  return key.startsWith('sk-ant-') ? 'anthropic' : key.startsWith('sk-proj-') || key.startsWith('sk-') ? 'openai' : key.startsWith('La') ? 'mistral' : 'compatible';
}
function split(value?: string): string[] { return value?.split(',').map((item) => item.trim()).filter(Boolean) ?? []; }
