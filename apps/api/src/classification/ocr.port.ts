export interface OcrInput {
  filename: string;
  mimeType: string;
}

export const OCR_PORT = Symbol('OCR_PORT');

export interface OcrPort {
  extractText(stream: ReadableStream<Uint8Array>, input: OcrInput): Promise<string>;
}
