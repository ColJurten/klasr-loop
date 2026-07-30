import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalysesModule } from '../analyses/analyses.module';
import { DriveModule } from '../drive/drive.module';
import { DocumentsModule } from '../documents/documents.module';
import { JobsModule } from '../jobs/jobs.module';
import { UsageMetricsRepository } from '../metrics/usage-metrics.repository';
import { RulesModule } from '../rules/rules.module';
import { ClassificationController, DriveWorkflowController, SyncController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { AnalysisService, LLM_PROVIDERS } from './analysis.service';
import { LocalOcrAdapter } from './local-ocr.adapter';
import { AnthropicProvider } from './llm/anthropic.provider';
import { LocalHeuristicProvider } from './llm/local-heuristic.provider';
import { LlmProvider } from './llm/provider';
import { OCR_PORT } from './ocr.port';
import { ProposalsRepository } from './proposals.repository';
import { SyncService } from './sync.service';
import { TesseractOcrAdapter } from './tesseract-ocr.adapter';

@Module({
  imports: [DocumentsModule, DriveModule, JobsModule, RulesModule, AnalysesModule],
  controllers: [ClassificationController, SyncController, DriveWorkflowController],
  providers: [
    ClassificationService,
    AnalysisService,
    SyncService,
    ProposalsRepository,
    UsageMetricsRepository,
    LocalHeuristicProvider,
    {
      provide: LLM_PROVIDERS,
      useFactory: (config: ConfigService, local: LocalHeuristicProvider): LlmProvider[] => {
        const providers: LlmProvider[] = [local];
        const apiKey = config.get<string>('ANTHROPIC_API_KEY');
        if (apiKey) {
          providers.push(new AnthropicProvider(apiKey, config.get<string>('ANTHROPIC_MODEL')));
        }
        return providers;
      },
      inject: [ConfigService, LocalHeuristicProvider],
    },
    {
      provide: OCR_PORT,
      useFactory: (local: LocalOcrAdapter, tesseract: TesseractOcrAdapter) => {
        if (process.env.KLASR_LOCAL_MVP === 'true') {
          if (process.env.NODE_ENV === 'production') {
            throw new Error('KLASR_LOCAL_MVP cannot run in production');
          }
          return local;
        }
        return tesseract;
      },
      inject: [LocalOcrAdapter, TesseractOcrAdapter],
    },
    LocalOcrAdapter,
    TesseractOcrAdapter,
  ],
  exports: [ClassificationService, SyncService, AnalysisService],
})
export class ClassificationModule {}
