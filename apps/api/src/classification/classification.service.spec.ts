import { ConflictException } from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { ProposalsRepository } from './proposals.repository';
import { DriveExecutor } from './drive-executor.port';
import { FoldersRepository } from '../drive/folders.repository';

describe('ClassificationService.confirm (single-click flow)', () => {
  let proposals: jest.Mocked<
    Pick<
      ProposalsRepository,
      | 'claimPending'
      | 'restorePendingClaim'
      | 'confirmClaimedTransaction'
      | 'ignoreClaimedTransaction'
      | 'findPending'
      | 'confirmTransaction'
      | 'listPending'
    >
  >;
  let folders: jest.Mocked<Pick<FoldersRepository, 'findByExternalId' | 'findByPath'>>;
  let driveExecutor: jest.Mocked<DriveExecutor>;
  let service: ClassificationService;

  const pendingProposal = {
    id: 'prop_1',
    documentId: 'doc_1',
    proposedName: 'Facture_EDF_2026-03.pdf',
    destinationPath: '/Comptabilité/Électricité',
    destinationFolderExternalId: 'folder_elec',
    document: { externalId: 'gdrive_123', name: 'scan_001.pdf' },
  };

  beforeEach(() => {
    proposals = {
      claimPending: jest.fn(),
      restorePendingClaim: jest.fn().mockResolvedValue(undefined),
      confirmClaimedTransaction: jest.fn().mockResolvedValue(undefined),
      ignoreClaimedTransaction: jest.fn().mockResolvedValue(undefined),
      findPending: jest.fn(),
      confirmTransaction: jest.fn().mockResolvedValue(undefined),
      listPending: jest.fn(),
    };
    folders = {
      findByExternalId: jest.fn().mockResolvedValue({
        externalId: 'folder_elec',
        path: '/Comptabilité/Électricité',
        inherited: true,
      }),
      findByPath: jest.fn().mockResolvedValue({
        externalId: 'folder_archives',
        path: '/Archives',
        inherited: true,
      }),
    };
    driveExecutor = {
      moveAndRename: jest.fn().mockResolvedValue(undefined),
    } as never;
    service = new ClassificationService(
      proposals as unknown as ProposalsRepository,
      folders as unknown as FoldersRepository,
      driveExecutor,
    );
  });

  it('executes the Drive move THEN records the audit trail', async () => {
    proposals.claimPending.mockResolvedValue(pendingProposal as never);
    const result = await service.confirm('org_1', 'prop_1', {});

    expect(driveExecutor.moveAndRename).toHaveBeenCalledWith({
      organizationId: 'org_1',
      documentExternalId: 'gdrive_123',
      newName: 'Facture_EDF_2026-03.pdf',
      destinationPath: '/Comptabilité/Électricité',
      destinationFolderExternalId: 'folder_elec',
    });
    expect(proposals.confirmClaimedTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CONFIRMED', organizationId: 'org_1' }),
    );
    expect(result).toEqual({ executed: true, destinationPath: '/Comptabilité/Électricité' });
  });

  it('records nothing when the Drive execution fails', async () => {
    proposals.claimPending.mockResolvedValue(pendingProposal as never);
    driveExecutor.moveAndRename.mockRejectedValue(new Error('drive down'));
    await expect(service.confirm('org_1', 'prop_1', {})).rejects.toThrow('drive down');
    expect(proposals.confirmClaimedTransaction).not.toHaveBeenCalled();
    expect(proposals.restorePendingClaim).toHaveBeenCalledWith('org_1', 'prop_1', 'CONFIRMING');
  });

  it('restores a confirm claim to PENDING when SQL persistence fails after the provider succeeds', async () => {
    proposals.claimPending.mockResolvedValue(pendingProposal as never);
    proposals.confirmClaimedTransaction.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.confirm('org_1', 'prop_1', {})).rejects.toThrow('database unavailable');

    expect(driveExecutor.moveAndRename).toHaveBeenCalledTimes(1);
    expect(proposals.restorePendingClaim).toHaveBeenCalledWith('org_1', 'prop_1', 'CONFIRMING');
  });

  it('marks the proposal OVERRIDDEN when the user picks another destination', async () => {
    proposals.claimPending.mockResolvedValue(pendingProposal as never);
    folders.findByExternalId.mockResolvedValueOnce({
      externalId: 'folder_archives',
      path: '/Archives',
      inherited: true,
    } as never);
    await service.confirm('org_1', 'prop_1', { destinationFolderExternalId: 'folder_archives' });
    expect(proposals.confirmClaimedTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OVERRIDDEN', destinationPath: '/Archives' }),
    );
  });

  it('allows explicit as-is validation for a low-confidence proposal', async () => {
    proposals.claimPending.mockResolvedValue({ ...pendingProposal, reviewRequired: true } as never);

    await service.confirm('org_1', 'prop_1', {});

    expect(driveExecutor.moveAndRename).toHaveBeenCalledWith(expect.objectContaining({
      newName: 'Facture_EDF_2026-03.pdf',
      destinationFolderExternalId: 'folder_elec',
    }));
    expect(proposals.confirmClaimedTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CONFIRMED' }),
    );
  });

  it('rejects invalid filenames before executing Drive changes', async () => {
    proposals.claimPending.mockResolvedValue(pendingProposal as never);
    await expect(service.confirm('org_1', 'prop_1', { finalName: '../secret.pdf' })).rejects.toThrow('Invalid filename');
    expect(driveExecutor.moveAndRename).not.toHaveBeenCalled();
    expect(proposals.restorePendingClaim).toHaveBeenCalledWith('org_1', 'prop_1', 'CONFIRMING');
  });

  it('rejects a destination outside the inherited tree before executing Drive changes', async () => {
    proposals.claimPending.mockResolvedValue(pendingProposal as never);
    folders.findByExternalId.mockResolvedValueOnce({
      externalId: 'folder_foreign',
      path: '/Autre tenant',
      inherited: false,
    } as never);
    await expect(service.confirm('org_1', 'prop_1', { destinationFolderExternalId: 'folder_foreign' })).rejects.toThrow(
      'Destination folder must belong to the inherited reference tree',
    );
    expect(driveExecutor.moveAndRename).not.toHaveBeenCalled();
    expect(proposals.restorePendingClaim).toHaveBeenCalledWith('org_1', 'prop_1', 'CONFIRMING');
  });

  it('lets exactly one concurrent confirm claim execute the Drive provider', async () => {
    let claimed = false;
    proposals.claimPending.mockImplementation(async () => {
      if (claimed) return null;
      claimed = true;
      return pendingProposal as never;
    });
    let releaseProvider!: () => void;
    driveExecutor.moveAndRename.mockImplementation(
      () => new Promise<void>((resolve) => {
        releaseProvider = resolve;
      }),
    );

    const winner = service.confirm('org_1', 'prop_1', {});
    const loser = service.confirm('org_1', 'prop_1', {});
    await expect(loser).rejects.toThrow(ConflictException);
    releaseProvider();
    await expect(winner).resolves.toEqual({ executed: true, destinationPath: '/Comptabilité/Électricité' });

    expect(driveExecutor.moveAndRename).toHaveBeenCalledTimes(1);
  });

  it('keeps the confirm claim retryable after one concurrent winner hits a post-provider SQL failure', async () => {
    let claimed = false;
    proposals.claimPending.mockImplementation(async () => {
      if (claimed) return null;
      claimed = true;
      return pendingProposal as never;
    });
    proposals.confirmClaimedTransaction.mockRejectedValueOnce(new Error('database unavailable'));

    const results = await Promise.allSettled([
      service.confirm('org_1', 'prop_1', {}),
      service.confirm('org_1', 'prop_1', {}),
    ]);

    expect(driveExecutor.moveAndRename).toHaveBeenCalledTimes(1);
    expect(proposals.restorePendingClaim).toHaveBeenCalledWith('org_1', 'prop_1', 'CONFIRMING');
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(2);
  });

  it('ignores without invoking any storage-provider method or recording a destination', async () => {
    proposals.claimPending.mockResolvedValue(pendingProposal as never);

    await expect(service.ignore('org_1', 'prop_1')).resolves.toEqual({
      ignored: true,
    });

    for (const providerMethod of Object.values(driveExecutor)) expect(providerMethod).not.toHaveBeenCalled();
    expect(proposals.ignoreClaimedTransaction).toHaveBeenCalledWith(
      expect.not.objectContaining({ destinationPath: expect.anything(), destinationFolderExternalId: expect.anything() }),
    );
  });

  it('restores an ignore claim to PENDING when SQL persistence fails', async () => {
    proposals.claimPending.mockResolvedValue(pendingProposal as never);
    proposals.ignoreClaimedTransaction.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.ignore('org_1', 'prop_1')).rejects.toThrow('database unavailable');

    expect(driveExecutor.moveAndRename).not.toHaveBeenCalled();
    expect(proposals.restorePendingClaim).toHaveBeenCalledWith('org_1', 'prop_1', 'IGNORING');
  });

  it('lets exactly one concurrent ignore claim persist', async () => {
    let claimed = false;
    proposals.claimPending.mockImplementation(async () => {
      if (claimed) return null;
      claimed = true;
      return pendingProposal as never;
    });
    const results = await Promise.allSettled([
      service.ignore('org_1', 'prop_1'),
      service.ignore('org_1', 'prop_1'),
    ]);

    expect(driveExecutor.moveAndRename).not.toHaveBeenCalled();
    expect(proposals.ignoreClaimedTransaction).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('cannot confirm a proposal from another tenant (repository returns null)', async () => {
    proposals.claimPending.mockResolvedValue(null);
    await expect(service.confirm('org_other', 'prop_1', {})).rejects.toThrow(ConflictException);
    expect(driveExecutor.moveAndRename).not.toHaveBeenCalled();
  });
});
