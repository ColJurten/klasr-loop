import { AnthropicProvider } from './anthropic.provider';

describe('AnthropicProvider structured output validation', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects invented folders, unsafe filenames, and out-of-range confidence', async () => {
    const provider = new AnthropicProvider('test-key');
    const cases = [
      { proposedName: 'Facture.pdf', destinationPath: '/Invented', confidence: 0.8 },
      { proposedName: '../secret.pdf', destinationPath: '/A', confidence: 0.8 },
      { proposedName: 'Facture.pdf', destinationPath: '/A', confidence: 2 },
      { proposedName: 'Facture.txt', destinationPath: '/A', confidence: 0.8 },
    ];

    for (const payload of cases) {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] }),
      }) as never;

      await expect(provider.classify({ documentText: 'facture acme', filename: 'scan.pdf', folderPaths: ['/A'] })).resolves.toBeNull();
    }
  });

  it('accepts bounded output for an existing destination and preserved extension', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({
          proposedName: 'Facture_Acme.pdf',
          destinationPath: '/Comptabilité/Factures',
          confidence: 0.82,
          filenameConfidence: 0.78,
          destinationConfidence: 0.86,
        }) }],
      }),
    }) as never;

    await expect(new AnthropicProvider('test-key').classify({
      documentText: 'facture acme',
      filename: 'scan.pdf',
      folderPaths: ['/Comptabilité/Factures'],
    })).resolves.toEqual(expect.objectContaining({
      proposedName: 'Facture_Acme.pdf',
      destinationPath: '/Comptabilité/Factures',
      confidence: 0.82,
    }));
  });
});
