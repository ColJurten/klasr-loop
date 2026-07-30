import { Injectable } from '@nestjs/common';
import { OcrPort } from './ocr.port';

@Injectable()
export class LocalOcrAdapter implements OcrPort {
  async extractText(stream: ReadableStream<Uint8Array>): Promise<string> {
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
      return text;
    } finally {
      reader.releaseLock();
    }
  }
}
