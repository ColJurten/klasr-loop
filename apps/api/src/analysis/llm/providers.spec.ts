import { AnthropicProvider } from './anthropic.provider';
import { LocalStructuredProvider } from './local.provider';
import { createLlmProvider } from './provider.factory';

describe('structured providers', () => {
  afterEach(() => jest.restoreAllMocks());
  it('uses the Anthropic messages protocol without a bearer credential', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: '{"subject":null}' }] }), { status: 200 }));
    await new AnthropicProvider('sk-ant-synthetic', 'https://example.invalid/v1', 'configured-model').generate({ task: 'analyse_document', prompt: 'prompt', system: 'system', input: {} });
    expect(fetchMock).toHaveBeenCalledWith('https://example.invalid/v1/messages', expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'sk-ant-synthetic', 'anthropic-version': '2023-06-01' }) }));
    expect((fetchMock.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBeUndefined();
  });
  it('accepts plain or singly fenced JSON but rejects prose-wrapped JSON', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    for (const text of ['{"subject":null}', '```json\n{"subject":null}\n```']) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 }));
      await expect(new AnthropicProvider('synthetic', 'https://example.invalid/v1', 'model').generate({ task: 'analyse_document', prompt: '', system: '', input: {} }))
        .resolves.toMatchObject({ value: { subject: null } });
    }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: 'text', text: 'Result: ```json\n{"subject":null}\n```' }] }), { status: 200 }));
    await expect(new AnthropicProvider('synthetic', 'https://example.invalid/v1', 'model').generate({ task: 'analyse_document', prompt: '', system: '', input: {} })).rejects.toBeInstanceOf(SyntaxError);
  });
  it('uses the shared environment selection with local as the default', () => {
    expect(createLlmProvider(() => undefined)).toBeInstanceOf(LocalStructuredProvider);
    expect(createLlmProvider((name) => ({ KLASR_LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'synthetic', KLASR_LLM_BASE_URL: 'https://example.invalid/v1', KLASR_LLM_MODEL: 'configured-model' })[name])).toBeInstanceOf(AnthropicProvider);
  });
  it('dispatches local behavior by stable task id rather than prompt prose', async () => {
    const result = await new LocalStructuredProvider().generate({ task: 'analyse_document', prompt: 'completely edited prose', system: '', input: { content: 'Facture F-42' } });
    expect(result.value).toEqual(expect.objectContaining({ documentType: 'facture', identifiers: ['F-42'] }));
  });
});
