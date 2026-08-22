import { AnalysisService } from './analysis.service';

describe('AnalysisService', () => {
  const jobs = { registerAnalysisHandler: jest.fn() };
  beforeEach(() => jest.clearAllMocks());

  it('persists suggestions as metadata only and builds a nested destination tree', async () => {
    const documents = { findPending: jest.fn().mockResolvedValue({ id: 'doc_1', externalId: 'file_1', name: 'misleading.pdf', mimeType: 'text/plain' }), markProposed: jest.fn() };
    const drive = { download: jest.fn().mockResolvedValue(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('synthetic')); controller.close(); } })) };
    const rules = { listOrdered: jest.fn().mockResolvedValue([]) };
    const folders = { listInherited: jest.fn().mockResolvedValue([{ externalId: 'root', parentExternalId: null, name: 'Clients', path: '/Clients' }, { externalId: 'acme', parentExternalId: 'root', name: 'Acme', path: '/Clients/Acme' }]) };
    const proposals = { createPending: jest.fn() }; const analyses = { record: jest.fn() }; const metrics = { increment: jest.fn() };
    const suggestions = { suggestFilename: jest.fn().mockResolvedValue({ value: '2026-08-15_facture_Acme_F-42.pdf', confidence: .9, signals: ['document_type'], reviewRequired: false, failureReason: null, provider: 'fake', model: 'deterministic' }), suggestDestination: jest.fn().mockResolvedValue({ path: '/Clients/Acme', confidence: .8, signals: ['matched_folder_path'], reviewRequired: false, failureReason: null, provider: 'fake', model: 'deterministic' }) };
    const service = new AnalysisService(documents as never, drive as never, rules as never, folders as never, proposals as never, analyses as never, metrics as never, jobs as never, suggestions as never);
    await service.analyze({ organizationId: 'org_1', documentId: 'doc_1' });
    expect(suggestions.suggestDestination).toHaveBeenCalledWith(expect.objectContaining({ originalName: 'misleading.pdf' }), [{ id: 'root', name: 'Clients', path: '/Clients', children: [{ id: 'acme', name: 'Acme', path: '/Clients/Acme', children: [] }] }]);
    expect(proposals.createPending).toHaveBeenCalledWith(expect.objectContaining({ proposedName: '2026-08-15_facture_Acme_F-42.pdf', destinationFolderExternalId: 'acme', confidence: .8, modelUsed: 'fake/deterministic' }));
    expect(analyses.record).toHaveBeenCalledWith(expect.not.objectContaining({ content: expect.anything(), text: expect.anything(), bytes: expect.anything() }));
  });

  it('registers itself as the analysis consumer', () => {
    new AnalysisService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, jobs as never, {} as never).onModuleInit();
    expect(jobs.registerAnalysisHandler).toHaveBeenCalledWith(expect.any(Function));
  });

  it('evaluates CONTENT rules against extracted text and skips suggestion calls on a strong match', async () => {
    const documents = { findPending: jest.fn().mockResolvedValue({ id: 'doc_1', externalId: 'file_1', name: 'unknown.txt', mimeType: 'text/plain' }), markProposed: jest.fn() };
    const drive = { download: jest.fn().mockResolvedValue(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('Facture fournisseur Acme numero F-42 total 120 EUR')); controller.close(); } })) };
    const rules = { listOrdered: jest.fn().mockResolvedValue([{ id: 'rule_1', priority: 1, destinationPath: '/Factures', suggestedNameTemplate: 'facture.pdf', conditions: [{ field: 'CONTENT', operator: 'CONTAINS', value: 'Acme' }] }]) };
    const folders = { listInherited: jest.fn().mockResolvedValue([{ externalId: 'f', parentExternalId: null, name: 'Factures', path: '/Factures' }]) };
    const proposals = { createPending: jest.fn() }; const analyses = { record: jest.fn() }; const metrics = { increment: jest.fn() };
    const suggestions = { suggestFilename: jest.fn(), suggestDestination: jest.fn() };
    await new AnalysisService(documents as never, drive as never, rules as never, folders as never, proposals as never, analyses as never, metrics as never, jobs as never, suggestions as never).analyze({ organizationId: 'org_1', documentId: 'doc_1' });
    expect(proposals.createPending).toHaveBeenCalledWith(expect.objectContaining({ source: 'RULE', destinationPath: '/Factures', llmCallsUsed: 0 }));
    expect(suggestions.suggestFilename).not.toHaveBeenCalled();
  });

  it('turns a failed Drive download into a non-executable manual-review proposal', async () => {
    const documents = { findPending: jest.fn().mockResolvedValue({ id: 'doc_1', externalId: 'native_1', name: 'native.gdoc', mimeType: 'application/vnd.google-apps.document' }), markProposed: jest.fn() };
    const drive = { download: jest.fn().mockRejectedValue(new Error('not_downloadable')) }; const rules = { listOrdered: jest.fn().mockResolvedValue([]) }; const folders = { listInherited: jest.fn().mockResolvedValue([]) };
    const proposals = { createPending: jest.fn() }; const analyses = { record: jest.fn() }; const metrics = { increment: jest.fn() };
    const failed = { value: 'classement_manuel.gdoc', path: null, confidence: 0, signals: [], reviewRequired: true, failureReason: 'extraction_failed', provider: 'none', model: '' };
    const suggestions = { suggestFilename: jest.fn().mockResolvedValue(failed), suggestDestination: jest.fn().mockResolvedValue(failed) };
    await new AnalysisService(documents as never, drive as never, rules as never, folders as never, proposals as never, analyses as never, metrics as never, jobs as never, suggestions as never).analyze({ organizationId: 'org_1', documentId: 'doc_1' });
    expect(proposals.createPending).toHaveBeenCalledWith(expect.objectContaining({ destinationPath: '', confidence: 0, reviewRequired: true, llmCallsUsed: 0 }));
    expect(documents.markProposed).toHaveBeenCalled();
  });
});
