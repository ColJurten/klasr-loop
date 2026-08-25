jest.mock('./pdf.extractor', () => ({ extractPdf: jest.fn(async () => ({ text: 'pdf', pages: [], pageCount: 1, quality: 'ok', warnings: [], method: 'pdf-text' })) }));
jest.mock('./image.extractor', () => ({ extractImage: jest.fn(async () => ({ text: 'image', pages: [], pageCount: 1, quality: 'ok', warnings: [], method: 'ocr' })) }));
import { extract } from './extract';

describe('extraction MIME dispatcher', () => {
  it.each([['application/pdf', 'pdf-text'], ['image/png', 'ocr'], ['image/jpeg', 'ocr'], ['image/tiff', 'ocr']])('dispatches %s', async (mimeType, method) => {
    await expect(extract({ content: Buffer.from('synthetic'), mimeType, originalName: 'x' })).resolves.toMatchObject({ method });
  });
});
