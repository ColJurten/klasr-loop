import { SyncService } from './sync.service';

describe('SyncService', () => {
  it('upserts metadata and enqueues analysis idempotently for supported new documents', async () => {
    const drive = {
      listMetadata: jest.fn().mockResolvedValue([
        { id: 'folder_1', name: 'Compta', mimeType: 'application/vnd.google-apps.folder', parents: [] },
        { id: 'file_1', name: 'facture.pdf', mimeType: 'application/pdf', sizeBytes: 100, parents: ['folder_1'] },
        { id: 'file_2', name: 'archive.zip', mimeType: 'application/zip', sizeBytes: 200, parents: ['folder_1'] },
      ]),
    };
    const repository = {
      upsertFolderTree: jest.fn().mockResolvedValue(undefined),
      upsertDocumentMetadata: jest
        .fn()
        .mockResolvedValueOnce({ id: 'doc_1', status: 'PENDING', created: true, supported: true })
        .mockResolvedValueOnce({ id: 'doc_2', status: 'MANUAL', created: true, supported: false }),
      markManual: jest.fn().mockResolvedValue(undefined),
      touchConnectionSync: jest.fn().mockResolvedValue(undefined),
    };
    const jobs = { enqueueAnalysis: jest.fn().mockResolvedValue(undefined) };
    const metrics = { increment: jest.fn().mockResolvedValue(undefined) };
    const service = new SyncService(drive as never, repository as never, jobs as never, metrics as never);

    await service.syncOrganization('org_1');

    expect(repository.upsertFolderTree).toHaveBeenCalledWith('org_1', expect.any(Array));
    expect(jobs.enqueueAnalysis).toHaveBeenCalledTimes(1);
    expect(jobs.enqueueAnalysis).toHaveBeenCalledWith({ organizationId: 'org_1', documentId: 'doc_1' });
    expect(repository.markManual).toHaveBeenCalledWith('org_1', 'doc_2');
  });
});
