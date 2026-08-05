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

  function makeService(statuses = ['PENDING', 'PROPOSED', 'MANUAL']) {
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
        { externalId: 'child', path: '/Compta', holding: false },
        { externalId: 'grandchild', path: '/Compta/Électricité', holding: false },
      ]),
      replaceReferenceRoot: jest.fn().mockResolvedValue([
        { externalId: 'child', path: '/Compta' },
        { externalId: 'grandchild', path: '/Compta/Électricité' },
      ]),
    };
    const service = new SyncService(
      drive as never,
      repository as never,
      jobs as never,
      metrics as never,
      folders as never,
    );
    return { service, drive, repository, jobs, metrics, folders };
  }

  it('persists the selected reference root and imports descendants regardless of metadata order', async () => {
    const { service, folders } = makeService();

    await expect(service.selectReferenceRoot('org_1', 'root')).resolves.toEqual({
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

  it('keeps the known reference root and holding folder excluded from browser choices', async () => {
    const { service, drive, folders } = makeService();
    folders.listInherited.mockResolvedValue([
      { externalId: 'holding', path: '/À traiter manuellement', holding: true },
    ]);
    drive.listChildren = jest.fn().mockResolvedValue({
      items: [
        metadata[0],
        { id: 'holding', name: 'À traiter manuellement', mimeType: FOLDER, sizeBytes: 0, parents: ['root'] },
      ],
      nextPageToken: null,
    });

    const result = await service.listDriveItems('org_1', 'root');

    expect(result.items).toEqual([
      expect.objectContaining({ externalId: 'root', eligible: false, reason: 'reference-root' }),
      expect.objectContaining({ externalId: 'holding', eligible: false, reason: 'inside-holding-tree' }),
    ]);
  });

  it('recursively launches one selected folder and skips inherited destination files', async () => {
    const { service, repository, jobs } = makeService();

    await expect(service.launchDriveItem('org_1', 'input')).resolves.toEqual({ enqueued: 1, manual: 1 });

    expect(repository.upsertDocumentMetadata).toHaveBeenCalledTimes(3);
    expect(repository.upsertDocumentMetadata).not.toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ externalId: 'organized' }),
    );
    expect(jobs.enqueueAnalysis).toHaveBeenCalledTimes(1);
    expect(jobs.enqueueAnalysis).toHaveBeenCalledWith({ organizationId: 'org_1', documentId: 'doc_1' });
  });

  it('acknowledges enqueue without waiting for inline analysis', async () => {
    const { service, jobs } = makeService();
    process.env.KLASR_LOCAL_MVP = 'true';
    process.env.KLASR_INLINE_WORKER = 'true';

    try {
      await expect(service.launchDriveItem('org_1', 'input')).resolves.toEqual({ enqueued: 1, manual: 1 });
      expect(jobs.waitForAnalysisIdle).not.toHaveBeenCalled();
    } finally {
      delete process.env.KLASR_LOCAL_MVP;
      delete process.env.KLASR_INLINE_WORKER;
    }
  });

  it('does not re-enqueue already PROPOSED, CLASSIFIED, or MANUAL documents', async () => {
    const { service, jobs } = makeService(['PROPOSED', 'CLASSIFIED', 'MANUAL']);

    await expect(service.launchDriveItem('org_1', 'input')).resolves.toEqual({ enqueued: 0, manual: 1 });

    expect(jobs.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it('allows a supported file beneath the inherited reference tree', async () => {
    const { service, jobs } = makeService(['PENDING']);

    await expect(service.launchDriveItem('org_1', 'organized')).resolves.toEqual({ enqueued: 1, manual: 0 });
    expect(jobs.enqueueAnalysis).toHaveBeenCalledTimes(1);
  });

  it('rejects only the reference root and the holding subtree', async () => {
    const { service, folders } = makeService();
    folders.listInherited.mockResolvedValue([
      { externalId: 'child', path: '/Compta', holding: false },
      { externalId: 'grandchild', path: '/Compta/Électricité', holding: false },
      { externalId: 'holding', path: '/À traiter manuellement', holding: true },
    ]);
    driveMetadata(service, [
      ...metadata,
      { id: 'holding', name: 'À traiter manuellement', mimeType: FOLDER, sizeBytes: 0, parents: ['root'] },
      { id: 'held', name: 'rejet.pdf', mimeType: 'application/pdf', sizeBytes: 10, parents: ['holding'] },
    ]);

    await expect(service.launchDriveItem('org_1', 'root')).rejects.toThrow(BadRequestException);
    await expect(service.launchDriveItem('org_1', 'holding')).rejects.toThrow(BadRequestException);
    await expect(service.launchDriveItem('org_1', 'held')).rejects.toThrow(BadRequestException);
  });

  it('recurses beneath a normal inherited folder but excludes a nested holding branch', async () => {
    const { service, folders, repository, jobs } = makeService(['PENDING']);
    folders.listInherited.mockResolvedValue([
      { externalId: 'child', path: '/Compta', holding: false },
      { externalId: 'holding', path: '/Compta/À traiter manuellement', holding: true },
    ]);
    driveMetadata(service, [
      { id: 'root', name: 'Cabinet', mimeType: FOLDER, sizeBytes: 0, parents: [] },
      { id: 'child', name: 'Compta', mimeType: FOLDER, sizeBytes: 0, parents: ['root'] },
      { id: 'normal', name: 'nouveau.pdf', mimeType: 'application/pdf', sizeBytes: 10, parents: ['child'] },
      { id: 'holding', name: 'À traiter manuellement', mimeType: FOLDER, sizeBytes: 0, parents: ['child'] },
      { id: 'held', name: 'rejet.pdf', mimeType: 'application/pdf', sizeBytes: 10, parents: ['holding'] },
    ]);

    await expect(service.launchDriveItem('org_1', 'child')).resolves.toEqual({ enqueued: 1, manual: 0 });
    expect(repository.upsertDocumentMetadata).toHaveBeenCalledTimes(1);
    expect(repository.upsertDocumentMetadata).toHaveBeenCalledWith('org_1', expect.objectContaining({ externalId: 'normal' }));
    expect(jobs.enqueueAnalysis).toHaveBeenCalledTimes(1);
  });
});

function driveMetadata(service: SyncService, items: unknown[]): void {
  ((service as unknown as { drive: { listMetadata: jest.Mock } }).drive.listMetadata).mockResolvedValue(items);
}
