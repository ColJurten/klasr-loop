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
    const extraction = await this.ocr.extractText(stream, {
      filename: document.name,
      mimeType: document.mimeType,
    });
    const rules = await this.rules.listOrdered(job.organizationId);
    const inheritedFolders = await this.folders.listInherited(job.organizationId);
    const folderPaths = inheritedFolders.map((folder) => folder.path);
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
      text: extraction.text,
      folderPaths,
      rules: pipelineRules,
    });
    if (extraction.status !== 'ok') {
      await this.proposals.createPending({
        organizationId: job.organizationId,
        documentId: document.id,
        proposedName: safeFilename(document.name),
        destinationPath: '',
        confidence: 0,
        filenameConfidence: 0.2,
        destinationConfidence: 0,
        reviewRequired: true,
        reviewReason: extraction.reason ?? 'Extraction insuffisante: classement manuel requis',
        source: 'LLM',
        modelUsed: extraction.status,
        llmCallsUsed: 0,
      });
      await this.documents.markProposed(job.organizationId, document.id);
      await this.analyses.record({
        organizationId: job.organizationId,
        documentId: document.id,
        modelUsed: extraction.status,
        llmRaw: { source: 'OCR', status: extraction.status, method: extraction.method, pageCount: extraction.pageCount },
      });
      await this.metrics.increment(job.organizationId, { ocrRuns: 1, ruleMatches: 0, llmCalls: 0 });
      return;
    }
    const llmProposal =
      ruleProposal ??
      asLlmProposal(
        await classifyWithCascade(this.llmProviders, {
          documentText: extraction.text,
          filename: document.name,
          folderPaths,
        }),
      );
    if (!llmProposal) {
      await this.proposals.createPending({
        organizationId: job.organizationId,
        documentId: document.id,
        proposedName: safeFilename(document.name),
        destinationPath: '',
        confidence: 0,
        filenameConfidence: 0.2,
        destinationConfidence: 0,
        reviewRequired: true,
        reviewReason: 'Destination ambiguë ou non crédible: classement manuel requis',
        source: 'LLM',
        modelUsed: 'no-credible-destination',
        llmCallsUsed: 0,
      });
      await this.documents.markProposed(job.organizationId, document.id);
      await this.analyses.record({
        organizationId: job.organizationId,
        documentId: document.id,
        modelUsed: 'no-credible-destination',
        llmRaw: { source: 'OCR', status: extraction.status, method: extraction.method, pageCount: extraction.pageCount },
      });
      await this.metrics.increment(job.organizationId, { ocrRuns: 1, ruleMatches: 0, llmCalls: 0 });
      return;
    }
    await this.proposals.createPending({
      organizationId: job.organizationId,
      documentId: document.id,
      proposedName: llmProposal.proposedName,
      destinationPath: llmProposal.destinationPath,
      destinationFolderExternalId: inheritedFolders.find((folder) => folder.path === llmProposal.destinationPath)?.externalId,
      confidence: llmProposal.confidence,
      filenameConfidence: llmProposal.filenameConfidence,
      destinationConfidence: llmProposal.destinationConfidence,
      reviewRequired: llmProposal.reviewRequired,
      reviewReason: llmProposal.reviewReason,
      source: llmProposal.source as ProposalSource,
      modelUsed: 'modelUsed' in llmProposal ? llmProposal.modelUsed : undefined,
      llmCallsUsed: llmProposal.llmCallsUsed,
    });
    await this.documents.markProposed(job.organizationId, document.id);
    await this.analyses.record({
      organizationId: job.organizationId,
      documentId: document.id,
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

function asLlmProposal(
  result: Awaited<ReturnType<typeof classifyWithCascade>>,
): null | {
  proposedName: string;
  destinationPath: string;
  confidence: number;
  filenameConfidence?: number;
  destinationConfidence?: number;
  reviewRequired?: boolean;
  reviewReason?: string;
  source: 'LLM';
  modelUsed: string;
  llmCallsUsed: number;
} {
  return result ? { ...result, source: 'LLM' } : null;
}

function safeFilename(filename: string): string {
  const name = filename
    .trim()
    .normalize('NFKC')
    .replaceAll('/', '_')
    .replaceAll('\\', '_')
    .split('')
    .map((char) => isControlCharacter(char) ? '_' : char)
    .join('')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_');
  return name && name !== '.' && name !== '..' && !name.includes('..') ? name : 'document';
}

function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 32 || code === 127;
}
