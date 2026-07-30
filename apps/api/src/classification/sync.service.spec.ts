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
    const drive = { listMetadata: jest.fn().mockResolvedValue(metadata) };
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

  it('does not re-enqueue already PROPOSED, CLASSIFIED, or MANUAL documents', async () => {
    const { service, jobs } = makeService(['PROPOSED', 'CLASSIFIED', 'MANUAL']);

    await expect(service.launchDriveItem('org_1', 'input')).resolves.toEqual({ enqueued: 0, manual: 1 });

    expect(jobs.enqueueAnalysis).not.toHaveBeenCalled();
  });

  it('rejects the inherited reference subtree as input', async () => {
    const { service } = makeService();

    await expect(service.launchDriveItem('org_1', 'child')).rejects.toThrow(BadRequestException);
  });
});
