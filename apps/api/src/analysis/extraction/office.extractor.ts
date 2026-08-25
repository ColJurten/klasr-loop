import { ExtractedDocument } from './extraction.types';

export function extractUnsupportedOffice(): ExtractedDocument {
  return { text: '', pages: [], pageCount: 0, quality: 'failed', method: 'none', warnings: ['office_extractor_unavailable'] };
}
