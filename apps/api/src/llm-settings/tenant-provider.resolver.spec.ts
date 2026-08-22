import { LocalStructuredProvider } from '../analysis/llm/local.provider';
import { TenantProviderResolver } from './tenant-provider.resolver';

describe('TenantProviderResolver RED contract', () => {
  it('exposes whether each provider came from the tenant or environment fallback', async () => {
    const configured = { generate: jest.fn() };
    const settings = { resolve: jest.fn().mockResolvedValueOnce(configured).mockResolvedValueOnce(null) };
    const resolver = new TenantProviderResolver(settings as never, new LocalStructuredProvider());
    await expect(resolver.forOrganization('org-a')).resolves.toEqual({ provider: configured, source: 'tenant' });
    await expect(resolver.forOrganization('org-b')).resolves.toEqual({ provider: expect.any(LocalStructuredProvider), source: 'environment' });
    expect(settings.resolve).toHaveBeenNthCalledWith(1, 'org-a');
  });
});
