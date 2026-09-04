import { Injectable } from '@nestjs/common';
import { Prisma, ProposalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ProposalWithDocument = Prisma.ClassificationProposalGetPayload<{
  include: { document: true };
}>;

@Injectable()
export class ProposalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listPending(organizationId: string): Promise<ProposalWithDocument[]> {
    return this.prisma.classificationProposal.findMany({
      where: { organizationId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { document: true },
    });
  }

  async findPending(organizationId: string, proposalId: string): Promise<ProposalWithDocument | null> {
    return this.prisma.classificationProposal.findFirst({
      where: { id: proposalId, organizationId, status: 'PENDING' },
      include: { document: true },
    });
  }

  async claimPending(
    organizationId: string,
    proposalId: string,
    claimStatus: Extract<ProposalStatus, 'CONFIRMING' | 'IGNORING'>,
  ): Promise<ProposalWithDocument | null> {
    const claimed = await this.prisma.classificationProposal.updateMany({
      where: { id: proposalId, organizationId, status: 'PENDING' },
      data: { status: claimStatus },
    });
    if (claimed.count !== 1) return null;
    return this.prisma.classificationProposal.findFirst({
      where: { id: proposalId, organizationId, status: claimStatus },
      include: { document: true },
    });
  }

  async restorePendingClaim(
    organizationId: string,
    proposalId: string,
    claimStatus: Extract<ProposalStatus, 'CONFIRMING' | 'IGNORING'>,
  ): Promise<void> {
    await this.prisma.classificationProposal.updateMany({
      where: { id: proposalId, organizationId, status: claimStatus },
      data: { status: 'PENDING' },
    });
  }

  async createPending(params: {
    organizationId: string;
    documentId: string;
    proposedName: string;
    destinationPath: string;
    destinationFolderExternalId?: string;
    confidence: number;
    filenameConfidence?: number;
    destinationConfidence?: number;
    reviewRequired?: boolean;
    reviewReason?: string;
    source: 'RULE' | 'LLM';
    modelUsed?: string;
    llmCallsUsed: number;
  }): Promise<ProposalWithDocument> {
    const proposal = await this.prisma.classificationProposal.create({
      data: {
        organizationId: params.organizationId,
        documentId: params.documentId,
        proposedName: params.proposedName,
        destinationPath: params.destinationPath,
        destinationFolderExternalId: params.destinationFolderExternalId,
        confidence: params.confidence,
        filenameConfidence: params.filenameConfidence,
        destinationConfidence: params.destinationConfidence,
        reviewRequired: params.reviewRequired ?? false,
        reviewReason: params.reviewReason,
        source: params.source,
        modelUsed: params.modelUsed,
        llmCallsUsed: params.llmCallsUsed,
      },
      include: { document: true },
    });
    return proposal;
  }

  async listHistory(organizationId: string, take = 20) {
    return this.prisma.actionHistory.findMany({
      where: { organizationId },
      include: { document: true },
      orderBy: { executedAt: 'desc' },
      take,
    });
  }

  /** Single transaction: decide proposal + mark document + write audit history. */
  confirmClaimedTransaction(params: {
    organizationId: string;
    proposalId: string;
    documentId: string;
    status: Extract<ProposalStatus, 'CONFIRMED' | 'OVERRIDDEN'>;
    newName: string;
    destinationPath: string;
    destinationFolderExternalId?: string;
    previousName: string;
    actorId?: string;
  }): Promise<void> {
    const { organizationId } = params;
    return this.prisma.$transaction(async (tx) => {
      const proposal = await tx.classificationProposal.updateMany({
        where: { id: params.proposalId, organizationId, status: 'CONFIRMING' },
        data: {
          status: params.status,
          decidedAt: new Date(),
          finalName: params.newName,
          finalDestinationPath: params.destinationPath,
          finalDestinationFolderExternalId: params.destinationFolderExternalId,
        },
      });
      if (proposal.count !== 1) {
        throw new Error('Claimed proposal was not persisted');
      }
      await tx.document.updateMany({
        where: { id: params.documentId, organizationId },
        data: { status: 'CLASSIFIED', name: params.newName },
      });
      await tx.actionHistory.create({
        data: {
          action: 'MOVE_RENAME',
          fromName: params.previousName,
          toName: params.newName,
          toPath: params.destinationPath,
          documentId: params.documentId,
          organizationId,
          actorId: params.actorId,
        },
      });
    });
  }

  confirmTransaction(params: {
    organizationId: string;
    proposalId: string;
    documentId: string;
    status: Extract<ProposalStatus, 'CONFIRMED' | 'OVERRIDDEN'>;
    newName: string;
    destinationPath: string;
    destinationFolderExternalId?: string;
    previousName: string;
    actorId?: string;
  }): Promise<void> {
    return this.confirmClaimedTransaction(params);
  }

  ignoreClaimedTransaction(params: {
    organizationId: string;
    proposalId: string;
    documentId: string;
    previousName: string;
    actorId?: string;
  }): Promise<void> {
    const { organizationId } = params;
    return this.prisma.$transaction(async (tx) => {
      const proposal = await tx.classificationProposal.updateMany({
        where: { id: params.proposalId, organizationId, status: 'IGNORING' },
        data: {
          status: 'IGNORED',
          decidedAt: new Date(),
          finalName: null,
          finalDestinationPath: null,
          finalDestinationFolderExternalId: null,
        },
      });
      if (proposal.count !== 1) {
        throw new Error('Claimed proposal was not persisted');
      }
      await tx.document.updateMany({
        where: { id: params.documentId, organizationId },
        data: { status: 'IGNORED' },
      });
      await tx.actionHistory.create({
        data: {
          action: 'IGNORED',
          fromName: params.previousName,
          documentId: params.documentId,
          organizationId,
          actorId: params.actorId,
        },
      });
    });
  }

}
