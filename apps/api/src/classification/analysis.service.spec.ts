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
    const ocr = { extractText: jest.fn().mockResolvedValue(ocrResult('facture électricité juillet')) };
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
    const ocr = { extractText: jest.fn().mockResolvedValue(ocrResult('releve bancaire compte courant')) };
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

  it('turns weak extraction into a reviewable non-executable proposal without LLM calls', async () => {
    const stream = new ReadableStream();
    const documents = {
      findPending: jest.fn().mockResolvedValue({
        id: 'doc_3',
        externalId: 'file_3',
        name: 'scan.pdf',
        mimeType: 'application/pdf',
        organizationId: 'org_1',
      }),
      markProposed: jest.fn().mockResolvedValue(undefined),
    };
    const drive = { download: jest.fn().mockResolvedValue(stream) };
    const ocr = { extractText: jest.fn().mockResolvedValue({ ...ocrResult(''), status: 'low_text', reason: 'Texte extrait insuffisant' }) };
    const rules = { listOrdered: jest.fn().mockResolvedValue([]) };
    const folders = { listInherited: jest.fn().mockResolvedValue([{ path: '/Alpha', externalId: 'alpha' }]) };
    const proposals = { createPending: jest.fn().mockResolvedValue(undefined) };
    const analyses = { record: jest.fn().mockResolvedValue(undefined) };
    const metrics = { increment: jest.fn().mockResolvedValue(undefined) };
    const provider = { name: 'anthropic', classify: jest.fn() };
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
      [provider] as never,
    );

    await service.analyze({ organizationId: 'org_1', documentId: 'doc_3' });

    expect(provider.classify).not.toHaveBeenCalled();
    expect(proposals.createPending).toHaveBeenCalledWith(expect.objectContaining({
      destinationPath: '',
      reviewRequired: true,
      confidence: 0,
    }));
    expect(analyses.record).toHaveBeenCalledWith(expect.objectContaining({
      llmRaw: expect.objectContaining({ status: 'low_text' }),
    }));
  });

  it('turns successful OCR with no credible destination into a reviewable proposal', async () => {
    const stream = new ReadableStream();
    const documents = {
      findPending: jest.fn().mockResolvedValue({
        id: 'doc_4',
        externalId: 'file_4',
        name: 'notes perso.pdf',
        mimeType: 'application/pdf',
        organizationId: 'org_1',
      }),
      markProposed: jest.fn().mockResolvedValue(undefined),
      markManual: jest.fn().mockResolvedValue(undefined),
    };
    const drive = { download: jest.fn().mockResolvedValue(stream) };
    const ocr = { extractText: jest.fn().mockResolvedValue(ocrResult('texte lisible sans destination crédible')) };
    const rules = { listOrdered: jest.fn().mockResolvedValue([]) };
    const folders = { listInherited: jest.fn().mockResolvedValue([]) };
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

    await service.analyze({ organizationId: 'org_1', documentId: 'doc_4' });

    expect(proposals.createPending).toHaveBeenCalledWith(expect.objectContaining({
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
    }));
    expect(documents.markProposed).toHaveBeenCalledWith('org_1', 'doc_4');
    expect(documents.markManual).not.toHaveBeenCalled();
    expect(analyses.record).toHaveBeenCalledWith(expect.objectContaining({
      llmRaw: { source: 'OCR', status: 'ok', method: 'ocr', pageCount: 1 },
    }));
  });
});

function ocrResult(text: string) {
  return {
    text,
    status: 'ok',
    pages: text ? [{ pageNumber: 1, text, method: 'ocr' }] : [],
    pageCount: text ? 1 : 0,
    method: text ? 'ocr' : 'none',
  };
}
