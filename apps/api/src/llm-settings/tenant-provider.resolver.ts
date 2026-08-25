import { Inject, Injectable } from '@nestjs/common';
import { LlmProvider } from '../analysis/llm/llm.provider';
import { LlmSettingsService } from './llm-settings.service';

@Injectable()
export class TenantProviderResolver {
  constructor(private readonly settings: LlmSettingsService, @Inject('ENVIRONMENT_LLM') private readonly fallback: LlmProvider) {}
  async forOrganization(organizationId?: string): Promise<{ provider: LlmProvider; source: 'tenant' | 'environment' }> {
    const provider = organizationId ? await this.settings.resolve(organizationId) : undefined;
    return provider ? { provider, source: 'tenant' } : { provider: this.fallback, source: 'environment' };
  }
}
