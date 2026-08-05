import { Injectable } from '@nestjs/common';
import { DriveExecutor, MoveRenameCommand } from '../classification/drive-executor.port';
import { DriveMetadataItem } from './google-drive.executor';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const LOCAL_TEXTS = new Map<string, string>([
  ['local_file_facture_elec', 'facture électricité juillet cabinet exemple comptabilité'],
  ['local_file_releve_banque', 'relevé bancaire juillet cabinet exemple comptabilité banque'],
  ['local_file_note_paie', 'bulletin paie juillet social ressources humaines'],
]);

@Injectable()
export class LocalDriveExecutor implements DriveExecutor {
  private readonly stateByOrganization = new Map<string, Map<string, DriveMetadataItem>>();
  private readonly initialItems: DriveMetadataItem[] = [
    { id: 'local_root_cabinet', name: 'Cabinet de démonstration', mimeType: FOLDER_MIME, sizeBytes: 0, parents: [] },
    { id: 'local_folder_compta', name: 'Comptabilité', mimeType: FOLDER_MIME, sizeBytes: 0, parents: ['local_root_cabinet'] },
    { id: 'local_folder_elec', name: 'Électricité', mimeType: FOLDER_MIME, sizeBytes: 0, parents: ['local_folder_compta'] },
    { id: 'local_folder_banque', name: 'Banque', mimeType: FOLDER_MIME, sizeBytes: 0, parents: ['local_folder_compta'] },
    { id: 'local_folder_social', name: 'Social', mimeType: FOLDER_MIME, sizeBytes: 0, parents: ['local_root_cabinet'] },
    { id: 'local_folder_paie', name: 'Paie', mimeType: FOLDER_MIME, sizeBytes: 0, parents: ['local_folder_social'] },
    { id: 'local_input_folder', name: 'À classer', mimeType: FOLDER_MIME, sizeBytes: 0, parents: [] },
    { id: 'local_nested_input', name: 'Sous-lot juillet', mimeType: FOLDER_MIME, sizeBytes: 0, parents: ['local_input_folder'] },
    { id: 'local_file_facture_elec', name: 'scan-facture-electricite.pdf', mimeType: 'application/pdf', sizeBytes: 128, parents: ['local_input_folder'] },
    { id: 'local_file_releve_banque', name: 'releve-banque-juillet.pdf', mimeType: 'application/pdf', sizeBytes: 128, parents: ['local_input_folder'] },
    { id: 'local_file_note_paie', name: 'note-paie-juillet.png', mimeType: 'image/png', sizeBytes: 128, parents: ['local_nested_input'] },
    { id: 'local_file_unsupported', name: 'archive.zip', mimeType: 'application/zip', sizeBytes: 128, parents: ['local_input_folder'] },
  ];
  private readonly moved = new Map<string, MoveRenameCommand>();

  async listMetadata(organizationId = 'local'): Promise<DriveMetadataItem[]> {
    return [...this.itemsFor(organizationId).values()];
  }

  async listChildren(organizationId: string, parentId: string, pageToken?: string) {
    const offset = pageToken ? Number(pageToken) : 0;
    const items = [...this.itemsFor(organizationId).values()].filter((item) =>
      parentId === 'root' ? item.parents.length === 0 : item.parents.includes(parentId),
    );
    const page = items.slice(offset, offset + 100);
    return { items: page, nextPageToken: offset + page.length < items.length ? String(offset + page.length) : null };
  }

  async download(_organizationId: string, documentExternalId: string): Promise<ReadableStream<Uint8Array>> {
    const bytes = new TextEncoder().encode(LOCAL_TEXTS.get(documentExternalId) ?? '');
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  async moveAndRename(command: MoveRenameCommand): Promise<void> {
    const item = this.itemsFor(command.organizationId).get(command.documentExternalId);
    if (item) {
      item.parents = command.destinationFolderExternalId ? [command.destinationFolderExternalId] : item.parents;
      if (command.rename !== false) item.name = command.newName;
    }
    this.moved.set(`${command.organizationId}:${command.documentExternalId}`, command);
  }

  async ensureHoldingFolder(_organizationId: string, referenceRootExternalId: string): Promise<DriveMetadataItem> {
    const items = this.itemsFor(_organizationId);
    const existing = [...items.values()].find(
      (item) => item.mimeType === FOLDER_MIME && item.name === 'À traiter manuellement' && item.parents.includes(referenceRootExternalId),
    );
    if (existing) return existing;
    const folder = {
      id: `local_holding_${referenceRootExternalId}`,
      name: 'À traiter manuellement',
      mimeType: FOLDER_MIME,
      sizeBytes: 0,
      parents: [referenceRootExternalId],
    };
    items.set(folder.id, folder);
    return folder;
  }

  private itemsFor(organizationId: string): Map<string, DriveMetadataItem> {
    const existing = this.stateByOrganization.get(organizationId);
    if (existing) return existing;
    const fresh = new Map(
      this.initialItems.map((item) => [
        item.id,
        { ...item, parents: [...item.parents] },
      ]),
    );
    this.stateByOrganization.set(organizationId, fresh);
    return fresh;
  }
}
