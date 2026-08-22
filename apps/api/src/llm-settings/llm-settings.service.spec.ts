import { LlmSettingsService } from './llm-settings.service';

const key = 'synthetic-provider-key';

describe('LlmSettingsService RED contract', () => {
  const repository = {
    find: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  };
  const encryption = { encrypt: jest.fn(() => 'encrypted-envelope'), decrypt: jest.fn(() => key) };
  const providers = { endpoint: jest.fn(), discover: jest.fn(), validate: jest.fn(), createProvider: jest.fn() };
  const service = new LlmSettingsService(repository as never, encryption as never, providers as never);

  beforeEach(() => { jest.clearAllMocks(); providers.endpoint.mockImplementation(async (input: { baseUrl?: string }) => {
    if (input.baseUrl?.includes('169.254.')) throw new Error('provider_unsafe_endpoint');
    return 'https://api.openai.com/v1';
  }); });

  it('rejects format-only validation and invalid credentials', async () => {
    providers.validate.mockRejectedValueOnce(new Error('provider_unauthorized'));
    await expect(service.save('org-a', { provider: 'openai', apiKey: key, model: 'model-a' })).rejects.toMatchObject({ response: { code: 'invalid_key' } });
    expect(repository.upsert).not.toHaveBeenCalled();
  });

  it('rejects empty discovery and inaccessible selected models', async () => {
    providers.discover.mockResolvedValueOnce([]);
    await expect(service.discover({ provider: 'openai', apiKey: key })).rejects.toMatchObject({ response: { code: 'malformed_response' } });
    providers.validate.mockRejectedValueOnce(new Error('provider_model_not_found'));
    await expect(service.save('org-a', { provider: 'openai', apiKey: key, model: 'missing' })).rejects.toMatchObject({ response: { code: 'model_not_accessible' } });
  });

  it('reports a refused selected model as incompatible rather than an unavailable endpoint', async () => {
    providers.validate.mockRejectedValueOnce(new Error('provider_model_incompatible'));
    await expect(service.save('org-a', { provider: 'openai', apiKey: key, model: 'legacy-model' })).rejects.toMatchObject({
      response: { code: 'model_incompatible', message: expect.stringContaining('pas compatible') },
    });
    expect(repository.upsert).not.toHaveBeenCalled();
    providers.discover.mockRejectedValueOnce(new Error('provider_unavailable_400'));
    await expect(service.discover({ provider: 'openai', apiKey: key })).rejects.toMatchObject({ response: { code: 'endpoint_unavailable' } });
  });

  it('encrypts persistence and never discloses key or ciphertext', async () => {
    providers.validate.mockResolvedValueOnce(undefined);
    repository.upsert.mockResolvedValueOnce({ provider: 'openai', model: 'model-b', baseUrl: 'https://api.openai.com/v1', validatedAt: new Date(), status: 'VALID' });
    const saved = await service.save('org-a', { provider: 'openai', apiKey: key, model: 'model-b' });
    expect(repository.upsert).toHaveBeenCalledWith('org-a', expect.objectContaining({ encryptedApiKey: 'encrypted-envelope' }));
    expect(JSON.stringify(saved)).not.toContain(key);
    expect(JSON.stringify(saved)).not.toContain('encrypted-envelope');
  });

  it('scopes get and delete to the authenticated organization', async () => {
    repository.find.mockResolvedValueOnce(null);
    await service.get('org-b');
    await service.remove('org-b');
    expect(repository.find).toHaveBeenCalledWith('org-b');
    expect(repository.delete).toHaveBeenCalledWith('org-b');
  });

  it('rejects unsafe custom endpoints', async () => {
    await expect(service.discover({ provider: 'openai-compatible', apiKey: key, baseUrl: 'http://169.254.169.254/latest' })).rejects.toMatchObject({ response: { code: 'unsafe_endpoint' } });
    expect(providers.discover).not.toHaveBeenCalled();
  });
});
