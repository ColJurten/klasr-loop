import { LlmProvider } from './llm.provider';
import { StructuredGeneration, StructuredResult } from './llm.types';

export class FakeLlmProvider implements LlmProvider {
  constructor(private readonly responses: unknown[] | ((request: StructuredGeneration) => unknown)) {}
  async generate(request: StructuredGeneration): Promise<StructuredResult> {
    const value = typeof this.responses === 'function' ? this.responses(request) : this.responses.shift();
    return { value, provider: 'fake', model: 'deterministic' };
  }
}
