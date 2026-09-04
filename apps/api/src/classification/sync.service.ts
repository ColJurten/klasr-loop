import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DocumentsRepository } from '../documents/documents.repository';
import { DriveConnectionsService } from '../drive/drive-connections.service';
import { DriveMetadataItem, DriveMetadataPage, isFolder } from '../drive/google-drive.executor';
import { FoldersRepository } from '../drive/folders.repository';
import { JobsService } from '../jobs/jobs.service';
import { UsageMetricsRepository } from '../metrics/usage-metrics.repository';
import { DRIVE_EXECUTOR } from './drive-executor.port';

interface MetadataLister {
  listMetadata(organizationId: string, userId: string): Promise<DriveMetadataItem[]>;
  listChildren?(organizationId: string, userId: string, parentId: string, pageToken?: string): Promise<DriveMetadataPage>;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAX_ANALYSIS_BYTES = 20 * 1024 * 1024;
function isDownloadable(item: DriveMetadataItem): boolean { return !item.mimeType.startsWith('application/vnd.google-apps.') && item.sizeBytes <= MAX_ANALYSIS_BYTES; }

export interface DriveInputItemView {
  externalId: string;
  name: string;
  mimeType: string;
  type: 'folder' | 'file';
  parentExternalId: string | null;
  supported: boolean;
  eligible: boolean;
  reason?: string;
}

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

  async syncOrganization(organizationId: string, userId = ''): Promise<{ enqueued: number; manual: number }> {
    const reference = await this.folders?.getReferenceRoot(organizationId);
    if (!reference) throw new BadRequestException('Reference root is required before launch');
    return this.launchDriveItem(organizationId, userId, 'all');
  }

  async listReferenceFolderChoices(organizationId: string, userId = '') {
    const metadata = await this.drive.listMetadata(organizationId, userId);
    return metadata.filter(isFolder).map((item) => ({
      externalId: item.id,
      name: item.name,
      parentExternalId: item.parents[0] ?? null,
    }));
  }

  async selectReferenceRoot(organizationId: string, userId: string, folderExternalId?: string) {
    if (folderExternalId === undefined) [folderExternalId, userId] = [userId, ''];
    if (!this.folders) throw new Error('Folder repository unavailable');
    const metadata = await this.drive.listMetadata(organizationId, userId);
    const root = metadata.find((item) => item.id === folderExternalId && isFolder(item));
    if (!root) throw new NotFoundException('Reference folder not found');
    const folderItems = metadata.filter(isFolder).map(({ id, name, parents }) => ({ id, name, parents }));
    const folders = await this.folders.replaceReferenceRoot(organizationId, { externalId: root.id, name: root.name }, folderItems);
    await this.connections?.touchSync(organizationId, userId);
    return {
      referenceRoot: { externalId: root.id, name: root.name },
      folders,
    };
  }

  async listInputItems(organizationId: string, userId = ''): Promise<DriveInputItemView[]> {
    const reference = await this.folders?.getReferenceRoot(organizationId);
    const metadata = await this.drive.listMetadata(organizationId, userId);
    return metadata
      .filter((item) => item.id !== reference?.externalId)
      .map((item) => {
        const folder = isFolder(item);
        const supported = folder || isDownloadable(item);
        return {
          externalId: item.id,
          name: item.name,
          mimeType: item.mimeType,
          type: folder ? 'folder' : 'file',
          parentExternalId: item.parents[0] ?? null,
          supported,
          eligible: Boolean(reference) && supported,
          reason: !reference
            ? 'reference-required'
            : supported
                ? undefined
                : 'unsupported',
        };
      });
  }

  async listDriveItems(organizationId: string, userId: string, parentId?: string, pageToken?: string) {
    if (parentId === undefined) [parentId, userId] = [userId, ''];
    const reference = await this.folders?.getReferenceRoot(organizationId);
    const page = this.drive.listChildren
      ? await this.drive.listChildren(organizationId, userId, parentId, pageToken)
      : { items: (await this.drive.listMetadata(organizationId, userId)).filter((item) => parentId === 'root' ? item.parents.length === 0 : item.parents.includes(parentId)), nextPageToken: null };
    return {
      items: page.items.map((item) => {
        const folder = isFolder(item);
        const supported = folder || isDownloadable(item);
        const excluded = item.id === reference?.externalId;
        return {
          externalId: item.id, name: item.name, mimeType: item.mimeType, type: folder ? 'folder' as const : 'file' as const,
          parentExternalId: item.parents[0] ?? null, supported, eligible: (!reference && folder) || (Boolean(reference) && supported && !excluded),
          reason: !reference ? (folder ? undefined : 'reference-required') : excluded ? 'reference-root' : supported ? undefined : 'unsupported',
        };
      }),
      nextPageToken: page.nextPageToken,
    };
  }

  async launchDriveItem(organizationId: string, userId: string, itemExternalId?: string): Promise<{ enqueued: number; manual: number }> {
    if (itemExternalId === undefined) [itemExternalId, userId] = [userId, ''];
    const reference = await this.folders?.getReferenceRoot(organizationId);
    if (!reference) throw new BadRequestException('Reference root is required before launch');
    const metadata = await this.drive.listMetadata(organizationId, userId);
    const selected = itemExternalId === 'all'
      ? metadata.find((item) => item.id === 'local_input_folder') ?? metadata.find((item) => !isFolder(item))
      : metadata.find((item) => item.id === itemExternalId);
    if (!selected) throw new NotFoundException('Drive input item not found');
    if (selected.id === reference.externalId) {
      throw new BadRequestException('Reference tree cannot be used as input');
    }
    const selectedFiles = expandSelectedFiles(metadata, selected.id);
    let enqueued = 0;
    let manual = 0;
    for (const item of selectedFiles) {
      const supported = isDownloadable(item);
      const document = await this.repository.upsertDocumentMetadata(organizationId, {
        externalId: item.id,
        name: item.name,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        folderExternalId: item.parents[0],
        supported,
      });
      if (supported && document.status === 'PENDING') {
        await this.jobs.enqueueAnalysis({ organizationId, ...(userId ? { userId } : {}), documentId: document.id } as { organizationId: string; userId: string; documentId: string });
        enqueued += 1;
      }
      if (!supported) {
        await this.repository.markManual(organizationId, document.id);
        manual += 1;
      }
    }
    await this.metrics.increment(organizationId, { documentsIn: enqueued + manual });
    await this.connections?.touchSync(organizationId, userId);
    return { enqueued, manual };
  }
}

function expandSelectedFiles(metadata: DriveMetadataItem[], selectedExternalId: string): DriveMetadataItem[] {
  const selected = metadata.find((item) => item.id === selectedExternalId);
  if (!selected) return [];
  if (!isFolder(selected)) return [selected];
  const childrenByParent = new Map<string, DriveMetadataItem[]>();
  for (const item of metadata) {
    for (const parent of item.parents) {
      const children = childrenByParent.get(parent) ?? [];
      children.push(item);
      childrenByParent.set(parent, children);
    }
  }
  const files: DriveMetadataItem[] = [];
  const queue = [...(childrenByParent.get(selectedExternalId) ?? [])];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.mimeType === FOLDER_MIME) {
      queue.push(...(childrenByParent.get(item.id) ?? []));
    } else {
      files.push(item);
    }
  }
  return files;
}
