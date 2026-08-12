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
    const recognize = jest.fn().mockResolvedValue({ data: { text: 'facture OCR fournisseur acme' } });
    const terminate = jest.fn().mockResolvedValue(undefined);
    (createWorker as jest.Mock).mockResolvedValue({ recognize, terminate });
    const render = jest.fn().mockReturnValue({ promise: Promise.resolve() });
    const getPage = jest.fn().mockResolvedValue({
      getTextContent: jest.fn().mockResolvedValue({ items: [] }),
      getViewport: jest.fn().mockReturnValue({ width: 200, height: 100 }),
      render,
    });
    (getDocument as jest.Mock).mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage }), destroy: jest.fn().mockResolvedValue(undefined) });
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
    ).resolves.toEqual(expect.objectContaining({ text: 'facture OCR fournisseur acme', status: 'ok', method: 'ocr' }));

    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ data: expect.any(Uint8Array) }));
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({ canvasContext: context, viewport: { width: 200, height: 100 } }),
    );
    expect(recognize).toHaveBeenCalledWith(Buffer.from('png-bytes'));
    expect(terminate).toHaveBeenCalled();
  });

  it('uses native PDF text before OCR and keeps representative page text', async () => {
    const getPage = jest.fn()
      .mockResolvedValueOnce({ getTextContent: jest.fn().mockResolvedValue({ items: [{ str: 'Facture fournisseur Acme page 1' }] }) })
      .mockResolvedValueOnce({ getTextContent: jest.fn().mockResolvedValue({ items: [{ str: 'Montant 42 EUR page 2 reference finale' }] }) });
    (getDocument as jest.Mock).mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage }), destroy: jest.fn().mockResolvedValue(undefined) });
    const adapter = new TesseractOcrAdapter();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from('%PDF-1.4'));
        controller.close();
      },
    });

    await expect(adapter.extractText(stream, { filename: 'facture.pdf', mimeType: 'application/pdf' })).resolves.toEqual(
      expect.objectContaining({
        text: expect.stringContaining('Montant 42 EUR page 2'),
        status: 'ok',
        method: 'pdf-text',
        pageCount: 2,
      }),
    );
    expect(createWorker).not.toHaveBeenCalled();
  });
});
