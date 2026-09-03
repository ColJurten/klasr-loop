import { BadRequestException } from '@nestjs/common';
import { SyncService } from './sync.service';

const FOLDER = 'application/vnd.google-apps.folder';

describe('SyncService — Drive reference and selected launch', () => {
  const metadata = [
    { id: 'root', name: 'Cabinet', mimeType: FOLDER, sizeBytes: 0, parents: [] },
    { id: 'input', name: 'À classer', mimeType: FOLDER, sizeBytes: 0, parents: [] },
    { id: 'child', name: 'Compta', mimeType: FOLDER, sizeBytes: 0, parents: ['root'] },
    { id: 'grandchild', name: 'Électricité', mimeType: FOLDER, sizeBytes: 0, parents: ['child'] },
    { id: 'nested', name: 'Lot', mimeType: FOLDER, sizeBytes: 0, parents: ['input'] },
    { id: 'file_1', name: 'facture.pdf', mimeType: 'application/pdf', sizeBytes: 100, parents: ['input'] },
    { id: 'file_2', name: 'paie.png', mimeType: 'image/png', sizeBytes: 200, parents: ['nested'] },
    { id: 'file_3', name: 'archive.zip', mimeType: 'application/zip', sizeBytes: 300, parents: ['input'] },
    { id: 'organized', name: 'deja.pdf', mimeType: 'application/pdf', sizeBytes: 100, parents: ['grandchild'] },
  ];

  function makeService(statuses = ['PENDING', 'PROPOSED', 'PENDING']) {
    const drive: { listMetadata: jest.Mock; listChildren?: jest.Mock } = { listMetadata: jest.fn().mockResolvedValue(metadata) };
    const repository = {
      upsertDocumentMetadata: jest.fn()
        .mockResolvedValueOnce({ id: 'doc_1', status: statuses[0], created: true, supported: true })
        .mockResolvedValueOnce({ id: 'doc_2', status: statuses[1], created: true, supported: true })
        .mockResolvedValueOnce({ id: 'doc_3', status: statuses[2], created: true, supported: false }),
      markManual: jest.fn().mockResolvedValue(undefined),
    };
    const jobs = { enqueueAnalysis: jest.fn().mockResolvedValue(undefined), waitForAnalysisIdle: jest.fn() };
    const metrics = { increment: jest.fn().mockResolvedValue(undefined) };
    const folders = {
      getReferenceRoot: jest.fn().mockResolvedValue({ externalId: 'root', name: 'Cabinet' }),
      listInherited: jest.fn().mockResolvedValue([
        { externalId: 'child', path: '/Compta' },
        { externalId: 'grandchild', path: '/Compta/Électricité' },
      ]),
      replaceReferenceRoot: jest.fn().mockResolvedValue([
        { externalId: 'child', path: '/Compta' },
        { externalId: 'grandchild', path: '/Compta/Électricité' },
      ]),
    };
    const connections = { touchSync: jest.fn().mockResolvedValue(undefined) };
    const service = new SyncService(
      drive as never,
      repository as never,
      jobs as never,
      metrics as never,
      folders as never,
      connections as never,
    );
    return { service, drive, repository, jobs, metrics, folders, connections };
  }

  it('persists the selected reference root and imports descendants regardless of metadata order', async () => {
    const { service, folders, connections } = makeService();

    await expect(service.selectReferenceRoot('org_1', 'user_1', 'root')).resolves.toEqual({
      referenceRoot: { externalId: 'root', name: 'Cabinet' },
      folders: expect.any(Array),
    });

    expect(folders.replaceReferenceRoot).toHaveBeenCalledWith(
      'org_1',
      { externalId: 'root', name: 'Cabinet' },
      expect.arrayContaining([
        expect.objectContaining({ id: 'grandchild', parents: ['child'] }),
        expect.objectContaining({ id: 'child', parents: ['root'] }),
      ]),
    );
    expect(connections.touchSync).toHaveBeenCalledWith('org_1', 'user_1');
  });

  it('makes only folders eligible while a fresh organization chooses its first reference root', async () => {
    const { service, drive, folders } = makeService();
    folders.getReferenceRoot.mockResolvedValue(null);
    drive.listChildren = jest.fn().mockResolvedValue({
      items: [metadata[0], metadata[5]],
      nextPageToken: null,
    });

    await expect(service.listDriveItems('org_fresh', 'root')).resolves.toEqual({
      items: [
        expect.objectContaining({ externalId: 'root', type: 'folder', eligible: true }),
        expect.objectContaining({ externalId: 'file_1', type: 'file', eligible: false, reason: 'reference-required' }),
      ],
      nextPageToken: null,
    });
  });

  it('keeps the known reference root excluded from browser choices', async () => {
    const { service, drive } = makeService();
    drive.listChildren = jest.fn().mockResolvedValue({
      items: [metadata[0]],
      nextPageToken: null,
    });

    const result = await service.listDriveItems('org_1', 'root');

    expect(result.items).toEqual([expect.objectContaining({ externalId: 'root', eligible: false, reason: 'reference-root' })]);
  });

  it('recursively launches one selected folder and skips inherited destination files', async () => {
    const { service, repository, jobs } = makeService();

    await expect(service.launchDriveItem('org_1', 'input')).resolves.toEqual({ enqueued: 2, manual: 0 });

    expect(repository.upsertDocumentMetadata).toHaveBeenCalledTimes(3);
    expect(repository.upsertDocumentMetadata).not.toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ externalId: 'organized' }),
    );
    expect(jobs.enqueueAnalysis).toHaveBeenCalledTimes(2);
    expect(jobs.enqueueAnalysis).toHaveBeenCalledWith({ organizationId: 'org_1', documentId: 'doc_1' });
  });

  it('acknowledges enqueue without waiting for inline analysis', async () => {
    const { service, jobs } = makeService();
    process.env.KLASR_LOCAL_MVP = 'true';
    process.env.KLASR_INLINE_WORKER = 'true';

    try {
      await expect(service.launchDriveItem('org_1', 'input')).resolves.toEqual({ enqueued: 2, manual: 0 });
      expect(jobs.waitForAnalysisIdle).not.toHaveBeenCalled();
    } finally {
      delete process.env.KLASR_LOCAL_MVP;
      delete process.env.KLASR_INLINE_WORKER;
    }
  });

  it('keeps Google-native and oversized files reviewable without enqueueing a doomed download', async () => {
    const { service, repository, jobs } = makeService(['PENDING', 'PENDING']);
    driveMetadata(service, [
      { id: 'native', name: 'tableur', mimeType: 'application/vnd.google-apps.spreadsheet', sizeBytes: 0, parents: [] },
      { id: 'large', name: 'large.pdf', mimeType: 'application/pdf', sizeBytes: 21 * 1024 * 1024, parents: [] },
    ]);
    await expect(service.launchDriveItem('org_1', 'native')).resolves.toEqual({ enqueued: 0, manual: 1 });
    await expect(service.launchDriveItem('org_1', 'large')).resolves.toEqual({ enqueued: 0, manual: 1 });
    expect(repository.upsertDocumentMetadata).toHaveBeenCalledTimes(2);
    expect(repository.upsertDocumentMetadata).toHaveBeenCalledWith('org_1', expect.objectContaining({ supported: false }));
    expect(repository.markManual).toHaveBeenCalledTimes(2); expect(jobs.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it('does not re-enqueue already PROPOSED, CLASSIFIED, or IGNORED documents', async () => {
    const { service, jobs } = makeService(['PROPOSED', 'CLASSIFIED', 'IGNORED']);

    await expect(service.launchDriveItem('org_1', 'input')).resolves.toEqual({ enqueued: 0, manual: 0 });

    expect(jobs.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it('allows a supported file beneath the inherited reference tree', async () => {
    const { service, jobs } = makeService(['PENDING']);

    await expect(service.launchDriveItem('org_1', 'organized')).resolves.toEqual({ enqueued: 1, manual: 0 });
    expect(jobs.enqueueAnalysis).toHaveBeenCalledTimes(1);
  });

  it('rejects the reference root as an input', async () => {
    const { service } = makeService();
    await expect(service.launchDriveItem('org_1', 'root')).rejects.toThrow(BadRequestException);
  });
});

function driveMetadata(service: SyncService, items: unknown[]): void {
  ((service as unknown as { drive: { listMetadata: jest.Mock } }).drive.listMetadata).mockResolvedValue(items);
}
