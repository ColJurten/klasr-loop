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

async function sessionTenant(): Promise<string> {
  const session = await getServerSession(authOptions);
  const organizationId = session?.user?.organizationId;
  if (!organizationId) throw new ApiUpstreamError('Missing authenticated organization', 401);
  return organizationId;
}

function internalHeaders(): HeadersInit {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) throw new Error('Missing INTERNAL_API_SECRET');
  return { 'x-internal-secret': secret };
}

export async function getDashboardData(): Promise<DashboardView> {
  const organizationId = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/dashboard`, {
    headers: internalHeaders(),
    cache: 'no-store',
  });
  await assertOk(response);
  return response.json();
}

export async function startSync(): Promise<{ enqueued: number; manual: number }> {
  const organizationId = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/sync`, {
    method: 'POST',
    headers: internalHeaders(),
  });
  await assertOk(response);
  return response.json();
}

export async function listReferenceFolders(): Promise<Array<{ externalId: string; name: string; parentExternalId: string | null }>> {
  const organizationId = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/drive/reference-folders`, {
    headers: internalHeaders(),
    cache: 'no-store',
  });
  await assertOk(response);
  return response.json();
}

export async function selectReferenceRoot(folderExternalId: string): Promise<{ folders: FolderChoiceView[] }> {
  const organizationId = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/drive/reference-root`, {
    method: 'POST',
    headers: { ...internalHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderExternalId }),
  });
  await assertOk(response);
  return response.json();
}

export async function listInputItems(): Promise<DriveInputItemView[]> {
  const organizationId = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/drive/input-items`, {
    headers: internalHeaders(),
    cache: 'no-store',
  });
  await assertOk(response);
  return response.json();
}

export async function launchDriveItem(itemExternalId: string): Promise<{ enqueued: number; manual: number }> {
  const organizationId = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/drive/launch`, {
    method: 'POST',
    headers: { ...internalHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemExternalId }),
  });
  await assertOk(response);
  return response.json();
}

export async function confirmProposal(
  proposalId: string,
  options?: string | { finalName?: string; destinationFolderExternalId?: string; overrideDestinationPath?: string },
): Promise<{ executed: boolean; destinationPath: string }> {
  const organizationId = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/proposals/${proposalId}/confirm`, {
    method: 'POST',
    headers: { ...internalHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(typeof options === 'string' ? { overrideDestinationPath: options } : options ?? {}),
  });
  await assertOk(response);
  return response.json();
}

export async function rejectProposal(proposalId: string): Promise<{ executed: boolean; destinationPath: string }> {
  const organizationId = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/proposals/${proposalId}/reject`, {
    method: 'POST',
    headers: internalHeaders(),
  });
  await assertOk(response);
  return response.json();
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  throw new ApiUpstreamError(await responseErrorMessage(response), response.status);
}

async function responseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: unknown; error?: unknown };
    const message = typeof body.message === 'string' ? body.message : body.error;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join(', ');
  } catch {
    // Fall through to the generic status message.
  }
  return `API error ${response.status}`;
}
