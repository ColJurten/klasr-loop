import { Module } from '@nestjs/common';
import { AnalysesModule } from '../analyses/analyses.module';
import { DriveModule } from '../drive/drive.module';
import { DocumentsModule } from '../documents/documents.module';
import { JobsModule } from '../jobs/jobs.module';
import { UsageMetricsRepository } from '../metrics/usage-metrics.repository';
import { RulesModule } from '../rules/rules.module';
import { ClassificationController, DriveWorkflowController, SyncController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { AnalysisService } from './analysis.service';
import { ProposalsRepository } from './proposals.repository';
import { SyncService } from './sync.service';
import { SuggestionService } from '../analysis/suggestion.service';
import { LlmSettingsModule } from '../llm-settings/llm-settings.module';
import { TenantProviderResolver } from '../llm-settings/tenant-provider.resolver';

@Module({
  imports: [DocumentsModule, DriveModule, JobsModule, RulesModule, AnalysesModule, LlmSettingsModule],
  controllers: [ClassificationController, SyncController, DriveWorkflowController],
  providers: [
    ClassificationService,
    AnalysisService,
    SyncService,
    ProposalsRepository,
    UsageMetricsRepository,
    SuggestionService,
    {
      provide: 'SUGGESTION_LLM',
      useExisting: TenantProviderResolver,
    },
  ],
  exports: [ClassificationService, SyncService, AnalysisService, SuggestionService],
})
export class ClassificationModule {}
