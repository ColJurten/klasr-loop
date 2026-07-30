import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ProposalSource } from '@prisma/client';
import { AnalysesRepository } from '../analyses/analyses.repository';
import { DocumentsRepository } from '../documents/documents.repository';
import { FoldersRepository } from '../drive/folders.repository';
import { GoogleDriveExecutor } from '../drive/google-drive.executor';
import { JobsService } from '../jobs/jobs.service';
import { UsageMetricsRepository } from '../metrics/usage-metrics.repository';
import { RulesRepository } from '../rules/rules.repository';
import { DRIVE_EXECUTOR } from './drive-executor.port';
import { classifyWithCascade } from './llm/cascade';
import { LlmProvider } from './llm/provider';
import { OCR_PORT, OcrPort } from './ocr.port';
import { applyRules } from './pipeline/prefilter';
import { PipelineRule } from './pipeline/types';
import { ProposalsRepository } from './proposals.repository';

interface Downloader {
  download(organizationId: string, documentExternalId: string): Promise<ReadableStream<Uint8Array>>;
}

export const LLM_PROVIDERS = Symbol('LLM_PROVIDERS');

@Injectable()
export class AnalysisService implements OnModuleInit {
  constructor(
    private readonly documents: DocumentsRepository,
    @Inject(DRIVE_EXECUTOR) private readonly drive: Downloader | GoogleDriveExecutor,
    @Inject(OCR_PORT) private readonly ocr: OcrPort,
    private readonly rules: RulesRepository,
    private readonly folders: FoldersRepository,
    private readonly proposals: ProposalsRepository,
    private readonly analyses: AnalysesRepository,
    private readonly metrics: UsageMetricsRepository,
    private readonly jobs: JobsService,
    @Optional() @Inject(LLM_PROVIDERS) private readonly llmProviders: LlmProvider[] = [],
  ) {}

  onModuleInit(): void {
    this.jobs.registerAnalysisHandler((job) => this.analyze(job));
  }

  async analyze(job: { organizationId: string; documentId: string }): Promise<void> {
    const document = await this.documents.findPending(job.organizationId, job.documentId);
    if (!document) return;
    const stream = await this.drive.download(job.organizationId, document.externalId);
    const text = await this.ocr.extractText(stream, {
      filename: document.name,
      mimeType: document.mimeType,
    });
    const rules = await this.rules.listOrdered(job.organizationId);
    const folderPaths = await this.folders.listPaths(job.organizationId);
    const pipelineRules: PipelineRule[] = rules.map((rule) => ({
      id: rule.id,
      priority: rule.priority,
      destinationPath: rule.destinationPath,
      suggestedNameTemplate: rule.suggestedNameTemplate ?? undefined,
      conditions: rule.conditions.map((condition) => ({
        field: condition.field === 'CONTENT' ? 'content' : condition.field === 'FILENAME' ? 'filename' : 'mimeType',
        operator: condition.operator === 'CONTAINS' ? 'contains' : 'equals',
        value: condition.value,
      })),
    }));
    const ruleProposal = applyRules({
      organizationId: job.organizationId,
      documentId: document.id,
      filename: document.name,
      mimeType: document.mimeType,
      text,
      folderPaths,
      rules: pipelineRules,
    });
    const llmProposal =
      ruleProposal ??
      asLlmProposal(
        await classifyWithCascade(this.llmProviders, {
          documentText: text,
          filename: document.name,
          folderPaths,
        }),
      );
    if (!llmProposal) {
      await this.documents.markManual(job.organizationId, document.id);
      return;
    }
    await this.proposals.createPending({
      organizationId: job.organizationId,
      documentId: document.id,
      proposedName: llmProposal.proposedName,
      destinationPath: llmProposal.destinationPath,
      confidence: llmProposal.confidence,
      source: llmProposal.source as ProposalSource,
      modelUsed: 'modelUsed' in llmProposal ? llmProposal.modelUsed : undefined,
      llmCallsUsed: llmProposal.llmCallsUsed,
    });
    await this.documents.markProposed(job.organizationId, document.id);
    await this.analyses.record({
      organizationId: job.organizationId,
      documentId: document.id,
      ocrExcerpt: redactExcerpt(text),
      modelUsed: 'modelUsed' in llmProposal ? llmProposal.modelUsed : 'rule',
      llmRaw: { source: llmProposal.source },
    });
    await this.metrics.increment(job.organizationId, {
      ocrRuns: 1,
      ruleMatches: llmProposal.source === 'RULE' ? 1 : 0,
      llmCalls: llmProposal.llmCallsUsed,
    });
  }
}

function redactExcerpt(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[number]')
    .slice(0, 1000);
}

function asLlmProposal(
  result: Awaited<ReturnType<typeof classifyWithCascade>>,
): null | {
  proposedName: string;
  destinationPath: string;
  confidence: number;
  source: 'LLM';
  modelUsed: string;
  llmCallsUsed: number;
} {
  return result ? { ...result, source: 'LLM' } : null;
}
