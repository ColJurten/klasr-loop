import { Inject, Injectable } from '@nestjs/common';
import { AnalyseDocumentAgent } from './agents/analyse-document.agent';
import { FolderNode } from './agents/agent.types';
import { SuggestDestinationAgent } from './agents/suggest-destination.agent';
import { SuggestFilenameAgent } from './agents/suggest-filename.agent';
import { confidenceCap, decideFilename } from './crews/suggest-filename.crew';
import { decideDestination } from './crews/suggest-destination.crew';
import { extract } from './extraction/extract';
import { DocumentInput } from './extraction/extraction.types';
import { LlmProvider } from './llm/llm.provider';
import { DestinationSuggestion, FilenameSuggestion } from './schemas/results.schemas';

interface ResolvedProvider { provider: LlmProvider; source: 'tenant' | 'environment'; }
interface ProviderResolver { forOrganization(organizationId?: string): Promise<ResolvedProvider>; }

@Injectable()
export class SuggestionService {
  private readonly inFlight = new WeakMap<Buffer, ReturnType<SuggestionService['analyse']>>();
  constructor(@Inject('SUGGESTION_LLM') private readonly source: LlmProvider | ProviderResolver) {}
  async suggestFilename(input: DocumentInput): Promise<FilenameSuggestion> {
    const shared = await this.shared(input); const extension = input.originalName.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? '';
    if (!shared.analysis) return { value: `classement_manuel${extension}`, confidence: 0, signals: [], reviewRequired: true, failureReason: shared.failure, provider: 'none', model: '' };
    const resolved = await this.provider(input.organizationId);
    return decideFilename(shared.analysis, input, new SuggestFilenameAgent(resolved.provider, resolved.source === 'environment' ? process.env.KLASR_AGENT_FILENAME_MODEL || process.env.KLASR_LLM_MODEL : undefined), process.env.KLASR_FILENAME_CONVENTION || 'YYYY-MM-DD_type_party_reference', shared.cap);
  }
  async suggestDestination(input: DocumentInput, tree: FolderNode[]): Promise<DestinationSuggestion> {
    const shared = await this.shared(input);
    if (!shared.analysis) return { path: null, confidence: 0, signals: [], reviewRequired: true, failureReason: shared.failure, provider: 'none', model: '' };
    const resolved = await this.provider(input.organizationId);
    return decideDestination(shared.analysis, tree, new SuggestDestinationAgent(resolved.provider, resolved.source === 'environment' ? process.env.KLASR_AGENT_DESTINATION_MODEL || process.env.KLASR_LLM_MODEL : undefined), shared.cap);
  }
  private shared(input: DocumentInput) {
    if (!Buffer.isBuffer(input.content)) return this.analyse(input);
    const cached = this.inFlight.get(input.content); if (cached) return cached;
    const current = this.analyse(input); this.inFlight.set(input.content, current); void current.finally(() => queueMicrotask(() => this.inFlight.delete(input.content as Buffer)));
    return current;
  }
  private async analyse(input: DocumentInput) {
    const extracted = await extract(input); const cap = confidenceCap(extracted.quality);
    if (!cap) return { analysis: null, cap, failure: extracted.quality === 'failed' ? 'extraction_failed' as const : 'empty_content' as const };
    try { const resolved = await this.provider(input.organizationId); return { analysis: await new AnalyseDocumentAgent(resolved.provider, resolved.source === 'environment' ? process.env.KLASR_AGENT_ANALYSE_MODEL || process.env.KLASR_LLM_MODEL : undefined).run(extracted), cap, failure: null }; }
    catch { return { analysis: null, cap: 0, failure: 'invalid_model_output' as const }; }
  }
  private provider(organizationId?: string): Promise<ResolvedProvider> {
    return 'forOrganization' in this.source ? this.source.forOrganization(organizationId) : Promise.resolve({ provider: this.source, source: 'environment' });
  }
}
