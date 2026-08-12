import { Injectable } from '@nestjs/common';
import { OcrPort, OcrResult } from './ocr.port';

@Injectable()
export class LocalOcrAdapter implements OcrPort {
  async extractText(stream: ReadableStream<Uint8Array>): Promise<OcrResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
      let read = await reader.read();
      while (!read.done) {
        text += decoder.decode(read.value, { stream: true });
        read = await reader.read();
      }
      text += decoder.decode();
      const normalized = normalizeText(text);
      return {
        text: normalized,
        status: normalized.length >= 20 ? 'ok' : 'low_text',
        pages: normalized ? [{ pageNumber: 1, text: normalized, method: 'ocr' }] : [],
        pageCount: normalized ? 1 : 0,
        method: normalized ? 'ocr' : 'none',
        reason: normalized.length >= 20 ? undefined : 'Texte extrait insuffisant',
      };
    } finally {
      reader.releaseLock();
    }
  }
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .split('')
    .map((char) => isControlCharacter(char) ? ' ' : char)
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code < 32 && code !== 10 && code !== 9) || code === 127;
}
