import { NotFoundException } from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { ProposalsRepository } from './proposals.repository';
import { DriveExecutor } from './drive-executor.port';

describe('ClassificationService.confirm (single-click flow)', () => {
  let proposals: jest.Mocked<Pick<ProposalsRepository, 'findPending' | 'confirmTransaction' | 'listPending'>>;
  let driveExecutor: jest.Mocked<DriveExecutor>;
  let service: ClassificationService;

  const pendingProposal = {
    id: 'prop_1',
    documentId: 'doc_1',
    proposedName: 'Facture_EDF_2026-03.pdf',
    destinationPath: '/Comptabilité/Électricité',
    document: { externalId: 'gdrive_123', name: 'scan_001.pdf' },
  };

  beforeEach(() => {
    proposals = {
      findPending: jest.fn(),
      confirmTransaction: jest.fn().mockResolvedValue(undefined),
      listPending: jest.fn(),
    };
    driveExecutor = { moveAndRename: jest.fn().mockResolvedValue(undefined) };
    service = new ClassificationService(
      proposals as unknown as ProposalsRepository,
      driveExecutor,
    );
  });

  it('executes the Drive move THEN records the audit trail', async () => {
    proposals.findPending.mockResolvedValue(pendingProposal as never);
    const result = await service.confirm('org_1', 'prop_1', {});

    expect(driveExecutor.moveAndRename).toHaveBeenCalledWith({
      organizationId: 'org_1',
      documentExternalId: 'gdrive_123',
      newName: 'Facture_EDF_2026-03.pdf',
      destinationPath: '/Comptabilité/Électricité',
    });
    expect(proposals.confirmTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'CONFIRMED', organizationId: 'org_1' }),
    );
    expect(result).toEqual({ executed: true, destinationPath: '/Comptabilité/Électricité' });
  });

  it('records nothing when the Drive execution fails', async () => {
    proposals.findPending.mockResolvedValue(pendingProposal as never);
    driveExecutor.moveAndRename.mockRejectedValue(new Error('drive down'));
    await expect(service.confirm('org_1', 'prop_1', {})).rejects.toThrow('drive down');
    expect(proposals.confirmTransaction).not.toHaveBeenCalled();
  });

  it('marks the proposal OVERRIDDEN when the user picks another destination', async () => {
    proposals.findPending.mockResolvedValue(pendingProposal as never);
    await service.confirm('org_1', 'prop_1', { overrideDestinationPath: '/Archives' });
    expect(proposals.confirmTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'OVERRIDDEN', destinationPath: '/Archives' }),
    );
  });

  it('cannot confirm a proposal from another tenant (repository returns null)', async () => {
    proposals.findPending.mockResolvedValue(null);
    await expect(service.confirm('org_other', 'prop_1', {})).rejects.toThrow(NotFoundException);
    expect(driveExecutor.moveAndRename).not.toHaveBeenCalled();
  });
});
