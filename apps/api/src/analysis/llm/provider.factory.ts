import { AnthropicProvider } from './anthropic.provider';
import { LlmProvider } from './llm.provider';
import { LocalStructuredProvider } from './local.provider';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

type GetEnvironment = (name: string) => string | undefined;

export function createLlmProvider(get: GetEnvironment = (name) => process.env[name]): LlmProvider {
  const provider = get('KLASR_LLM_PROVIDER') || 'local';
  if (provider === 'local' || provider === 'fake') return new LocalStructuredProvider();
  const key = get('KLASR_LLM_API_KEY') || (provider === 'anthropic' ? get('ANTHROPIC_API_KEY') : undefined);
  const baseUrl = get('KLASR_LLM_BASE_URL');
  const model = get('KLASR_LLM_MODEL') || '';
  if (!key || !baseUrl || !model) throw new Error(`KLASR ${provider} provider requires KLASR_LLM_API_KEY, KLASR_LLM_BASE_URL and KLASR_LLM_MODEL`);
  return provider === 'anthropic'
    ? new AnthropicProvider(key, baseUrl, model)
    : new OpenAiCompatibleProvider(key, baseUrl, model, provider);
}
