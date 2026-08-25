import { AnalyseDocumentAgent } from '../agents/analyse-document.agent';
import { SuggestFilenameAgent } from '../agents/suggest-filename.agent';
import { DocumentInput } from '../extraction/extraction.types';
import { extract } from '../extraction/extract';
import { FilenameSuggestion } from '../schemas/results.schemas';
import { DocumentAnalysis } from '../schemas/results.schemas';

export async function runFilenameCrew(input: DocumentInput, analyse: AnalyseDocumentAgent, filename: SuggestFilenameAgent, convention: string): Promise<FilenameSuggestion> {
  const extracted = await extract(input); const cap = confidenceCap(extracted.quality);
  if (cap === 0) return { value: `classement_manuel${input.originalName.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? ''}`, confidence: 0, signals: [], reviewRequired: true, failureReason: extracted.quality === 'failed' ? 'extraction_failed' : 'empty_content', provider: 'none', model: '' };
  try { return await filename.run({ analysis: await analyse.run(extracted), originalName: input.originalName, convention, confidenceCap: cap }); }
  catch { return { value: `classement_manuel${input.originalName.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? ''}`, confidence: 0, signals: [], reviewRequired: true, failureReason: 'invalid_model_output', provider: 'none', model: '' }; }
}
export async function decideFilename(analysis: DocumentAnalysis, input: DocumentInput, filename: SuggestFilenameAgent, convention: string, cap: number): Promise<FilenameSuggestion> {
  return filename.run({ analysis, originalName: input.originalName, convention, confidenceCap: cap });
}
export function confidenceCap(quality: 'ok' | 'sparse' | 'empty' | 'failed'): number { return quality === 'ok' ? 1 : quality === 'sparse' ? 0.35 : 0; }
