import { AnalysisService } from './analysis.service';

describe('AnalysisService', () => {
  const jobs = { registerAnalysisHandler: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('streams OCR into rule classification, stores metadata in Mongo, and never persists bytes', async () => {
    const stream = new ReadableStream();
    const documents = {
      findPending: jest.fn().mockResolvedValue({
        id: 'doc_1',
        externalId: 'file_1',
        name: 'scan.pdf',
        mimeType: 'application/pdf',
        organizationId: 'org_1',
      }),
      markProposed: jest.fn().mockResolvedValue(undefined),
    };
    const drive = { download: jest.fn().mockResolvedValue(stream) };
    const ocr = { extractText: jest.fn().mockResolvedValue('facture électricité juillet') };
    const rules = {
      listOrdered: jest.fn().mockResolvedValue([
        {
          priority: 1,
          destinationPath: '/Comptabilité/Électricité',
          suggestedNameTemplate: 'Facture_Electricite_2026-07.pdf',
          conditions: [{ field: 'CONTENT', operator: 'CONTAINS', value: 'électricité' }],
        },
      ]),
    };
    const folders = {
      listInherited: jest.fn().mockResolvedValue([
        { path: '/Comptabilité/Électricité', externalId: 'folder_elec' },
      ]),
    };
    const proposals = { createPending: jest.fn().mockResolvedValue(undefined) };
    const analyses = { record: jest.fn().mockResolvedValue(undefined) };
    const metrics = { increment: jest.fn().mockResolvedValue(undefined) };
    const service = new AnalysisService(
      documents as never,
      drive as never,
      ocr as never,
      rules as never,
      folders as never,
      proposals as never,
      analyses as never,
      metrics as never,
      jobs as never,
    );

    await service.analyze({ organizationId: 'org_1', documentId: 'doc_1' });

    expect(ocr.extractText).toHaveBeenCalledWith(stream, {
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
    });
    expect(proposals.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc_1',
        proposedName: 'Facture_Electricite_2026-07.pdf',
        source: 'RULE',
      }),
    );
    expect(analyses.record).toHaveBeenCalledWith(
      expect.not.objectContaining({
        bytes: expect.anything(),
        content: expect.anything(),
        ocrExcerpt: expect.anything(),
      }),
    );
  });

  it('registers itself as the pg-boss analysis consumer', async () => {
    const service = new AnalysisService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      jobs as never,
    );

    service.onModuleInit();

    expect(jobs.registerAnalysisHandler).toHaveBeenCalledWith(expect.any(Function));
  });

  it('falls back to the local heuristic provider when no rule matches', async () => {
    const stream = new ReadableStream();
    const documents = {
      findPending: jest.fn().mockResolvedValue({
        id: 'doc_2',
        externalId: 'file_2',
        name: 'releve-banque.pdf',
        mimeType: 'application/pdf',
        organizationId: 'org_1',
      }),
      markProposed: jest.fn().mockResolvedValue(undefined),
    };
    const drive = { download: jest.fn().mockResolvedValue(stream) };
    const ocr = { extractText: jest.fn().mockResolvedValue('releve bancaire compte courant') };
    const rules = { listOrdered: jest.fn().mockResolvedValue([]) };
    const folders = {
      listInherited: jest.fn().mockResolvedValue([
        { path: '/Comptabilité/Banque', externalId: 'folder_banque' },
      ]),
    };
    const proposals = { createPending: jest.fn().mockResolvedValue(undefined) };
    const analyses = { record: jest.fn().mockResolvedValue(undefined) };
    const metrics = { increment: jest.fn().mockResolvedValue(undefined) };
    const localProvider = {
      name: 'local',
      classify: jest.fn().mockResolvedValue({
        proposedName: 'releve-banque.pdf',
        destinationPath: '/Comptabilité/Banque',
        confidence: 0.72,
      }),
    };
    const service = new AnalysisService(
      documents as never,
      drive as never,
      ocr as never,
      rules as never,
      folders as never,
      proposals as never,
      analyses as never,
      metrics as never,
      jobs as never,
      [localProvider] as never,
    );

    await service.analyze({ organizationId: 'org_1', documentId: 'doc_2' });

    expect(localProvider.classify).toHaveBeenCalledWith({
      documentText: 'releve bancaire compte courant',
      filename: 'releve-banque.pdf',
      folderPaths: ['/Comptabilité/Banque'],
    });
    expect(proposals.createPending).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'LLM',
        modelUsed: 'local',
        llmCallsUsed: 0,
      }),
    );
  });
});
