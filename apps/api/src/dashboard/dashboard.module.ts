import { Module } from '@nestjs/common';
import { ClassificationModule } from '../classification/classification.module';
import { DriveModule } from '../drive/drive.module';
import { JobsModule } from '../jobs/jobs.module';
import { UsageMetricsRepository } from '../metrics/usage-metrics.repository';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [ClassificationModule, DriveModule, JobsModule],
  controllers: [DashboardController],
  providers: [UsageMetricsRepository],
})
export class DashboardModule {}
