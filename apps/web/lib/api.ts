import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import type { DashboardView, DriveInputItemView, FolderChoiceView } from './types';

export class ApiUpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function apiUrl(): string {
  return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
}

async function sessionTenant(): Promise<{ organizationId: string; userId: string }> {
  const session = await getServerSession(authOptions);
  const organizationId = session?.user?.organizationId;
  const userId = session?.user?.userId;
  if (!organizationId || !userId) throw new ApiUpstreamError('Missing authenticated tenant identity', 401);
  return { organizationId, userId };
}

async function sessionIdentity(): Promise<{ organizationId: string; userId: string; membershipId: string }> {
  const session = await getServerSession(authOptions);
  const { organizationId, userId, membershipId } = session?.user ?? {};
  if (!organizationId || !userId || !membershipId) throw new ApiUpstreamError('Missing authenticated tenant identity', 401);
  return { organizationId, userId, membershipId };
}

export async function getLocalPasswordEligibility(): Promise<{ eligible: boolean }> {
  return localPasswordRequest('GET');
}

export async function enrollLocalPassword(password: string): Promise<{ enrolled: true }> {
  return localPasswordRequest('POST', { password });
}

async function localPasswordRequest(method: 'GET' | 'POST', body?: { password: string }) {
  const { organizationId, userId, membershipId } = await sessionIdentity();
  const response = await fetch(`${apiUrl()}/auth/local-password`, {
    method,
    headers: { ...internalHeaders(userId), 'x-organization-id': organizationId, 'x-membership-id': membershipId, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  await assertOk(response);
  return response.json();
}

export interface LlmSettingsInput { provider: 'anthropic' | 'openai' | 'mistral' | 'openai-compatible'; apiKey: string; model?: string; baseUrl?: string; }
export async function getLlmSettings() { return llmRequest(''); }
export async function discoverLlmModels(input: LlmSettingsInput) { return llmRequest('/models', 'POST', input); }
export async function saveLlmSettings(input: LlmSettingsInput) { return llmRequest('', 'PUT', input); }
export async function deleteLlmSettings() { return llmRequest('', 'DELETE'); }
async function llmRequest(path: string, method = 'GET', body?: LlmSettingsInput) {
  const { organizationId, userId } = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/llm-settings${path}`, {
    method, headers: { ...internalHeaders(userId), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  });
  await assertOk(response);
  return response.json();
}

function internalHeaders(userId?: string): HeadersInit {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) throw new Error('Missing INTERNAL_API_SECRET');
  return { 'x-internal-secret': secret, ...(userId ? { 'x-user-id': userId } : {}) };
}

export async function getDashboardData(): Promise<DashboardView> {
  const { organizationId, userId } = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/dashboard`, {
    headers: internalHeaders(userId),
    cache: 'no-store',
  });
  await assertOk(response);
  return response.json();
}

export async function startSync(): Promise<{ enqueued: number; manual: number }> {
  const { organizationId, userId } = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/sync`, {
    method: 'POST',
    headers: internalHeaders(userId),
  });
  await assertOk(response);
  return response.json();
}

export async function listReferenceFolders(): Promise<Array<{ externalId: string; name: string; parentExternalId: string | null }>> {
  const { organizationId, userId } = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/drive/reference-folders`, {
    headers: internalHeaders(userId),
    cache: 'no-store',
  });
  await assertOk(response);
  return response.json();
}

export async function selectReferenceRoot(folderExternalId: string): Promise<{ folders: FolderChoiceView[] }> {
  const { organizationId, userId } = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/drive/reference-root`, {
    method: 'POST',
    headers: { ...internalHeaders(userId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderExternalId }),
  });
  await assertOk(response);
  return response.json();
}

export async function listInputItems(): Promise<DriveInputItemView[]> {
  const { organizationId, userId } = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/drive/input-items`, {
    headers: internalHeaders(userId),
    cache: 'no-store',
  });
  await assertOk(response);
  return response.json();
}

export async function listDriveItems(parentId = 'root', pageToken?: string): Promise<{ items: DriveInputItemView[]; nextPageToken: string | null }> {
  const { organizationId, userId } = await sessionTenant();
  const search = new URLSearchParams({ parentId });
  if (pageToken) search.set('pageToken', pageToken);
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/drive/items?${search}`, {
    headers: internalHeaders(userId), cache: 'no-store',
  });
  await assertOk(response);
  return response.json();
}

export async function launchDriveItem(itemExternalId: string): Promise<{ enqueued: number; manual: number }> {
  const { organizationId, userId } = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/drive/launch`, {
    method: 'POST',
    headers: { ...internalHeaders(userId), 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemExternalId }),
  });
  await assertOk(response);
  return response.json();
}

export async function confirmProposal(
  proposalId: string,
  options?: string | { finalName?: string; destinationFolderExternalId?: string; overrideDestinationPath?: string },
): Promise<{ executed: boolean; destinationPath: string }> {
  const { organizationId, userId } = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/proposals/${proposalId}/confirm`, {
    method: 'POST',
    headers: { ...internalHeaders(userId), 'Content-Type': 'application/json' },
    body: JSON.stringify(typeof options === 'string' ? { overrideDestinationPath: options } : options ?? {}),
  });
  await assertOk(response);
  return response.json();
}

export async function ignoreProposal(proposalId: string): Promise<{ ignored: true }> {
  const { organizationId, userId } = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/proposals/${proposalId}/ignore`, {
    method: 'POST',
    headers: internalHeaders(userId),
  });
  await assertOk(response);
  return response.json();
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  throw new ApiUpstreamError(await responseErrorMessage(response), response.status);
}

/** Untrusted upstream error bodies are read up to this many characters, then discarded. */
const MAX_ERROR_BODY_CHARS = 16_384;
/** A surfaced upstream message must stay short enough to be a UI label, never a payload. */
const MAX_ERROR_MESSAGE_CHARS = 300;

/**
 * Extract a single bounded, human-readable string from an upstream error body.
 * Accepts `{ message: string }`, `{ error: string }` and the nested Nest shape
 * `{ message: { code, message } }`. Anything else — arrays, numbers, deeper
 * nesting, control characters, oversized or malformed bodies — falls back to a
 * generic status message so no upstream payload can reach the browser.
 */
export async function responseErrorMessage(response: Response): Promise<string> {
  const generic = `API error ${response.status}`;
  let raw: string;
  try {
    raw = await response.text();
  } catch {
    return generic;
  }
  if (!raw || raw.length > MAX_ERROR_BODY_CHARS) return generic;
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return generic;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return generic;
  const record = body as Record<string, unknown>;
  return boundedMessage(record.message) ?? boundedMessage(record.error) ?? generic;
}

function boundedMessage(value: unknown): string | null {
  if (typeof value === 'string') return boundedText(value);
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return boundedText((value as Record<string, unknown>).message);
  }
  return null;
}

function boundedText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ERROR_MESSAGE_CHARS) return null;
  return hasControlCharacter(trimmed) ? null : trimmed;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
