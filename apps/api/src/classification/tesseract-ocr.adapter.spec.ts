import { createWorker } from 'tesseract.js';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { TesseractOcrAdapter } from './tesseract-ocr.adapter';

jest.mock('tesseract.js', () => ({ createWorker: jest.fn() }));
jest.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: jest.fn() }));
jest.mock('@napi-rs/canvas', () => ({ createCanvas: jest.fn() }));

describe('TesseractOcrAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rasterizes each PDF page to PNG before OCR', async () => {
    const recognize = jest.fn().mockResolvedValue({ data: { text: 'facture OCR' } });
    const terminate = jest.fn().mockResolvedValue(undefined);
    (createWorker as jest.Mock).mockResolvedValue({ recognize, terminate });
    const render = jest.fn().mockReturnValue({ promise: Promise.resolve() });
    const getPage = jest.fn().mockResolvedValue({
      getViewport: jest.fn().mockReturnValue({ width: 200, height: 100 }),
      render,
    });
    (getDocument as jest.Mock).mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage }) });
    const toBuffer = jest.fn().mockReturnValue(Buffer.from('png-bytes'));
    const context = {};
    (createCanvas as jest.Mock).mockReturnValue({ getContext: () => context, toBuffer });
    const adapter = new TesseractOcrAdapter();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from('%PDF-1.4'));
        controller.close();
      },
    });

    await expect(
      adapter.extractText(stream, { filename: 'scan.pdf', mimeType: 'application/pdf' }),
    ).resolves.toBe('facture OCR');

    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Uint8Array) }));
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ canvasContext: context, viewport: { width: 200, height: 100 } }),
    );
    expect(recognize).toHaveBeenCalledWith(Buffer.from('png-bytes'));
    expect(terminate).toHaveBeenCalled();
  });
});
