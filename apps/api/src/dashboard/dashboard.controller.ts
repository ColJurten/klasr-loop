import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { DriveConnectionsService } from '../drive/drive-connections.service';
import { UsageMetricsRepository } from '../metrics/usage-metrics.repository';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { ClassificationService } from '../classification/classification.service';
import { JobsService } from '../jobs/jobs.service';

@Controller('organizations/:organizationId/dashboard')
@UseGuards(InternalServiceGuard)
export class DashboardController {
  constructor(
    private readonly classification: ClassificationService,
    private readonly connections: DriveConnectionsService,
    private readonly metrics: UsageMetricsRepository,
    private readonly jobs: JobsService,
  ) {}

  @Get()
  async get(@Param('organizationId') organizationId: string) {
    const [proposals, connection, totals, history, queue] = await Promise.all([
      this.classification.listPending(organizationId),
      this.connections.findByOrganization(organizationId),
      this.metrics.totals(organizationId),
      this.classification.listHistory(organizationId),
      this.jobs.queueState(),
    ]);
    return {
      mode: process.env.KLASR_LOCAL_MVP === 'true' ? 'local' : 'production',
      connection: connection
        ? {
            provider: connection.provider,
            connectedAt: connection.connectedAt,
            lastSyncAt: connection.lastSyncAt,
          }
        : null,
      metrics: totals,
      queue,
      proposals,
      history,
    };
  }
}
