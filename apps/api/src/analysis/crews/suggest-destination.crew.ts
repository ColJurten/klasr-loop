import { AnalyseDocumentAgent } from '../agents/analyse-document.agent';
import { FolderNode } from '../agents/agent.types';
import { SuggestDestinationAgent } from '../agents/suggest-destination.agent';
import { extract } from '../extraction/extract';
import { DocumentInput } from '../extraction/extraction.types';
import { DestinationSuggestion } from '../schemas/results.schemas';
import { DocumentAnalysis } from '../schemas/results.schemas';
import { confidenceCap } from './suggest-filename.crew';

export async function runDestinationCrew(input: DocumentInput, tree: FolderNode[], analyse: AnalyseDocumentAgent, destination: SuggestDestinationAgent): Promise<DestinationSuggestion> {
  const extracted = await extract(input); const cap = confidenceCap(extracted.quality);
  if (cap === 0) return { path: null, confidence: 0, signals: [], reviewRequired: true, failureReason: extracted.quality === 'failed' ? 'extraction_failed' : 'empty_content', provider: 'none', model: '' };
  try { return await destination.run({ analysis: await analyse.run(extracted), tree, confidenceCap: cap }); }
  catch { return { path: null, confidence: 0, signals: [], reviewRequired: true, failureReason: 'invalid_model_output', provider: 'none', model: '' }; }
}
export async function decideDestination(analysis: DocumentAnalysis, tree: FolderNode[], destination: SuggestDestinationAgent, cap: number): Promise<DestinationSuggestion> {
  return destination.run({ analysis, tree, confidenceCap: cap });
}
