import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AnthropicProvider } from '../analysis/llm/anthropic.provider';
import { LlmProvider } from '../analysis/llm/llm.provider';
import { OpenAiCompatibleProvider } from '../analysis/llm/openai-compatible.provider';

export type ProviderName = 'anthropic' | 'openai' | 'mistral' | 'openai-compatible';
export interface ProviderConfig { provider: ProviderName; apiKey: string; model?: string; baseUrl?: string; }
const BASES: Record<Exclude<ProviderName, 'openai-compatible'>, string> = {
  anthropic: 'https://api.anthropic.com/v1', openai: 'https://api.openai.com/v1', mistral: 'https://api.mistral.ai/v1',
};
const MAX_BYTES = 1_000_000;

@Injectable()
export class ProviderClientService {
  async endpoint(config: ProviderConfig): Promise<string> {
    const raw = config.provider === 'openai-compatible' ? config.baseUrl : BASES[config.provider];
    if (!raw) throw new Error('provider_unsafe_endpoint');
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error('provider_unsafe_endpoint'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('provider_unsafe_endpoint');
    url.pathname = url.pathname.replace(/\/$/, ''); url.search = ''; url.hash = '';
    if (config.provider === 'openai-compatible') await assertSafeCustom(url);
    return url.toString().replace(/\/$/, '');
  }

  async discover(config: ProviderConfig): Promise<string[]> {
    const base = await this.endpoint(config);
    const response = await boundedFetch(`${base}/models`, { headers: headers(config) });
    if (!response.ok) throw statusError(response.status, 'discovery');
    const body = await safeJson(response) as { data?: Array<{ id?: unknown }> };
    if (!Array.isArray(body.data)) throw new Error('provider_malformed_response');
    return [...new Set(body.data.map((item) => typeof item.id === 'string' ? item.id.trim() : '').filter(Boolean))].sort();
  }

  async validate(config: ProviderConfig): Promise<void> {
    if (!config.model) throw new Error('provider_model_not_found');
    const base = await this.endpoint(config);
    const anthropic = config.provider === 'anthropic';
    const response = await boundedFetch(`${base}/${anthropic ? 'messages' : 'chat/completions'}`, {
      method: 'POST', headers: { ...headers(config), 'content-type': 'application/json' },
      body: JSON.stringify(anthropic
        ? { model: config.model, max_tokens: 1, messages: [{ role: 'user', content: 'Reply with {}.' }] }
        : { model: config.model, max_tokens: 1, messages: [{ role: 'user', content: 'Reply with {}.' }] }),
    });
    if (!response.ok) throw statusError(response.status, 'validation');
    await safeJson(response);
  }

  createProvider(config: Required<Pick<ProviderConfig, 'provider' | 'apiKey' | 'model'>> & { baseUrl: string }): LlmProvider {
    return config.provider === 'anthropic'
      ? new AnthropicProvider(config.apiKey, config.baseUrl, config.model)
      : new OpenAiCompatibleProvider(config.apiKey, config.baseUrl, config.model, config.provider);
  }
}

function headers(config: ProviderConfig): Record<string, string> {
  return config.provider === 'anthropic'
    ? { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${config.apiKey}` };
}
/**
 * A rejected request during selected-model validation means the model itself cannot
 * serve Klasr requests (400/422), which is actionable for the user. The same status
 * during discovery only says the endpoint is unusable, so the phase must be explicit.
 */
function statusError(status: number, phase: 'discovery' | 'validation'): Error {
  if (status === 401 || status === 403) return new Error('provider_unauthorized');
  if (status === 404) return new Error('provider_model_not_found');
  if (status === 429) return new Error('provider_rate_limited');
  if (phase === 'validation' && (status === 400 || status === 422)) return new Error('provider_model_incompatible');
  return new Error(`provider_unavailable_${status}`);
}
async function boundedFetch(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try { response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(Number(process.env.KLASR_LLM_TIMEOUT_MS || 10_000)) }); }
  catch (error) { throw new Error(error instanceof DOMException && error.name === 'TimeoutError' ? 'provider_timeout' : 'provider_network'); }
  if (response.status >= 300 && response.status < 400) throw new Error('provider_unsafe_redirect');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_BYTES) throw new Error('provider_response_too_large');
  return response;
}
async function safeJson(response: Response): Promise<unknown> {
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new Error('provider_response_too_large');
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { throw new Error('provider_malformed_response'); }
}
async function assertSafeCustom(url: URL): Promise<void> {
  const local = url.hostname === 'localhost' || isLoopback(normalizeIp(url.hostname));
  if (local && (process.env.NODE_ENV === 'test' || process.env.KLASR_LOCAL_MVP === 'true')) return;
  if (url.protocol !== 'https:' || local) throw new Error('provider_unsafe_endpoint');
  const allowed = (process.env.KLASR_LLM_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  if (process.env.NODE_ENV === 'production' && !allowed.includes(url.origin)) throw new Error('provider_unsafe_endpoint');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some(({ address }) => isForbidden(address))) throw new Error('provider_unsafe_endpoint');
}
function isLoopback(host: string): boolean { return host === '127.0.0.1' || host === '::1' || host === '[::1]'; }
function isForbidden(address: string): boolean {
  address = normalizeIp(address);
  if (isLoopback(address)) return true;
  if (address.includes(':')) return address === '::' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd');
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 100 && b >= 64 && b <= 127 || a === 127 || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 0 || b === 168)
    || a === 198 && (b === 18 || b === 19 || b === 51) || a === 203 && b === 0 || a >= 224;
}
function normalizeIp(address: string): string {
  const value = address.replace(/^\[|\]$/g, '').toLowerCase();
  const dotted = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]; if (dotted) return dotted;
  const hex = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return value;
  const packed = (Number.parseInt(hex[1], 16) << 16) + Number.parseInt(hex[2], 16);
  return [24, 16, 8, 0].map((shift) => packed >>> shift & 255).join('.');
}
