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
      const parsed = JSON.parse(raw) as unknown;
      return validClassification(parsed, params);
    } catch {
      return null;
    }
  }
}

function validClassification(
  value: unknown,
  params: { filename: string; folderPaths: string[] },
): LlmClassification | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<LlmClassification>;
  if (
    typeof candidate.proposedName !== 'string' ||
    typeof candidate.destinationPath !== 'string' ||
    typeof candidate.confidence !== 'number'
  ) return null;
  if (!params.folderPaths.includes(candidate.destinationPath)) return null;
  const proposedName = sanitizeFilename(candidate.proposedName);
  if (!proposedName || extensionOf(proposedName) !== extensionOf(params.filename)) return null;
  const confidence = bounded(candidate.confidence);
  if (confidence === null) return null;
  const filenameConfidence = optionalBounded(candidate.filenameConfidence);
  const destinationConfidence = optionalBounded(candidate.destinationConfidence);
  if (filenameConfidence === null || destinationConfidence === null) return null;
  return {
    proposedName,
    destinationPath: candidate.destinationPath,
    confidence,
    filenameConfidence,
    destinationConfidence,
    reviewRequired: candidate.reviewRequired === true || confidence < 0.7,
    reviewReason: typeof candidate.reviewReason === 'string' ? candidate.reviewReason.slice(0, 120) : undefined,
  };
}

function bounded(value: number): number | null {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function optionalBounded(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'number' ? bounded(value) : null;
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index > 0 ? filename.slice(index).toLowerCase() : '';
}

function sanitizeFilename(filename: string): string | null {
  const name = filename
    .trim()
    .normalize('NFKC')
    .replaceAll('/', '_')
    .replaceAll('\\', '_')
    .split('')
    .map((char) => isControlCharacter(char) ? '_' : char)
    .join('')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 160);
  if (!name || name === '.' || name === '..' || name.includes('..')) return null;
  return name;
}

function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 32 || code === 127;
}
