import { GoogleDriveExecutor } from './google-drive.executor';

describe('GoogleDriveExecutor', () => {
  const tokenService = {
    getAccessToken: jest.fn().mockResolvedValue('access-token'),
  };
  const folders = {
    findByPath: jest.fn().mockResolvedValue({ externalId: 'folder_dest' }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as never;
  });

  it('lists Drive metadata only with a refreshed server-side access token', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: [
          { id: 'root', name: 'Compta', mimeType: 'application/vnd.google-apps.folder', parents: [] },
          { id: 'doc_1', name: 'facture.pdf', mimeType: 'application/pdf', size: '12', parents: ['root'] },
        ],
      }),
    });
    const executor = new GoogleDriveExecutor(tokenService as never, folders as never);

    await expect(executor.listMetadata('org_1')).resolves.toHaveLength(2);

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('drive/v3/files'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
      }),
    );
  });

  it('downloads content as a Response body stream and does not materialize bytes', async () => {
    const stream = new ReadableStream();
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, body: stream });
    const executor = new GoogleDriveExecutor(tokenService as never, folders as never);

    await expect(executor.download('org_1', 'doc_1')).resolves.toBe(stream);
  });

  it('fails when the destination path is missing for the tenant', async () => {
    folders.findByPath.mockResolvedValueOnce(null);
    const executor = new GoogleDriveExecutor(tokenService as never, folders as never);

    await expect(
      executor.moveAndRename({
        organizationId: 'org_1',
        documentExternalId: 'doc_1',
        newName: 'renamed.pdf',
        destinationPath: '/Missing',
      }),
    ).rejects.toThrow('Destination folder not found');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('moves by adding the destination and removing the old parents', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ parents: ['old_a', 'old_b'] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const executor = new GoogleDriveExecutor(tokenService as never, folders as never);

    await executor.moveAndRename({
      organizationId: 'org_1',
      documentExternalId: 'doc_1',
      newName: 'renamed.pdf',
      destinationPath: '/Compta',
    });

    expect(global.fetch).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /\/drive\/v3\/files\/doc_1\?.*addParents=folder_dest.*removeParents=old_a%2Cold_b/,
      ),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'renamed.pdf' }),
      }),
    );
  });
});
