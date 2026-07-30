import { Injectable } from '@nestjs/common';
import { Prisma, ProposalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ProposalWithDocument = Prisma.ClassificationProposalGetPayload<{
  include: { document: true };
}>;

@Injectable()
export class ProposalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listPending(organizationId: string): Promise<ProposalWithDocument[]> {
    return this.prisma.classificationProposal.findMany({
      where: { organizationId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      include: { document: true },
    });
  }

  findPending(organizationId: string, proposalId: string): Promise<ProposalWithDocument | null> {
    return this.prisma.classificationProposal.findFirst({
      where: { id: proposalId, organizationId, status: 'PENDING' },
      include: { document: true },
    });
  }

  createPending(params: {
    organizationId: string;
    documentId: string;
    proposedName: string;
    destinationPath: string;
    confidence: number;
    source: 'RULE' | 'LLM';
    modelUsed?: string;
    llmCallsUsed: number;
  }): Promise<ProposalWithDocument> {
    return this.prisma.classificationProposal.create({
      data: {
        organizationId: params.organizationId,
        documentId: params.documentId,
        proposedName: params.proposedName,
        destinationPath: params.destinationPath,
        confidence: params.confidence,
        source: params.source,
        modelUsed: params.modelUsed,
        llmCallsUsed: params.llmCallsUsed,
      },
      include: { document: true },
    });
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
  confirmTransaction(params: {
    organizationId: string;
    proposalId: string;
    documentId: string;
    status: Extract<ProposalStatus, 'CONFIRMED' | 'OVERRIDDEN'>;
    newName: string;
    destinationPath: string;
    previousName: string;
    actorId?: string;
  }): Promise<void> {
    const { organizationId } = params;
    return this.prisma
      .$transaction([
        this.prisma.classificationProposal.updateMany({
          where: { id: params.proposalId, organizationId },
          data: { status: params.status, decidedAt: new Date() },
        }),
        this.prisma.document.updateMany({
          where: { id: params.documentId, organizationId },
          data: { status: 'CLASSIFIED', name: params.newName },
        }),
        this.prisma.actionHistory.create({
          data: {
            action: 'MOVE_RENAME',
            fromName: params.previousName,
            toName: params.newName,
            toPath: params.destinationPath,
            documentId: params.documentId,
            organizationId,
            actorId: params.actorId,
          },
        }),
      ])
      .then(() => undefined);
  }
}
