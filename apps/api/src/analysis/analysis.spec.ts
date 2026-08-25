import { SuggestDestinationAgent } from './agents/suggest-destination.agent';
import { SuggestFilenameAgent } from './agents/suggest-filename.agent';
import { extract } from './extraction/extract';
import { normalizePages } from './extraction/normalize';
import { FakeLlmProvider } from './llm/fake.provider';
import { AnalyseDocumentAgent } from './agents/analyse-document.agent';
import { LocalStructuredProvider } from './llm/local.provider';
import { SuggestionService } from './suggestion.service';
import { StructuredGeneration } from './llm/llm.types';

const analysis = { subject: 'facture', documentType: 'facture', dates: ['2026-08-15'], topics: ['électricité'], purpose: 'paiement', parties: ['Acme'], identifiers: ['F-42'], amount: '120,00 EUR', signals: ['document_type', 'document_date', 'issuer', 'invoice_number', 'amount'] as const };

describe('document understanding units', () => {
  it('normalizes, removes repeated page furniture and retains key fields while truncating', () => {
    const text = normalizePages([{ pageNumber: 1, method: 'text', text: `CONFIDENTIEL\nFacture F-42\n${'début '.repeat(5000)}` }, { pageNumber: 2, method: 'text', text: `CONFIDENTIEL\nTotal 120 EUR\n${'fin '.repeat(5000)}` }]);
    expect(text).not.toContain('CONFIDENTIEL'); expect(text).toContain('Facture F-42'); expect(text).toContain('Total 120 EUR'); expect(text.length).toBeLessThanOrEqual(20_000);
  });
  it('dispatches text and exposes unsupported Office as a reviewable failure', async () => {
    await expect(extract({ content: Buffer.from('Facture synthétique F-42 Acme'), mimeType: 'text/plain', originalName: 'x.txt' })).resolves.toMatchObject({ quality: 'ok', method: 'text' });
    await expect(extract({ content: Buffer.from('synthetic'), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', originalName: 'x.docx' })).resolves.toMatchObject({ quality: 'failed', warnings: ['office_extractor_unavailable'] });
  });
  it('preserves extension, sanitizes and caps sparse confidence', async () => {
    const provider = new FakeLlmProvider([{ value: '../2026 Facture Acme.exe', confidence: .95, signals: ['document_type', 'document_date'], reviewRequired: false, failureReason: null }]);
    const result = await new SuggestFilenameAgent(provider).run({ analysis: analysis as never, originalName: 'totally-wrong.PDF', convention: 'date_type_party', confidenceCap: .35 });
    expect(result.value).toBe('_2026_Facture_Acme.pdf'); expect(result.confidence).toBe(.35); expect(result.reviewRequired).toBe(true); expect(result.signals).toEqual(['document_type', 'document_date']);
  });
  it('rejects generic model filenames explicitly', async () => {
    const result = await new SuggestFilenameAgent(new FakeLlmProvider([{ value: 'scan', confidence: .9, signals: [], reviewRequired: false, failureReason: null }])).run({ analysis: analysis as never, originalName: 'misleading.pdf', convention: 'date_type', confidenceCap: 1 });
    expect(result).toMatchObject({ confidence: 0, reviewRequired: true, failureReason: 'invalid_model_output', value: 'classement_manuel.pdf' });
  });
  it.each(['/Clients/../Secret', '/Invented'])('fails closed for destination %s', async (path) => {
    const result = await new SuggestDestinationAgent(new FakeLlmProvider([{ path, confidence: .9, signals: ['matched_folder_path'], reviewRequired: false, failureReason: null }])).run({ analysis: analysis as never, tree: [{ id: 'root', name: 'Clients', path: '/Clients', children: [{ id: 'acme', name: 'Acme', path: '/Clients/Acme', children: [] }] }], confidenceCap: 1 });
    expect(result).toMatchObject({ path: null, confidence: 0, reviewRequired: true, failureReason: 'out_of_tree' });
  });
  it('turns malformed output into a typed failure', async () => {
    const result = await new SuggestDestinationAgent(new FakeLlmProvider([{ path: 42 }])).run({ analysis: analysis as never, tree: [], confidenceCap: 1 });
    expect(result).toMatchObject({ path: null, confidence: 0, failureReason: 'invalid_model_output' });
  });
  it('rejects malformed structured analysis output', async () => {
    await expect(new AnalyseDocumentAgent(new FakeLlmProvider([{ documentType: 42 }])).run({ text: 'synthetic', pages: [], pageCount: 1, quality: 'ok', warnings: [], method: 'text' })).rejects.toThrow();
  });
  it('sends each declarative JSON field contract to its provider prompt', async () => {
    const requests: StructuredGeneration[] = [];
    const responses: Record<StructuredGeneration['task'], unknown> = {
      analyse_document: analysis,
      suggest_filename: { value: 'facture', confidence: 1, signals: [], reviewRequired: false, failureReason: null },
      suggest_destination: { path: '/Clients', confidence: 1, signals: [], reviewRequired: false, failureReason: null },
    };
    const provider = new FakeLlmProvider((request) => { requests.push(request); return responses[request.task]; });
    await new AnalyseDocumentAgent(provider).run({ text: 'synthetic', pages: [], pageCount: 1, quality: 'ok', warnings: [], method: 'text' });
    await new SuggestFilenameAgent(provider).run({ analysis: analysis as never, originalName: 'x.pdf', convention: 'type', confidenceCap: 1 });
    await new SuggestDestinationAgent(provider).run({ analysis: analysis as never, tree: [{ id: '1', name: 'Clients', path: '/Clients', children: [] }], confidenceCap: 1 });
    const prompts = Object.fromEntries(requests.map(({ task, prompt }) => [task, prompt]));
    expect(prompts.analyse_document).toContain('{"subject": string|null, "documentType": string|null, "dates": string[], "topics": string[], "purpose": string|null, "parties": string[], "identifiers": string[], "amount"?: string|null, "signals": signal[]}');
    expect(prompts.analyse_document).toEqual(expect.stringContaining('YYYY-MM-DD'));
    expect(prompts.suggest_filename).toContain('{"value": string, "confidence": number from 0 through 1, "signals": signal[], "reviewRequired": boolean, "failureReason": failure|null}');
    expect(prompts.suggest_destination).toContain('{"path": string|null, "confidence": number from 0 through 1, "signals": signal[], "reviewRequired": boolean, "failureReason": failure|null}');
    for (const prompt of Object.values(prompts)) {
      expect(prompt).toContain('raw JSON object');
      expect(prompt).toContain('"matched_folder_path"');
    }
  });
  it('shares extraction and analysis across both public entrypoints and applies the sparse cap', async () => {
    const responses = [analysis, { value: '2026-08-15_facture_Acme_F-42', confidence: .9, signals: ['document_type'], reviewRequired: false, failureReason: null }, { path: '/Clients/Acme', confidence: .8, signals: ['matched_folder_path'], reviewRequired: false, failureReason: null }]; let calls = 0;
    const provider = new FakeLlmProvider(() => { calls += 1; return responses.shift(); });
    const service = new SuggestionService(provider); const input = { content: Buffer.from('Facture F-42'), mimeType: 'text/plain', originalName: 'wrong.pdf' };
    const [filename, destination] = await Promise.all([service.suggestFilename(input), service.suggestDestination(input, [{ id: '1', name: 'Acme', path: '/Clients/Acme', children: [] }])]);
    expect(filename).toMatchObject({ value: '2026-08-15_facture_Acme_F-42.pdf', confidence: .35, reviewRequired: true });
    expect(destination).toMatchObject({ path: '/Clients/Acme', confidence: .35, reviewRequired: true });
    expect(calls).toBe(3);
  });
  it.each(['tenant', 'environment'] as const)('applies agent model overrides only to the environment source (%s)', async (source) => {
    const requests: StructuredGeneration[] = [];
    const provider = new FakeLlmProvider((request) => { requests.push(request); return request.task === 'analyse_document' ? analysis : request.task === 'suggest_filename' ? { value: 'facture', confidence: 1, signals: [], reviewRequired: false, failureReason: null } : { path: '/Clients', confidence: 1, signals: [], reviewRequired: false, failureReason: null }; });
    const resolver = { forOrganization: jest.fn().mockResolvedValue({ provider, source }) };
    const previous = [process.env.KLASR_AGENT_ANALYSE_MODEL, process.env.KLASR_AGENT_FILENAME_MODEL, process.env.KLASR_AGENT_DESTINATION_MODEL];
    [process.env.KLASR_AGENT_ANALYSE_MODEL, process.env.KLASR_AGENT_FILENAME_MODEL, process.env.KLASR_AGENT_DESTINATION_MODEL] = ['env-analysis', 'env-filename', 'env-destination'];
    try {
      const service = new SuggestionService(resolver); const input = { organizationId: 'org-a', content: Buffer.from('Facture F-42'), mimeType: 'text/plain', originalName: 'x.pdf' };
      await Promise.all([service.suggestFilename(input), service.suggestDestination(input, [{ id: '1', name: 'Clients', path: '/Clients', children: [] }])]);
      expect(Object.fromEntries(requests.map(({ task, model }) => [task, model]))).toEqual(source === 'tenant'
        ? { analyse_document: undefined, suggest_filename: undefined, suggest_destination: undefined }
        : { analyse_document: 'env-analysis', suggest_filename: 'env-filename', suggest_destination: 'env-destination' });
    } finally { [process.env.KLASR_AGENT_ANALYSE_MODEL, process.env.KLASR_AGENT_FILENAME_MODEL, process.env.KLASR_AGENT_DESTINATION_MODEL] = previous; }
  });
  it.each([['', 'empty_content'], ['\u0000\u0001', 'empty_content']])('returns a reviewable zero-confidence result for empty/corrupt text', async (content, failureReason) => {
    const result = await new SuggestionService(new LocalStructuredProvider()).suggestDestination({ content: Buffer.from(content), mimeType: 'text/plain', originalName: 'x.txt' }, []);
    expect(result).toMatchObject({ path: null, confidence: 0, reviewRequired: true, failureReason });
  });
  it('uses nested parent context, rejects ambiguity and returns no match without a default', async () => {
    const service = new SuggestionService(new LocalStructuredProvider());
    const nested = [{ id: 'root', name: 'Clients', path: '/Clients', children: [{ id: 'a', name: 'Acme', path: '/Clients/Acme', children: [] }] }];
    await expect(service.suggestDestination({ content: Buffer.from('Facture de Acme 2026-08-15'), mimeType: 'text/plain', originalName: 'x.txt' }, nested)).resolves.toMatchObject({ path: '/Clients/Acme' });
    const ambiguous = [{ id: 'a', name: 'Acme', path: '/Clients/Acme', children: [] }, { id: 'b', name: 'Acme', path: '/Fournisseurs/Acme', children: [] }];
    await expect(service.suggestDestination({ content: Buffer.from('Facture de Acme 2026-08-15'), mimeType: 'text/plain', originalName: 'x.txt' }, ambiguous)).resolves.toMatchObject({ path: null, failureReason: 'ambiguous_destination' });
    await expect(service.suggestDestination({ content: Buffer.from('Lettre sans correspondant 2026-08-15'), mimeType: 'text/plain', originalName: 'x.txt' }, nested)).resolves.toMatchObject({ path: null, failureReason: 'no_destination_match' });
  });
});
