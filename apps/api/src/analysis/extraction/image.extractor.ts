import { createWorker } from 'tesseract.js';
import { DocumentInput, ExtractedDocument } from './extraction.types';
import { readDocumentBytes } from './extract';
import { normalizePages, qualityFor } from './normalize';

export async function extractImage(input: DocumentInput): Promise<ExtractedDocument> {
  const worker = await createWorker('fra+eng');
  try {
    const result = await worker.recognize(await readDocumentBytes(input.content));
    const pages = [{ pageNumber: 1, text: result.data.text, method: 'ocr' as const }];
    const text = normalizePages(pages);
    return { text, pages, pageCount: 1, quality: qualityFor(text), warnings: [], method: 'ocr' };
  } finally { await worker.terminate(); }
}
