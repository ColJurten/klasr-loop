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
      | 'rejectClaimedTransaction'
      | 'findPending'
      | 'confirmTransaction'
      | 'rejectTransaction'
      | 'listPending'
    >
  >;
  let folders: jest.Mocked<Pick<FoldersRepository, 'findByExternalId' | 'findByPath' | 'getReferenceRoot' | 'upsertHoldingFolder'>>;
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
      rejectClaimedTransaction: jest.fn().mockResolvedValue(undefined),
      findPending: jest.fn(),
      confirmTransaction: jest.fn().mockResolvedValue(undefined),
      rejectTransaction: jest.fn().mockResolvedValue(undefined),
      listPending: jest.fn(),
    };
    folders = {
      findByExternalId: jest.fn().mockResolvedValue({
        externalId: 'folder_elec',
        path: '/Comptabilité/Électricité',
        inherited: true,
        holding: false,
      }),
      findByPath: jest.fn().mockResolvedValue({
        externalId: 'folder_archives',
        path: '/Archives',
        inherited: true,
        holding: false,
      }),
      getReferenceRoot: jest.fn(),
      upsertHoldingFolder: jest.fn(),
    };
    driveExecutor = {
      moveAndRename: jest.fn().mockResolvedValue(undefined),
      ensureHoldingFolder: jest.fn().mockResolvedValue({
        id: 'holding',
        name: 'À traiter manuellement',
        parents: ['root'],
      }),
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
      holding: false,
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
      holding: false,
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

  it('rejects by moving the original file to the deterministic holding folder, then persists MANUAL state', async () => {
    proposals.claimPending.mockResolvedValue(pendingProposal as never);
    folders.getReferenceRoot.mockResolvedValue({ externalId: 'root', name: 'Cabinet' });
    folders.upsertHoldingFolder.mockResolvedValue({
      externalId: 'holding',
      path: '/À traiter manuellement',
    } as never);

    await expect(service.reject('org_1', 'prop_1')).resolves.toEqual({
      executed: true,
      destinationPath: '/À traiter manuellement',
    });

    expect(driveExecutor.moveAndRename).toHaveBeenCalledWith({
      organizationId: 'org_1',
      documentExternalId: 'gdrive_123',
      newName: 'scan_001.pdf',
      destinationPath: '/À traiter manuellement',
      destinationFolderExternalId: 'holding',
      rename: false,
    });
    expect(proposals.rejectClaimedTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org_1', destinationFolderExternalId: 'holding' }),
    );
  });

  it('restores a reject claim to PENDING when SQL persistence fails after the provider succeeds', async () => {
    proposals.claimPending.mockResolvedValue(pendingProposal as never);
    folders.getReferenceRoot.mockResolvedValue({ externalId: 'root', name: 'Cabinet' });
    folders.upsertHoldingFolder.mockResolvedValue({
      externalId: 'holding',
      path: '/À traiter manuellement',
    } as never);
    proposals.rejectClaimedTransaction.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(service.reject('org_1', 'prop_1')).rejects.toThrow('database unavailable');

    expect(driveExecutor.moveAndRename).toHaveBeenCalledTimes(1);
    expect(proposals.restorePendingClaim).toHaveBeenCalledWith('org_1', 'prop_1', 'REJECTING');
  });

  it('lets exactly one concurrent reject claim execute the Drive provider', async () => {
    let claimed = false;
    proposals.claimPending.mockImplementation(async () => {
      if (claimed) return null;
      claimed = true;
      return pendingProposal as never;
    });
    folders.getReferenceRoot.mockResolvedValue({ externalId: 'root', name: 'Cabinet' });
    folders.upsertHoldingFolder.mockResolvedValue({
      externalId: 'holding',
      path: '/À traiter manuellement',
    } as never);
    const results = await Promise.allSettled([
      service.reject('org_1', 'prop_1'),
      service.reject('org_1', 'prop_1'),
    ]);

    expect(driveExecutor.moveAndRename).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('cannot confirm a proposal from another tenant (repository returns null)', async () => {
    proposals.claimPending.mockResolvedValue(null);
    await expect(service.confirm('org_other', 'prop_1', {})).rejects.toThrow(ConflictException);
    expect(driveExecutor.moveAndRename).not.toHaveBeenCalled();
  });
});
