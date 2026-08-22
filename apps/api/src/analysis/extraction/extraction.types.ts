export type ExtractionQuality = 'ok' | 'sparse' | 'empty' | 'failed';

export interface DocumentInput {
  organizationId?: string;
  content: Buffer | ReadableStream<Uint8Array>;
  mimeType: string;
  originalName: string;
}

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  method: 'pdf-text' | 'ocr' | 'text';
}

export interface ExtractedDocument {
  text: string;
  pages: ExtractedPage[];
  pageCount: number;
  quality: ExtractionQuality;
  warnings: string[];
  method: 'pdf-text' | 'ocr' | 'mixed' | 'text' | 'none';
}
