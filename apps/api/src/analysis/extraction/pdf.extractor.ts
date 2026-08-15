import { createCanvas } from '@napi-rs/canvas';
import { createWorker } from 'tesseract.js';
import { DocumentInput, ExtractedDocument, ExtractedPage } from './extraction.types';
import { readDocumentBytes } from './extract';
import { normalizePages, qualityFor } from './normalize';

const MAX_PAGES = 20;

export async function extractPdf(input: DocumentInput): Promise<ExtractedDocument> {
  const { getDocument } = await importPdfJs();
  const task = getDocument({ data: new Uint8Array(await readDocumentBytes(input.content)) });
  const pdf = await task.promise;
  const pages: ExtractedPage[] = [];
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_PAGES); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const native = content.items.map((item) => typeof item === 'object' && item && 'str' in item ? String(item.str ?? '') : '').join('\n');
      if ((native.match(/[a-z0-9À-ÿ]/gi) ?? []).length >= 20) pages.push({ pageNumber, text: native, method: 'pdf-text' });
      else {
        worker ??= await createWorker('fra+eng');
        const viewport = page.getViewport({ scale: 2 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport } as never).promise;
        pages.push({ pageNumber, text: (await worker.recognize(canvas.toBuffer('image/png'))).data.text, method: 'ocr' });
      }
    }
    const text = normalizePages(pages);
    const methods = new Set(pages.map((page) => page.method));
    return { text, pages, pageCount: pdf.numPages, quality: qualityFor(text), warnings: pdf.numPages > MAX_PAGES ? ['page_limit_reached'] : [], method: methods.size > 1 ? 'mixed' : pages[0]?.method ?? 'none' };
  } finally { await worker?.terminate(); await task.destroy(); }
}

function importPdfJs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
  return new Function('specifier', 'return import(specifier)')('pdfjs-dist/legacy/build/pdf.mjs') as Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>;
}
