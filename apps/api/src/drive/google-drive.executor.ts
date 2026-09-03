import { BadGatewayException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { appendFileSync } from 'node:fs';
import { DriveExecutor, MoveRenameCommand } from '../classification/drive-executor.port';
import { FoldersRepository } from './folders.repository';
import { GoogleTokenService } from './google-token.service';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveMetadataItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  parents: string[];
}

export interface DriveMetadataPage { items: DriveMetadataItem[]; nextPageToken: string | null; }

@Injectable()
export class GoogleDriveExecutor implements DriveExecutor {
  constructor(
    private readonly tokens: GoogleTokenService,
    private readonly folders: FoldersRepository,
  ) {}

  async listMetadata(organizationId: string, userId = ''): Promise<DriveMetadataItem[]> {
    const accessToken = await this.tokens.getAccessToken(organizationId, userId);
    const files: Array<{ id: string; name: string; mimeType: string; size?: string; parents?: string[] }> = [];
    let pageToken: string | undefined;
    do {
      const search = new URLSearchParams({
        pageSize: '1000',
        fields: 'nextPageToken,files(id,name,mimeType,size,parents)',
        q: 'trashed=false',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) search.set('pageToken', pageToken);
      const response = await fetch(`https://www.googleapis.com/drive/v3/files?${search}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throwGoogleError('list', response.status);
      const payload = (await response.json()) as {
        nextPageToken?: string;
        files?: Array<{ id: string; name: string; mimeType: string; size?: string; parents?: string[] }>;
      };
      files.push(...(payload.files ?? []));
      pageToken = payload.nextPageToken;
    } while (pageToken);
    return files.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: Number(file.size ?? 0),
      parents: file.parents ?? [],
    }));
  }

  async listChildren(organizationId: string, userId: string, parentId?: string, pageToken?: string): Promise<DriveMetadataPage> {
    if (arguments.length <= 3) [pageToken, parentId, userId] = [parentId, userId, ''];
    const accessToken = await this.tokens.getAccessToken(organizationId, userId);
    const effectiveParentId = parentId === 'root' && process.env.KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT === 'true'
      ? process.env.KLASR_GOOGLE_DRIVE_ROOT_ID ?? parentId
      : parentId!;
    const search = new URLSearchParams({
      pageSize: '100', fields: 'nextPageToken,files(id,name,mimeType,size,parents)',
      q: `'${effectiveParentId.replace(/'/g, "\\'")}' in parents and trashed=false`,
      supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', orderBy: 'folder,name_natural',
    });
    if (pageToken) search.set('pageToken', pageToken);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${search}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throwGoogleError('list', response.status);
    const payload = (await response.json()) as { nextPageToken?: string; files?: Array<{ id: string; name: string; mimeType: string; size?: string; parents?: string[] }> };
    return {
      items: (payload.files ?? []).map((file) => ({ id: file.id, name: file.name, mimeType: file.mimeType, sizeBytes: Number(file.size ?? 0), parents: file.parents ?? [] })),
      nextPageToken: payload.nextPageToken ?? null,
    };
  }

  async download(organizationId: string, userId: string, documentExternalId?: string): Promise<ReadableStream<Uint8Array>> {
    if (documentExternalId === undefined) [documentExternalId, userId] = [userId, ''];
    const accessToken = await this.tokens.getAccessToken(organizationId, userId);
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(documentExternalId)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok || !response.body) throw new Error(`Google Drive download failed: ${response.status}`);
    return response.body as ReadableStream<Uint8Array>;
  }

  async moveAndRename(command: MoveRenameCommand): Promise<void> {
    if (process.env.KLASR_DRIVE_MUTATION_LOG) appendFileSync(process.env.KLASR_DRIVE_MUTATION_LOG, 'files.update\n');
    const destination = command.destinationFolderExternalId
      ? await this.folders.findByExternalId(command.organizationId, command.destinationFolderExternalId)
      : command.destinationPath
        ? await this.folders.findByPath(command.organizationId, command.destinationPath)
        : null;
    if (!destination) throw new NotFoundException('Destination folder not found');
    const accessToken = await this.tokens.getAccessToken(command.organizationId, command.userId ?? '');
    const metadataResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(command.documentExternalId)}?fields=parents&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!metadataResponse.ok) {
      throw new Error(`Google Drive metadata lookup failed: ${metadataResponse.status}`);
    }
    const metadata = (await metadataResponse.json()) as { parents?: string[] };
    const oldParents = (metadata.parents ?? []).filter((parent) => parent !== destination.externalId);
    const params = new URLSearchParams({
      addParents: destination.externalId,
      fields: 'id,name,parents',
      supportsAllDrives: 'true',
    });
    if (oldParents.length > 0) {
      params.set('removeParents', oldParents.join(','));
    }
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(command.documentExternalId)}?${params}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command.rename === false ? {} : { name: command.newName }),
      },
    );
    if (!response.ok) throw new Error(`Google Drive move/rename failed: ${response.status}`);
  }

}

export function isFolder(item: DriveMetadataItem): boolean {
  return item.mimeType === FOLDER_MIME;
}

function throwGoogleError(operation: string, status: number): never {
  if ([400, 401, 404, 409].includes(status)) throw new HttpException(`Google Drive ${operation} failed`, status);
  throw new BadGatewayException(`Google Drive ${operation} failed`);
}
