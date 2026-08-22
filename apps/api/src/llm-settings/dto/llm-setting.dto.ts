import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class LlmSettingDto {
  @IsIn(['anthropic', 'openai', 'mistral', 'openai-compatible']) provider!: 'anthropic' | 'openai' | 'mistral' | 'openai-compatible';
  @IsString() @IsNotEmpty() @MaxLength(500) apiKey!: string;
  @IsOptional() @IsString() @MaxLength(200) model?: string;
  @IsOptional() @IsUrl({ require_tld: false, protocols: ['http', 'https'], require_protocol: true }) @MaxLength(500) baseUrl?: string;
}
