import { Injectable } from '@nestjs/common';
import { DriveExecutor, MoveRenameCommand } from '../classification/drive-executor.port';
import { DriveMetadataItem } from './google-drive.executor';

const LOCAL_TEXT = 'facture électricité juillet cabinet exemple comptabilité';

@Injectable()
export class LocalDriveExecutor implements DriveExecutor {
  private readonly moved = new Map<string, MoveRenameCommand>();

  async listMetadata(): Promise<DriveMetadataItem[]> {
    return [
      { id: 'local_folder_compta', name: 'Comptabilité', mimeType: 'application/vnd.google-apps.folder', sizeBytes: 0, parents: [] },
      { id: 'local_folder_elec', name: 'Électricité', mimeType: 'application/vnd.google-apps.folder', sizeBytes: 0, parents: ['local_folder_compta'] },
      { id: 'local_file_facture', name: 'scan-facture-electricite.pdf', mimeType: 'application/pdf', sizeBytes: 128, parents: ['local_folder_compta'] },
    ];
  }

  async download(): Promise<ReadableStream<Uint8Array>> {
    const bytes = new TextEncoder().encode(LOCAL_TEXT);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  async moveAndRename(command: MoveRenameCommand): Promise<void> {
    this.moved.set(`${command.organizationId}:${command.documentExternalId}`, command);
  }
}
