import { Controller, Get, Headers, Param, UseGuards } from '@nestjs/common';
import { DriveConnectionsService } from '../drive/drive-connections.service';
import { UsageMetricsRepository } from '../metrics/usage-metrics.repository';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { ClassificationService } from '../classification/classification.service';
import { JobsService } from '../jobs/jobs.service';
import { FoldersRepository } from '../drive/folders.repository';
import { SyncService } from '../classification/sync.service';

@Controller('organizations/:organizationId/dashboard')
@UseGuards(InternalServiceGuard)
export class DashboardController {
  constructor(
    private readonly classification: ClassificationService,
    private readonly connections: DriveConnectionsService,
    private readonly metrics: UsageMetricsRepository,
    private readonly jobs: JobsService,
    private readonly folders: FoldersRepository,
    private readonly sync: SyncService,
  ) {}

  @Get()
  async get(@Param('organizationId') organizationId: string, @Headers('x-user-id') userId: string) {
    const localMode = process.env.KLASR_LOCAL_MVP === 'true';
    const serviceAccountMode = process.env.KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT === 'true';
    const [proposals, connection, totals, history, queue, analysisFailures, referenceRoot, folders, inputItems] = await Promise.all([
      this.classification.listPending(organizationId),
      this.connections.findByUser(organizationId, userId),
      this.metrics.totals(organizationId),
      this.classification.listHistory(organizationId),
      this.jobs.queueState(),
      this.jobs.failedAnalysisCount(organizationId),
      this.folders.getReferenceRoot(organizationId),
      this.folders.listInherited(organizationId),
      localMode ? this.sync.listInputItems(organizationId, userId) : Promise.resolve([]),
    ]);
    return {
      mode: localMode ? 'local' : serviceAccountMode ? 'service-account-staging' : 'production',
      connection: connection
        ? {
            provider: connection.provider,
            connectedAt: connection.connectedAt,
            lastSyncAt: connection.lastSyncAt,
          }
        : null,
      metrics: totals,
      queue,
      analysisFailures,
      referenceRoot,
      folders,
      inputItems,
      proposals,
      history,
    };
  }
}
