import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmProposal } from '@/lib/client-api';

afterEach(() => vi.unstubAllGlobals());

describe('confirmProposal client payload', () => {
  it('retains an edited filename and no-catalogue destination path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ executed: true, destinationPath: '/Archives/2026' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await confirmProposal('prop_1', {
      finalName: 'Facture_Corrigee.pdf',
      overrideDestinationPath: '/Archives/2026',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/proposals/prop_1/confirm', expect.objectContaining({
      body: JSON.stringify({ finalName: 'Facture_Corrigee.pdf', overrideDestinationPath: '/Archives/2026' }),
    }));
  });
});
