/** LLM cascade: try providers in order, cheapest first (eco-design, ADR-001). */
import { LlmClassification, LlmProvider } from './provider';
import { deterministicLocalFallback } from './local-heuristic.provider';

export interface CascadeResult extends LlmClassification {
  llmCallsUsed: number;
  modelUsed: string;
}

export async function classifyWithCascade(
  providers: LlmProvider[],
  params: { documentText: string; filename: string; folderPaths: string[] },
): Promise<CascadeResult | null> {
  let calls = 0;
  for (const provider of providers) {
    // Only external calls count against the eco budget; the local stage is free.
    if (provider.name !== 'local') calls += 1;
    const result = await provider.classify(params);
    if (result !== null) {
      return { ...result, llmCallsUsed: calls, modelUsed: provider.name };
    }
  }
  const fallback = await deterministicLocalFallback(params);
  return fallback ? { ...fallback, llmCallsUsed: calls, modelUsed: 'local-fallback' } : null;
}
