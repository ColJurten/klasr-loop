/**
 * Anthropic provider over plain HTTPS (Node 20 fetch) — no SDK dependency in
 * the starter. Returns null on any failure so the cascade can fall through.
 */
import { buildPrompt, LlmClassification, LlmProvider } from './provider';

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    private readonly model = 'claude-haiku-4-5',
  ) {}

  async classify(params: {
    documentText: string;
    filename: string;
    folderPaths: string[];
  }): Promise<LlmClassification | null> {
    if (!this.apiKey) return null;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 300,
          messages: [
            {
              role: 'user',
              content: buildPrompt(params.documentText, params.filename, params.folderPaths),
            },
          ],
        }),
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };
      const raw = payload.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('')
        .trim()
        .replace(/^```json/, '')
        .replace(/```$/, '');
      const parsed = JSON.parse(raw) as LlmClassification;
      // The model must not invent folders outside the tenant's arborescence.
      if (!params.folderPaths.includes(parsed.destinationPath)) return null;
      return parsed;
    } catch {
      return null;
    }
  }
}
