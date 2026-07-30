import { Injectable } from '@nestjs/common';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';
import { OcrInput, OcrPort } from './ocr.port';

@Injectable()
export class TesseractOcrAdapter implements OcrPort {
  async extractText(stream: ReadableStream<Uint8Array>, input: OcrInput): Promise<string> {
    const bytes = await readBytes(stream);
    const images = input.mimeType === 'application/pdf' ? await rasterizePdf(bytes) : [bytes];
    const worker = await createWorker('fra+eng');
    try {
      const texts: string[] = [];
      for (const image of images) {
        const result = await worker.recognize(image);
        texts.push(result.data.text);
      }
      return texts.join('\n').trim();
    } finally {
      await worker.terminate();
    }
  }
}

async function readBytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
      let read = await reader.read();
      while (!read.done) {
        chunks.push(read.value);
        read = await reader.read();
      }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    } finally {
      reader.releaseLock();
    }
  }

async function rasterizePdf(bytes: Buffer): Promise<Buffer[]> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  const images: Buffer[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    const renderParams: Parameters<typeof page.render>[0] = {
      canvas: canvas as never,
      canvasContext: context as never,
      viewport,
    };
    await page.render(renderParams).promise;
    images.push(canvas.toBuffer('image/png'));
  }
  return images;
}
