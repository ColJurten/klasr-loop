import { GoogleDriveExecutor } from './google-drive.executor';

describe('GoogleDriveExecutor', () => {
  const tokenService = {
    getAccessToken: jest.fn().mockResolvedValue('access-token'),
  };
  const folders = {
    findByPath: jest.fn().mockResolvedValue({ externalId: 'folder_dest' }),
    findByExternalId: jest.fn().mockResolvedValue({ externalId: 'folder_dest' }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT;
    delete process.env.KLASR_GOOGLE_DRIVE_ROOT_ID;
    global.fetch = jest.fn() as never;
  });

  it('maps the virtual root to the configured shared acceptance root only in service-account mode', async () => {
    process.env.KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT = 'true';
    process.env.KLASR_GOOGLE_DRIVE_ROOT_ID = 'shared_root';
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ files: [] }) });
    const executor = new GoogleDriveExecutor(tokenService as never, folders as never);

    await executor.listChildren('org_1', 'root');

    expect(new URL((global.fetch as jest.Mock).mock.calls[0][0]).searchParams.get('q')).toBe(
      "'shared_root' in parents and trashed=false",
    );
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

  it('lists every Drive metadata page, excludes trashed items, and includes shared drives', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          nextPageToken: 'page_2',
          files: [
            { id: 'root', name: 'Compta', mimeType: 'application/vnd.google-apps.folder', parents: [] },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          files: [
            { id: 'shared', name: 'Shared folder', mimeType: 'application/vnd.google-apps.folder', parents: ['root'] },
          ],
        }),
      });
    const executor = new GoogleDriveExecutor(tokenService as never, folders as never);

    await expect(executor.listMetadata('org_1')).resolves.toEqual([
      expect.objectContaining({ id: 'root' }),
      expect.objectContaining({ id: 'shared' }),
    ]);

    const firstUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(firstUrl.searchParams.get('q')).toBe('trashed=false');
    expect(firstUrl.searchParams.get('supportsAllDrives')).toBe('true');
    expect(firstUrl.searchParams.get('includeItemsFromAllDrives')).toBe('true');
    expect(firstUrl.searchParams.get('fields')).toContain('nextPageToken');
    const secondUrl = new URL((global.fetch as jest.Mock).mock.calls[1][0]);
    expect(secondUrl.searchParams.get('pageToken')).toBe('page_2');
  });

  it('lists one parent page with a bounded page token and safe metadata', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        nextPageToken: 'next_2',
        files: [{ id: 'doc_1', name: 'facture.pdf', mimeType: 'application/pdf', size: '12', parents: ['parent'] }],
      }),
    });
    const executor = new GoogleDriveExecutor(tokenService as never, folders as never);

    await expect(executor.listChildren('org_1', 'parent', 'page_1')).resolves.toEqual({
      items: [expect.objectContaining({ id: 'doc_1', name: 'facture.pdf', sizeBytes: 12 })],
      nextPageToken: 'next_2',
    });
    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get('q')).toBe("'parent' in parents and trashed=false");
    expect(url.searchParams.get('pageToken')).toBe('page_1');
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true');
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
      destinationFolderExternalId: 'folder_dest',
    });

    const metadataUrl = new URL((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(metadataUrl.toString()).toBe(
      'https://www.googleapis.com/drive/v3/files/doc_1?fields=parents&supportsAllDrives=true',
    );
    const moveUrl = new URL((global.fetch as jest.Mock).mock.calls[1][0]);
    expect(moveUrl.toString()).toBe(
      'https://www.googleapis.com/drive/v3/files/doc_1?addParents=folder_dest&fields=id%2Cname%2Cparents&supportsAllDrives=true&removeParents=old_a%2Cold_b',
    );
    expect(moveUrl.searchParams.get('addParents')).toBe('folder_dest');
    expect(moveUrl.searchParams.get('removeParents')).toBe('old_a,old_b');
    expect(moveUrl.searchParams.get('supportsAllDrives')).toBe('true');
    expect(moveUrl.searchParams.get('fields')).toBe('id,name,parents');
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
