import { LlmProvider } from './llm.provider';
import { StructuredGeneration, StructuredResult } from './llm.types';

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl: string, private readonly defaultModel: string, private readonly providerName = 'openai-compatible') {}
  async generate(request: StructuredGeneration): Promise<StructuredResult> {
    const model = request.model || this.defaultModel;
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(Number(process.env.KLASR_LLM_TIMEOUT_MS || 10_000)), headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: request.system }, { role: 'user', content: JSON.stringify({ taskId: request.task, task: request.prompt, input: request.input }) }] }) });
    if (response.status >= 300 && response.status < 400) throw new Error('llm_redirect_rejected');
    if (!response.ok) throw new Error(`llm_http_${response.status}`);
    const bytes = await response.arrayBuffer(); if (bytes.byteLength > 1_000_000) throw new Error('llm_response_too_large');
    const body = JSON.parse(Buffer.from(bytes).toString('utf8')) as { choices?: Array<{ message?: { content?: string } }> };
    return { value: JSON.parse(body.choices?.[0]?.message?.content ?? '{}'), provider: this.providerName, model };
  }
}
