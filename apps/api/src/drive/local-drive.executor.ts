import { Injectable } from '@nestjs/common';
import { createCanvas } from '@napi-rs/canvas';
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

  async listMetadata(organizationId = 'local', userId = 'local'): Promise<DriveMetadataItem[]> {
    void userId;
    return [...this.itemsFor(organizationId).values()];
  }

  async listChildren(organizationId: string, _userId: string, parentId: string, pageToken?: string) {
    const offset = pageToken ? Number(pageToken) : 0;
    const items = [...this.itemsFor(organizationId).values()].filter((item) =>
      parentId === 'root' ? item.parents.length === 0 : item.parents.includes(parentId),
    );
    const page = items.slice(offset, offset + 100);
    return { items: page, nextPageToken: offset + page.length < items.length ? String(offset + page.length) : null };
  }

  async download(_organizationId: string, _userId: string, documentExternalId: string): Promise<ReadableStream<Uint8Array>> {
    const text = LOCAL_TEXTS.get(documentExternalId) ?? '';
    const bytes = documentExternalId === 'local_file_note_paie'
      ? renderPng(text)
      : documentExternalId === 'local_file_facture_elec' || documentExternalId === 'local_file_releve_banque'
        ? renderPdf(text)
        : new TextEncoder().encode(text);
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

function renderPng(text: string): Buffer {
  const canvas = createCanvas(1200, 240);
  const context = canvas.getContext('2d');
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'black';
  context.font = '40px sans-serif';
  context.fillText(text, 40, 130);
  return canvas.toBuffer('image/png');
}

function renderPdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 50 700 Td (${text.replace(/[\\()]/g, '\\$&')}) Tj ET`;
  const objects = [
    '1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj',
    '2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj',
    '3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>> endobj',
    `4 0 obj <</Length ${Buffer.byteLength(stream, 'latin1')}>> stream\n${stream}\nendstream\nendobj`,
    '5 0 obj <</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>> endobj',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${object}\n`; }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer <</Size 6/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}
