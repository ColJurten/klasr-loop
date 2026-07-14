import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { ClassificationController } from './classification.controller';
import { ClassificationService } from './classification.service';
import { ProposalsRepository } from './proposals.repository';
import { DRIVE_EXECUTOR } from './drive-executor.port';
import { NoopDriveExecutor } from './noop-drive.executor';

@Module({
  imports: [DocumentsModule],
  controllers: [ClassificationController],
  providers: [
    ClassificationService,
    ProposalsRepository,
    // Port/adapter: swap NoopDriveExecutor for GoogleDriveExecutor / OneDriveExecutor
    // when the drive module lands. Keeps the confirm flow testable today.
    { provide: DRIVE_EXECUTOR, useClass: NoopDriveExecutor },
  ],
})
export class ClassificationModule {}
