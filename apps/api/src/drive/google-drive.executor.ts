import { Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class GoogleDriveExecutor implements DriveExecutor {
  constructor(
    private readonly tokens: GoogleTokenService,
    private readonly folders: FoldersRepository,
  ) {}

  async listMetadata(organizationId: string): Promise<DriveMetadataItem[]> {
    const accessToken = await this.tokens.getAccessToken(organizationId);
    const response = await fetch(
      'https://www.googleapis.com/drive/v3/files?pageSize=1000&fields=files(id,name,mimeType,size,parents)',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) throw new Error(`Google Drive list failed: ${response.status}`);
    const payload = (await response.json()) as {
      files?: Array<{ id: string; name: string; mimeType: string; size?: string; parents?: string[] }>;
    };
    return (payload.files ?? []).map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: Number(file.size ?? 0),
      parents: file.parents ?? [],
    }));
  }

  async download(organizationId: string, documentExternalId: string): Promise<ReadableStream<Uint8Array>> {
    const accessToken = await this.tokens.getAccessToken(organizationId);
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(documentExternalId)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok || !response.body) throw new Error(`Google Drive download failed: ${response.status}`);
    return response.body as ReadableStream<Uint8Array>;
  }

  async moveAndRename(command: MoveRenameCommand): Promise<void> {
    const destination = await this.folders.findByPath(command.organizationId, command.destinationPath);
    if (!destination) throw new NotFoundException('Destination folder not found');
    const accessToken = await this.tokens.getAccessToken(command.organizationId);
    const metadataResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(command.documentExternalId)}?fields=parents`,
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
        body: JSON.stringify({ name: command.newName }),
      },
    );
    if (!response.ok) throw new Error(`Google Drive move/rename failed: ${response.status}`);
  }
}

export function isFolder(item: DriveMetadataItem): boolean {
  return item.mimeType === FOLDER_MIME;
}
