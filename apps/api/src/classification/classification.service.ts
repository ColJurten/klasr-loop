import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfirmProposalDto } from './dto/confirm-proposal.dto';
import { DRIVE_EXECUTOR, DriveExecutor } from './drive-executor.port';
import { ProposalsRepository, ProposalWithDocument } from './proposals.repository';

@Injectable()
export class ClassificationService {
  constructor(
    private readonly proposals: ProposalsRepository,
    @Inject(DRIVE_EXECUTOR) private readonly driveExecutor: DriveExecutor,
  ) {}

  listPending(organizationId: string): Promise<ProposalWithDocument[]> {
    return this.proposals.listPending(organizationId);
  }

  /**
   * The single-click confirmation flow (product invariant): the user confirms
   * once, Klasr EXECUTES the move/rename in the Drive, then records the audit
   * trail. Optional override destination = the "Déplacer" secondary action.
   */
  async confirm(
    organizationId: string,
    proposalId: string,
    dto: ConfirmProposalDto,
    actorId?: string,
  ): Promise<{ executed: true; destinationPath: string }> {
    const proposal = await this.proposals.findPending(organizationId, proposalId);
    if (!proposal) throw new NotFoundException('Pending proposal not found');

    const destinationPath = dto.overrideDestinationPath ?? proposal.destinationPath;

    // 1. Execute in the Drive first — if the provider call fails, nothing is recorded.
    await this.driveExecutor.moveAndRename({
      organizationId,
      documentExternalId: proposal.document.externalId,
      newName: proposal.proposedName,
      destinationPath,
    });

    // 2. Persist decision + document status + audit history atomically.
    await this.proposals.confirmTransaction({
      organizationId,
      proposalId,
      documentId: proposal.documentId,
      status: dto.overrideDestinationPath ? 'OVERRIDDEN' : 'CONFIRMED',
      newName: proposal.proposedName,
      destinationPath,
      previousName: proposal.document.name,
      actorId,
    });

    return { executed: true, destinationPath };
  }
}
