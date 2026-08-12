export interface OcrInput {
  filename: string;
  mimeType: string;
}

export type OcrStatus = 'ok' | 'low_text' | 'unsupported' | 'failed';

export interface OcrPage {
  pageNumber: number;
  text: string;
  method: 'pdf-text' | 'ocr';
}

export interface OcrResult {
  text: string;
  status: OcrStatus;
  pages: OcrPage[];
  pageCount: number;
  method: 'pdf-text' | 'ocr' | 'mixed' | 'none';
  reason?: string;
}

export const OCR_PORT = Symbol('OCR_PORT');

export interface OcrPort {
  extractText(stream: ReadableStream<Uint8Array>, input: OcrInput): Promise<OcrResult>;
}
