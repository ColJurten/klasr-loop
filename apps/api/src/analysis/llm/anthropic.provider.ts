import { LlmProvider } from './llm.provider';
import { StructuredGeneration, StructuredResult } from './llm.types';

export class AnthropicProvider implements LlmProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl: string, private readonly defaultModel: string) {}
  async generate(request: StructuredGeneration): Promise<StructuredResult> {
    const model = request.model || this.defaultModel;
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/messages`, {
      method: 'POST', headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 2048, system: request.system, messages: [{ role: 'user', content: JSON.stringify({ task: request.prompt, input: request.input }) }] }),
    });
    if (!response.ok) throw new Error(`anthropic_http_${response.status}`);
    const body = await response.json() as { content?: Array<{ type: string; text?: string }> };
    const text = body.content?.find((item) => item.type === 'text')?.text;
    if (!text) throw new Error('anthropic_empty_response');
    return { value: parseJsonObject(text), provider: 'anthropic', model };
  }
}

function parseJsonObject(text: string): object {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?[^\S\r\n]*(?:\r?\n)?([\s\S]*?)(?:\r?\n)?```$/i.exec(trimmed);
  const value: unknown = JSON.parse(fenced?.[1] ?? trimmed);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('anthropic_response_not_object');
  return value;
}
