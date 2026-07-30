import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  ApiUpstreamError: class ApiUpstreamError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
  confirmProposal: vi.fn(),
  launchDriveItem: vi.fn(),
  listReferenceFolders: vi.fn(),
  rejectProposal: vi.fn(),
  selectReferenceRoot: vi.fn(),
  startSync: vi.fn(),
  getDashboardData: vi.fn(),
}));

vi.mock('@/lib/api', () => api);

describe('dashboard BFF routes preserve upstream status codes', () => {
  it('returns upstream 409 from proposal confirm instead of collapsing to 502', async () => {
    api.confirmProposal.mockRejectedValueOnce(Object.assign(new Error('already decided'), { status: 409 }));
    const { POST } = await import('@/app/api/proposals/[proposalId]/confirm/route');

    const response = await POST(new Request('http://localhost/api/proposals/prop_1/confirm', { method: 'POST' }), {
      params: { proposalId: 'prop_1' },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'already decided' });
  });

  it('returns upstream 400 from Drive launch instead of collapsing to 502', async () => {
    api.launchDriveItem.mockRejectedValueOnce(Object.assign(new Error('invalid input'), { status: 400 }));
    const { POST } = await import('@/app/api/drive/launch/route');

    const response = await POST(new Request('http://localhost/api/drive/launch', {
      method: 'POST',
      body: JSON.stringify({ itemExternalId: 'bad' }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid input' });
  });

  it('maps true upstream 5xx errors to 502', async () => {
    api.rejectProposal.mockRejectedValueOnce(Object.assign(new Error('provider unavailable'), { status: 500 }));
    const { POST } = await import('@/app/api/proposals/[proposalId]/reject/route');

    const response = await POST(new Request('http://localhost/api/proposals/prop_1/reject', { method: 'POST' }), {
      params: { proposalId: 'prop_1' },
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: 'provider unavailable' });
  });

  it('returns upstream 401 from sync instead of collapsing to 502', async () => {
    api.startSync.mockRejectedValueOnce(Object.assign(new Error('Missing authenticated organization'), { status: 401 }));
    const { POST } = await import('@/app/api/sync/route');

    const response = await POST();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Missing authenticated organization' });
  });

  it('exposes guarded reference folder listing through the browser BFF', async () => {
    api.listReferenceFolders.mockResolvedValueOnce([
      { externalId: 'folder_1', name: 'Cabinet', parentExternalId: null },
    ]);
    const { GET } = await import('@/app/api/drive/reference-folders/route');

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { externalId: 'folder_1', name: 'Cabinet', parentExternalId: null },
    ]);
  });
});
