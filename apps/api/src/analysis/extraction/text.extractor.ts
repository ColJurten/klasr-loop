import { DocumentInput, ExtractedDocument } from './extraction.types';
import { normalizePages, qualityFor } from './normalize';
import { readDocumentBytes } from './extract';

export async function extractTextFile(input: DocumentInput): Promise<ExtractedDocument> {
  const text = normalizePages([{ pageNumber: 1, text: (await readDocumentBytes(input.content)).toString('utf8'), method: 'text' }]);
  return { text, pages: [{ pageNumber: 1, text, method: 'text' }], pageCount: 1, quality: qualityFor(text), warnings: [], method: 'text' };
}
