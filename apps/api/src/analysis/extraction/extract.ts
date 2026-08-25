import { DocumentInput, ExtractedDocument } from './extraction.types';
import { extractImage } from './image.extractor';
import { extractUnsupportedOffice } from './office.extractor';
import { extractPdf } from './pdf.extractor';
import { extractTextFile } from './text.extractor';

const MAX_BYTES = 20 * 1024 * 1024;
const IMAGES = new Set(['image/png', 'image/jpeg', 'image/tiff']);
const TEXT = new Set(['text/plain', 'text/csv', 'application/json', 'text/markdown']);

export async function extract(input: DocumentInput): Promise<ExtractedDocument> {
  try {
    if (input.mimeType === 'application/pdf') return await extractPdf(input);
    if (IMAGES.has(input.mimeType)) return await extractImage(input);
    if (TEXT.has(input.mimeType) || input.mimeType.startsWith('text/')) return await extractTextFile(input);
    return extractUnsupportedOffice();
  } catch {
    return { text: '', pages: [], pageCount: 0, quality: 'failed', method: 'none', warnings: ['corrupt_or_unreadable'] };
  }
}

export async function readDocumentBytes(content: DocumentInput['content']): Promise<Buffer> {
  if (Buffer.isBuffer(content)) {
    if (content.length > MAX_BYTES) throw new Error('input_too_large');
    return content;
  }
  const reader = content.getReader(); const chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > MAX_BYTES) throw new Error('input_too_large'); chunks.push(Buffer.from(item.value)); }
    return Buffer.concat(chunks);
  } finally { reader.releaseLock(); }
}
