import { ProposalsRepository } from './proposals.repository';

describe('ProposalsRepository', () => {
  it('persists review metadata atomically in the typed create call', async () => {
    const created = {
      id: 'proposal_1',
      filenameConfidence: 0.2,
      destinationConfidence: 0,
      reviewRequired: true,
      reviewReason: 'Destination ambiguë ou non crédible: classement manuel requis',
      document: { id: 'doc_1' },
    };
    const prisma = {
      classificationProposal: {
        create: jest.fn().mockResolvedValue(created),
      },
      $executeRaw: jest.fn(),
    };
    const repository = new ProposalsRepository(prisma as never);

    await expect(repository.createPending({
      organizationId: 'org_1',
      documentId: 'doc_1',
      proposedName: 'notes_perso.pdf',
      destinationPath: '',
      confidence: 0,
      filenameConfidence: 0.2,
      destinationConfidence: 0,
      reviewRequired: true,
      reviewReason: 'Destination ambiguë ou non crédible: classement manuel requis',
      source: 'LLM',
      modelUsed: 'no-credible-destination',
      llmCallsUsed: 0,
    })).resolves.toBe(created);

    expect(prisma.classificationProposal.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        filenameConfidence: 0.2,
        destinationConfidence: 0,
        reviewRequired: true,
        reviewReason: 'Destination ambiguë ou non crédible: classement manuel requis',
      }),
      include: { document: true },
    });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
