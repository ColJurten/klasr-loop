import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { FoldersRepository } from '../drive/folders.repository';
import { ConfirmProposalDto } from './dto/confirm-proposal.dto';
import { DRIVE_EXECUTOR, DriveExecutor } from './drive-executor.port';
import { ProposalsRepository, ProposalWithDocument } from './proposals.repository';

@Injectable()
export class ClassificationService {
  constructor(
    private readonly proposals: ProposalsRepository,
    private readonly folders: FoldersRepository,
    @Inject(DRIVE_EXECUTOR) private readonly driveExecutor: DriveExecutor,
  ) {}

  listPending(organizationId: string): Promise<ProposalWithDocument[]> {
    return this.proposals.listPending(organizationId);
  }

  listHistory(organizationId: string) {
    return this.proposals.listHistory(organizationId);
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
    const proposal = await this.proposals.claimPending(organizationId, proposalId, 'CONFIRMING');
    if (!proposal) throw new ConflictException('Pending proposal not found or already decided');
    try {
      const finalName = validateFilename(dto.finalName ?? proposal.proposedName);
      const destination = dto.destinationFolderExternalId
        ? await this.folders.findByExternalId(organizationId, dto.destinationFolderExternalId)
        : dto.overrideDestinationPath
          ? await this.folders.findByPath(organizationId, dto.overrideDestinationPath)
          : proposal.destinationFolderExternalId
            ? await this.folders.findByExternalId(organizationId, proposal.destinationFolderExternalId)
            : await this.folders.findByPath(organizationId, proposal.destinationPath);
      if (!destination || !destination.inherited) {
        throw new BadRequestException('Destination folder must belong to the inherited reference tree');
      }
      const corrected = finalName !== proposal.proposedName || destination.path !== proposal.destinationPath;

      // 1. Execute in the Drive first — if the provider call fails, nothing terminal is recorded.
      await this.driveExecutor.moveAndRename({
        organizationId,
        ...(actorId ? { userId: actorId } : {}),
        documentExternalId: proposal.document.externalId,
        newName: finalName,
        destinationPath: destination.path,
        destinationFolderExternalId: destination.externalId,
      });

      // 2. Persist decision + document status + audit history atomically, conditioned on the claim.
      await this.proposals.confirmClaimedTransaction({
        organizationId,
        proposalId,
        documentId: proposal.documentId,
        status: corrected ? 'OVERRIDDEN' : 'CONFIRMED',
        newName: finalName,
        destinationPath: destination.path,
        destinationFolderExternalId: destination.externalId,
        previousName: proposal.document.name,
        actorId,
      });

      return { executed: true, destinationPath: destination.path };
    } catch (error) {
      // The Drive move/rename uses stable file and folder IDs; replaying the same command is retry-safe.
      // If the terminal SQL transaction already committed, this conditional restore is a no-op.
      await this.proposals.restorePendingClaim(organizationId, proposalId, 'CONFIRMING');
      throw error;
    }
  }

  async ignore(
    organizationId: string,
    proposalId: string,
    actorId?: string,
  ): Promise<{ ignored: true }> {
    const proposal = await this.proposals.claimPending(organizationId, proposalId, 'IGNORING');
    if (!proposal) throw new ConflictException('Pending proposal not found or already decided');
    try {
      await this.proposals.ignoreClaimedTransaction({
        organizationId,
        proposalId,
        documentId: proposal.documentId,
        previousName: proposal.document.name,
        actorId,
      });
      return { ignored: true };
    } catch (error) {
      await this.proposals.restorePendingClaim(organizationId, proposalId, 'IGNORING');
      throw error;
    }
  }
}

function validateFilename(value: string): string {
  const name = value.trim();
  if (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    hasControlCharacter(name)
  ) {
    throw new BadRequestException('Invalid filename');
  }
  return name;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
}
