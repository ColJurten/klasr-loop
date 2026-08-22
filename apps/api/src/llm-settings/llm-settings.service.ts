import { BadRequestException, Injectable } from '@nestjs/common';
import { TokenEncryptionService } from '../auth/token-encryption.service';
import { LlmProvider } from '../analysis/llm/llm.provider';
import { LlmSettingsRepository } from './llm-settings.repository';
import { ProviderClientService, ProviderConfig, ProviderName } from './provider-client.service';

export interface SettingsInput { provider: ProviderName; apiKey: string; model?: string; baseUrl?: string; }

@Injectable()
export class LlmSettingsService {
  constructor(private readonly repository: LlmSettingsRepository, private readonly encryption: TokenEncryptionService, private readonly providers: ProviderClientService) {}

  async get(organizationId: string) { return safe(await this.repository.find(organizationId)); }

  async discover(input: SettingsInput): Promise<{ models: string[] }> {
    const config = normalized(input);
    try {
      await this.providers.endpoint(config);
      const models = await this.providers.discover(config);
      if (!models.length) throw new Error('provider_malformed_response');
      return { models };
    } catch (error) { throw mapped(error); }
  }

  async save(organizationId: string, input: SettingsInput) {
    const config = normalized(input);
    if (!config.model) throw mapped(new Error('provider_model_not_found'));
    try {
      const baseUrl = await this.providers.endpoint(config);
      await this.providers.validate({ ...config, baseUrl });
      const row = await this.repository.upsert(organizationId, { provider: config.provider, model: config.model, baseUrl, encryptedApiKey: this.encryption.encrypt(config.apiKey), status: 'VALID', validatedAt: new Date() });
      return safe(row);
    } catch (error) { throw mapped(error); }
  }

  async remove(organizationId: string): Promise<{ configured: false }> { await this.repository.delete(organizationId); return { configured: false }; }

  async resolve(organizationId: string): Promise<LlmProvider | null> {
    const row = await this.repository.find(organizationId);
    if (!row || row.status !== 'VALID') return null;
    return this.providers.createProvider({ provider: row.provider as ProviderName, model: row.model, baseUrl: row.baseUrl, apiKey: this.encryption.decrypt(row.encryptedApiKey) });
  }
}

function normalized(input: SettingsInput): ProviderConfig {
  const apiKey = input.apiKey?.trim(); const model = input.model?.trim();
  if (!apiKey || !['anthropic', 'openai', 'mistral', 'openai-compatible'].includes(input.provider)) throw new BadRequestException({ code: 'invalid_request', message: 'Fournisseur et clé API requis.' });
  return { provider: input.provider, apiKey, model, baseUrl: input.baseUrl?.trim() };
}
function safe(row: { provider: string; model: string; baseUrl: string; validatedAt: Date; status: string } | null) {
  return row ? { configured: true, provider: row.provider, model: row.model, baseUrl: row.baseUrl, validatedAt: row.validatedAt, status: row.status } : { configured: false };
}
function mapped(error: unknown): BadRequestException {
  const reason = error instanceof Error ? error.message : '';
  const map: Array<[string, string, string]> = [
    ['provider_unauthorized', 'invalid_key', 'Clé API refusée par le fournisseur.'],
    ['provider_model_not_found', 'model_not_accessible', 'Le modèle sélectionné est inaccessible.'],
    ['provider_model_incompatible', 'model_incompatible', 'Le modèle sélectionné n’est pas compatible avec les requêtes Klasr. Choisissez un autre modèle.'],
    ['provider_rate_limited', 'rate_limited', 'Limite du fournisseur atteinte. Réessayez plus tard.'],
    ['provider_timeout', 'timeout', 'Le fournisseur ne répond pas dans le délai imparti.'],
    ['provider_network', 'network_error', 'Le fournisseur est inaccessible.'],
    ['provider_unsafe', 'unsafe_endpoint', 'Cette adresse de fournisseur est interdite.'],
    ['provider_response_too_large', 'malformed_response', 'Réponse du fournisseur invalide.'],
    ['provider_malformed_response', 'malformed_response', 'Réponse du fournisseur invalide.'],
  ];
  const found = map.find(([prefix]) => reason.startsWith(prefix)) ?? ['provider_unavailable', 'endpoint_unavailable', 'Point d’accès fournisseur indisponible.'];
  return new BadRequestException({ code: found[1], message: found[2] });
}
