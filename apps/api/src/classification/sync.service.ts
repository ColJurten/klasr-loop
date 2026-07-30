import { Inject, Injectable, Optional } from '@nestjs/common';
import { DocumentsRepository } from '../documents/documents.repository';
import { DriveConnectionsService } from '../drive/drive-connections.service';
import { DriveMetadataItem, isFolder } from '../drive/google-drive.executor';
import { FoldersRepository } from '../drive/folders.repository';
import { JobsService } from '../jobs/jobs.service';
import { UsageMetricsRepository } from '../metrics/usage-metrics.repository';
import { DRIVE_EXECUTOR } from './drive-executor.port';

interface MetadataLister {
  listMetadata(organizationId: string): Promise<DriveMetadataItem[]>;
}

const SUPPORTED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/tiff']);

@Injectable()
export class SyncService {
  constructor(
    @Inject(DRIVE_EXECUTOR) private readonly drive: MetadataLister,
    private readonly repository: DocumentsRepository,
    private readonly jobs: JobsService,
    private readonly metrics: UsageMetricsRepository,
    @Optional() private readonly folders?: FoldersRepository,
    @Optional() private readonly connections?: DriveConnectionsService,
  ) {}

  async syncOrganization(organizationId: string): Promise<{ enqueued: number; manual: number }> {
    const metadata = await this.drive.listMetadata(organizationId);
    const folderItems = metadata.filter(isFolder).map(({ id, name, parents }) => ({ id, name, parents }));
    if (this.folders) {
      await this.folders.upsertFolderTree(organizationId, folderItems);
    } else if ('upsertFolderTree' in this.repository) {
      await (
        this.repository as unknown as {
          upsertFolderTree(organizationId: string, folders: typeof folderItems): Promise<void>;
        }
      ).upsertFolderTree(organizationId, folderItems);
    }

    let enqueued = 0;
    let manual = 0;
    for (const item of metadata.filter((entry) => !isFolder(entry))) {
      const supported = SUPPORTED.has(item.mimeType);
      const document = await this.repository.upsertDocumentMetadata(organizationId, {
        externalId: item.id,
        name: item.name,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        folderExternalId: item.parents[0],
        supported,
      });
      if (supported && document.status === 'PENDING') {
        await this.jobs.enqueueAnalysis({ organizationId, documentId: document.id });
        enqueued += 1;
      }
      if (!supported) {
        await this.repository.markManual(organizationId, document.id);
        manual += 1;
      }
    }
    await this.metrics.increment(organizationId, { documentsIn: enqueued + manual });
    await this.connections?.touchSync(organizationId);
    if (process.env.KLASR_LOCAL_MVP === 'true' && process.env.KLASR_INLINE_WORKER === 'true') {
      await this.jobs.waitForAnalysisIdle();
    }
    return { enqueued, manual };
  }
}
