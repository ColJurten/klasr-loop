import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { FoldersRepository } from '../drive/folders.repository';
import { DriveMetadataItem } from '../drive/google-drive.executor';
import { ConfirmProposalDto } from './dto/confirm-proposal.dto';
import { DRIVE_EXECUTOR, DriveExecutor } from './drive-executor.port';
import { ProposalsRepository, ProposalWithDocument } from './proposals.repository';

interface HoldingFolderExecutor extends DriveExecutor {
  ensureHoldingFolder(organizationId: string, referenceRootExternalId: string): Promise<DriveMetadataItem>;
}

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
      if (!destination || !destination.inherited || destination.holding) {
        throw new BadRequestException('Destination folder must belong to the inherited reference tree');
      }
      const corrected = finalName !== proposal.proposedName || destination.path !== proposal.destinationPath;

      // 1. Execute in the Drive first — if the provider call fails, nothing terminal is recorded.
      await this.driveExecutor.moveAndRename({
        organizationId,
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

  async reject(
    organizationId: string,
    proposalId: string,
    actorId?: string,
  ): Promise<{ executed: true; destinationPath: string }> {
    const proposal = await this.proposals.claimPending(organizationId, proposalId, 'REJECTING');
    if (!proposal) throw new ConflictException('Pending proposal not found or already decided');
    try {
      const reference = await this.folders.getReferenceRoot(organizationId);
      if (!reference) throw new BadRequestException('Reference root is required before reject');
      const holdingMetadata = await (this.driveExecutor as HoldingFolderExecutor).ensureHoldingFolder(
        organizationId,
        reference.externalId,
      );
      const holding = await this.folders.upsertHoldingFolder(organizationId, {
        id: holdingMetadata.id,
        name: holdingMetadata.name,
        parents: holdingMetadata.parents,
      }, reference.externalId);
      await this.driveExecutor.moveAndRename({
        organizationId,
        documentExternalId: proposal.document.externalId,
        newName: proposal.document.name,
        destinationPath: holding.path,
        destinationFolderExternalId: holding.externalId,
        rename: false,
      });
      await this.proposals.rejectClaimedTransaction({
        organizationId,
        proposalId,
        documentId: proposal.documentId,
        destinationPath: holding.path,
        destinationFolderExternalId: holding.externalId,
        previousName: proposal.document.name,
        actorId,
      });
      return { executed: true, destinationPath: holding.path };
    } catch (error) {
      // Holding-folder creation and the final stable-ID move are idempotent enough to retry visibly.
      await this.proposals.restorePendingClaim(organizationId, proposalId, 'REJECTING');
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
