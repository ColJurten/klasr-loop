import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createLlmProvider } from '../analysis/llm/provider.factory';
import { TokenEncryptionService } from '../auth/token-encryption.service';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { LlmSettingsController } from './llm-settings.controller';
import { LlmSettingsRepository } from './llm-settings.repository';
import { LlmSettingsService } from './llm-settings.service';
import { ProviderClientService } from './provider-client.service';
import { TenantProviderResolver } from './tenant-provider.resolver';

@Module({
  controllers: [LlmSettingsController],
  providers: [LlmSettingsRepository, LlmSettingsService, ProviderClientService, TenantProviderResolver, TokenEncryptionService, InternalServiceGuard, { provide: 'ENVIRONMENT_LLM', useFactory: (config: ConfigService) => createLlmProvider((name) => config.get<string>(name)), inject: [ConfigService] }],
  exports: [TenantProviderResolver],
})
export class LlmSettingsModule {}
