import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ProposalSource } from '@prisma/client';
import { SuggestionService } from '../analysis/suggestion.service';
import { FolderNode } from '../analysis/agents/agent.types';
import { extract, readDocumentBytes } from '../analysis/extraction/extract';
import { AnalysesRepository } from '../analyses/analyses.repository';
import { DocumentsRepository } from '../documents/documents.repository';
import { FoldersRepository } from '../drive/folders.repository';
import { GoogleDriveExecutor } from '../drive/google-drive.executor';
import { JobsService } from '../jobs/jobs.service';
import { UsageMetricsRepository } from '../metrics/usage-metrics.repository';
import { RulesRepository } from '../rules/rules.repository';
import { DRIVE_EXECUTOR } from './drive-executor.port';
import { applyRules } from './pipeline/prefilter';
import { PipelineRule } from './pipeline/types';
import { ProposalsRepository } from './proposals.repository';

interface Downloader { download(organizationId: string, documentExternalId: string): Promise<ReadableStream<Uint8Array>>; }

@Injectable()
export class AnalysisService implements OnModuleInit {
  constructor(
    private readonly documents: DocumentsRepository,
    @Inject(DRIVE_EXECUTOR) private readonly drive: Downloader | GoogleDriveExecutor,
    private readonly rules: RulesRepository,
    private readonly folders: FoldersRepository,
    private readonly proposals: ProposalsRepository,
    private readonly analyses: AnalysesRepository,
    private readonly metrics: UsageMetricsRepository,
    private readonly jobs: JobsService,
    private readonly suggestions: SuggestionService,
  ) {}

  onModuleInit(): void { this.jobs.registerAnalysisHandler((job) => this.analyze(job)); }

  async analyze(job: { organizationId: string; documentId: string }): Promise<void> {
    const document = await this.documents.findPending(job.organizationId, job.documentId); if (!document) return;
    let content: Buffer = Buffer.alloc(0); let readable = true;
    try { content = await readDocumentBytes(await this.drive.download(job.organizationId, document.externalId)); }
    catch { readable = false; }
    const input = { content, mimeType: readable ? document.mimeType : 'application/octet-stream', originalName: document.name };
    const extracted = readable ? await extract(input) : null;
    const inheritedFolders = await this.folders.listInherited(job.organizationId);
    const rules = await this.rules.listOrdered(job.organizationId);
    const pipelineRules: PipelineRule[] = rules.map((rule) => ({ id: rule.id, priority: rule.priority, destinationPath: rule.destinationPath, suggestedNameTemplate: rule.suggestedNameTemplate ?? undefined, conditions: rule.conditions.map((condition) => ({ field: condition.field === 'CONTENT' ? 'content' : condition.field === 'FILENAME' ? 'filename' : 'mimeType', operator: condition.operator === 'CONTAINS' ? 'contains' : 'equals', value: condition.value })) }));
    const ruleProposal = applyRules({ organizationId: job.organizationId, documentId: document.id, filename: document.name, mimeType: document.mimeType, text: extracted?.text ?? '', folderPaths: inheritedFolders.map((folder) => folder.path), rules: pipelineRules });
    let proposal;
    if (ruleProposal) proposal = ruleProposal;
    else {
      const [filename, destination] = await Promise.all([this.suggestions.suggestFilename(input), this.suggestions.suggestDestination(input, folderTree(inheritedFolders))]);
      const providers = new Set([filename.provider, destination.provider]);
      proposal = { proposedName: filename.value, destinationPath: destination.path ?? '', confidence: Math.min(filename.confidence, destination.confidence), filenameConfidence: filename.confidence, destinationConfidence: destination.confidence, reviewRequired: filename.reviewRequired || destination.reviewRequired, reviewReason: filename.failureReason ?? destination.failureReason ?? undefined, source: 'LLM' as const, modelUsed: `${filename.provider}/${filename.model};${destination.provider}/${destination.model}`, llmCallsUsed: providers.has('none') || providers.has('local') ? 0 : 3, signals: [...new Set([...filename.signals, ...destination.signals])] };
    }
    await this.proposals.createPending({ organizationId: job.organizationId, documentId: document.id, proposedName: proposal.proposedName, destinationPath: proposal.destinationPath, destinationFolderExternalId: inheritedFolders.find((folder) => folder.path === proposal.destinationPath)?.externalId, confidence: proposal.confidence, filenameConfidence: proposal.filenameConfidence, destinationConfidence: proposal.destinationConfidence, reviewRequired: proposal.reviewRequired, reviewReason: proposal.reviewReason, source: proposal.source as ProposalSource, modelUsed: proposal.modelUsed, llmCallsUsed: proposal.llmCallsUsed });
    await this.documents.markProposed(job.organizationId, document.id);
    await this.analyses.record({ organizationId: job.organizationId, documentId: document.id, modelUsed: proposal.modelUsed ?? 'rule', llmRaw: { source: proposal.source, signals: 'signals' in proposal ? proposal.signals : [] } });
    await this.metrics.increment(job.organizationId, { ocrRuns: 1, ruleMatches: proposal.source === 'RULE' ? 1 : 0, llmCalls: proposal.llmCallsUsed });
  }
}

function folderTree(rows: Array<{ externalId: string; name: string; path: string; parentExternalId: string | null }>): FolderNode[] {
  const nodes = new Map(rows.map((row) => [row.externalId, { id: row.externalId, name: row.name, path: row.path, children: [] as FolderNode[] }]));
  const roots: FolderNode[] = [];
  for (const row of rows) { const node = nodes.get(row.externalId)!; const parent = row.parentExternalId && nodes.get(row.parentExternalId); if (parent) parent.children.push(node); else roots.push(node); }
  return roots;
}
