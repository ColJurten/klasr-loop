import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DocumentsRepository } from '../documents/documents.repository';
import { DriveConnectionsService } from '../drive/drive-connections.service';
import { DriveMetadataItem, DriveMetadataPage, isFolder } from '../drive/google-drive.executor';
import { FoldersRepository } from '../drive/folders.repository';
import { JobsService } from '../jobs/jobs.service';
import { UsageMetricsRepository } from '../metrics/usage-metrics.repository';
import { DRIVE_EXECUTOR } from './drive-executor.port';

interface MetadataLister {
  listMetadata(organizationId: string): Promise<DriveMetadataItem[]>;
  listChildren?(organizationId: string, parentId: string, pageToken?: string): Promise<DriveMetadataPage>;
}

const SUPPORTED = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/tiff']);
const FOLDER_MIME = 'application/vnd.google-apps.folder';

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

  async syncOrganization(organizationId: string): Promise<{ enqueued: number; manual: number }> {
    const reference = await this.folders?.getReferenceRoot(organizationId);
    if (!reference) throw new BadRequestException('Reference root is required before launch');
    return this.launchDriveItem(organizationId, 'all');
  }

  async listReferenceFolderChoices(organizationId: string) {
    const metadata = await this.drive.listMetadata(organizationId);
    return metadata.filter(isFolder).map((item) => ({
      externalId: item.id,
      name: item.name,
      parentExternalId: item.parents[0] ?? null,
    }));
  }

  async selectReferenceRoot(organizationId: string, folderExternalId: string) {
    if (!this.folders) throw new Error('Folder repository unavailable');
    const metadata = await this.drive.listMetadata(organizationId);
    const root = metadata.find((item) => item.id === folderExternalId && isFolder(item));
    if (!root) throw new NotFoundException('Reference folder not found');
    const folderItems = metadata.filter(isFolder).map(({ id, name, parents }) => ({ id, name, parents }));
    return {
      referenceRoot: { externalId: root.id, name: root.name },
      folders: await this.folders.replaceReferenceRoot(organizationId, { externalId: root.id, name: root.name }, folderItems),
    };
  }

  async listInputItems(organizationId: string): Promise<DriveInputItemView[]> {
    const reference = await this.folders?.getReferenceRoot(organizationId);
    const holding = new Set((await this.folders?.listInherited(organizationId, true))?.filter((folder) => folder.holding).map((folder) => folder.externalId) ?? []);
    const metadata = await this.drive.listMetadata(organizationId);
    return metadata
      .filter((item) => item.id !== reference?.externalId)
      .map((item) => {
        const folder = isFolder(item);
        const insideHoldingTree = isInSubtree(metadata, item, holding);
        const supported = folder || SUPPORTED.has(item.mimeType);
        return {
          externalId: item.id,
          name: item.name,
          mimeType: item.mimeType,
          type: folder ? 'folder' : 'file',
          parentExternalId: item.parents[0] ?? null,
          supported,
          eligible: Boolean(reference) && !insideHoldingTree && supported,
          reason: !reference
            ? 'reference-required'
            : insideHoldingTree
              ? 'inside-holding-tree'
              : supported
                ? undefined
                : 'unsupported',
        };
      });
  }

  async listDriveItems(organizationId: string, parentId: string, pageToken?: string) {
    const reference = await this.folders?.getReferenceRoot(organizationId);
    const holding = new Set((await this.folders?.listInherited(organizationId, true))?.filter((folder) => folder.holding).map((folder) => folder.externalId) ?? []);
    if (holding.has(parentId)) throw new BadRequestException('Holding tree cannot be browsed as input');
    const page = this.drive.listChildren
      ? await this.drive.listChildren(organizationId, parentId, pageToken)
      : { items: (await this.drive.listMetadata(organizationId)).filter((item) => parentId === 'root' ? item.parents.length === 0 : item.parents.includes(parentId)), nextPageToken: null };
    return {
      items: page.items.map((item) => {
        const folder = isFolder(item);
        const supported = folder || SUPPORTED.has(item.mimeType);
        const excluded = item.id === reference?.externalId || holding.has(item.id);
        return {
          externalId: item.id, name: item.name, mimeType: item.mimeType, type: folder ? 'folder' as const : 'file' as const,
          parentExternalId: item.parents[0] ?? null, supported, eligible: (!reference && folder) || (Boolean(reference) && supported && !excluded),
          reason: !reference ? (folder ? undefined : 'reference-required') : excluded ? (item.id === reference.externalId ? 'reference-root' : 'inside-holding-tree') : supported ? undefined : 'unsupported',
        };
      }),
      nextPageToken: page.nextPageToken,
    };
  }

  async launchDriveItem(organizationId: string, itemExternalId: string): Promise<{ enqueued: number; manual: number }> {
    const reference = await this.folders?.getReferenceRoot(organizationId);
    if (!reference) throw new BadRequestException('Reference root is required before launch');
    const metadata = await this.drive.listMetadata(organizationId);
    const holding = new Set((await this.folders?.listInherited(organizationId, true))?.filter((folder) => folder.holding).map((folder) => folder.externalId) ?? []);
    const selected = itemExternalId === 'all'
      ? metadata.find((item) => item.id === 'local_input_folder') ?? metadata.find((item) => !isFolder(item))
      : metadata.find((item) => item.id === itemExternalId);
    if (!selected) throw new NotFoundException('Drive input item not found');
    if (selected.id === reference.externalId || isInSubtree(metadata, selected, holding)) {
      throw new BadRequestException('Reference or holding tree cannot be used as input');
    }
    const selectedFiles = expandSelectedFiles(metadata, selected.id, holding);
    let enqueued = 0;
    let manual = 0;
    for (const item of selectedFiles) {
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

function expandSelectedFiles(metadata: DriveMetadataItem[], selectedExternalId: string, excludedFolders = new Set<string>()): DriveMetadataItem[] {
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
    if (isInSubtree(metadata, item, excludedFolders)) continue;
    if (item.mimeType === FOLDER_MIME) {
      queue.push(...(childrenByParent.get(item.id) ?? []));
    } else {
      files.push(item);
    }
  }
  return files;
}

function isInSubtree(metadata: DriveMetadataItem[], item: DriveMetadataItem, roots: Set<string>): boolean {
  if (roots.has(item.id)) return true;
  const byId = new Map(metadata.map((entry) => [entry.id, entry]));
  const queue = [...item.parents];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (roots.has(id)) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...(byId.get(id)?.parents ?? []));
  }
  return false;
}
