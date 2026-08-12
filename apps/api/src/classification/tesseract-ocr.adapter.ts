import { Injectable } from '@nestjs/common';
import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createWorker } from 'tesseract.js';
import { OcrInput, OcrPage, OcrPort, OcrResult } from './ocr.port';

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 8;
const MAX_TEXT_CHARS = 20000;
const MIN_USEFUL_CHARS = 20;
const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
]);

@Injectable()
export class TesseractOcrAdapter implements OcrPort {
  async extractText(stream: ReadableStream<Uint8Array>, input: OcrInput): Promise<OcrResult> {
    if (!SUPPORTED_MIME_TYPES.has(input.mimeType)) return emptyResult('unsupported', 'Format non supporté par OCR');
    try {
      const bytes = await readBytes(stream);
      const result = input.mimeType === 'application/pdf'
        ? await extractPdf(bytes)
        : await ocrImages([{ pageNumber: 1, image: bytes }], 1);
      return withQuality(result);
    } catch {
      return emptyResult('failed', 'Extraction illisible ou corrompue');
    }
  }
}

async function readBytes(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let total = 0;
  try {
    let read = await reader.read();
    while (!read.done) {
      total += read.value.byteLength;
      if (total > MAX_BYTES) throw new Error('OCR input too large');
      chunks.push(read.value);
      read = await reader.read();
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  } finally {
    reader.releaseLock();
  }
}

async function extractPdf(bytes: Buffer): Promise<OcrResult> {
  const task = getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const pages: OcrPage[] = [];
  const missingTextPages: Array<{ pageNumber: number; image: Buffer }> = [];
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const text = normalizeText(await getPdfPageText(page));
      if (isUsefulText(text)) {
        pages.push({ pageNumber, text, method: 'pdf-text' });
      } else {
        missingTextPages.push({ pageNumber, image: await rasterizePage(page) });
      }
    }
    if (missingTextPages.length > 0) {
      pages.push(...(await ocrImages(missingTextPages, pageCount)).pages);
    }
    pages.sort((left, right) => left.pageNumber - right.pageNumber);
    const method = pages.every((page) => page.method === 'pdf-text')
      ? 'pdf-text'
      : pages.every((page) => page.method === 'ocr')
        ? 'ocr'
        : 'mixed';
    return { text: joinPages(pages), status: 'ok', pages, pageCount: pdf.numPages, method };
  } finally {
    await task.destroy();
  }
}

async function getPdfPageText(page: { getTextContent: () => Promise<{ items: unknown[] }> }): Promise<string> {
  const content = await page.getTextContent();
  return content.items.map((item) => typeof item === 'object' && item !== null && 'str' in item ? String(item.str ?? '') : '').join('\n');
}

async function rasterizePage(page: {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: never) => { promise: Promise<unknown> };
}): Promise<Buffer> {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  const renderParams = {
    canvas: canvas as never,
    canvasContext: context as never,
    viewport,
  };
  await page.render(renderParams as never).promise;
  return canvas.toBuffer('image/png');
}

async function ocrImages(images: Array<{ pageNumber: number; image: Buffer }>, pageCount: number): Promise<OcrResult> {
  const worker = await createWorker('fra+eng');
  try {
    const pages: OcrPage[] = [];
    for (const image of images) {
      const result = await worker.recognize(image.image);
      const text = normalizeText(result.data.text);
      if (text) pages.push({ pageNumber: image.pageNumber, text, method: 'ocr' });
    }
    return { text: joinPages(pages), status: 'ok', pages, pageCount, method: pages.length ? 'ocr' : 'none' };
  } finally {
    await worker.terminate();
  }
}

function withQuality(result: OcrResult): OcrResult {
  const text = representativeText(result.pages);
  if (!isUsefulText(text)) {
    return { ...result, text, status: 'low_text', reason: 'Texte extrait insuffisant pour proposer un classement fiable' };
  }
  return { ...result, text };
}

function emptyResult(status: OcrResult['status'], reason: string): OcrResult {
  return { text: '', status, pages: [], pageCount: 0, method: 'none', reason };
}

function joinPages(pages: OcrPage[]): string {
  return pages.map((page) => page.text).filter(Boolean).join('\n\n--- page ---\n\n').slice(0, MAX_TEXT_CHARS);
}

function representativeText(pages: OcrPage[]): string {
  if (pages.length <= 3) return joinPages(pages);
  return joinPages([pages[0], pages[Math.floor(pages.length / 2)], pages[pages.length - 1]]);
}

function isUsefulText(text: string): boolean {
  return (text.match(/[a-z0-9À-ÿ]/gi) ?? []).length >= MIN_USEFUL_CHARS;
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
