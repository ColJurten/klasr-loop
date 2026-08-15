import { LlmProvider } from './llm.provider';
import { StructuredGeneration, StructuredResult } from './llm.types';

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl: string, private readonly defaultModel: string, private readonly providerName = 'openai-compatible') {}
  async generate(request: StructuredGeneration): Promise<StructuredResult> {
    const model = request.model || this.defaultModel;
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: request.system }, { role: 'user', content: JSON.stringify({ task: request.prompt, input: request.input }) }] }) });
    if (!response.ok) throw new Error(`llm_http_${response.status}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return { value: JSON.parse(body.choices?.[0]?.message?.content ?? '{}'), provider: this.providerName, model };
  }
}
