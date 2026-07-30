import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import type { DashboardView } from './types';

function apiUrl(): string {
  return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
}

async function sessionTenant(): Promise<string> {
  const session = await getServerSession(authOptions);
  const organizationId = session?.user?.organizationId;
  if (!organizationId) throw new Error('Missing authenticated organization');
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
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

export async function startSync(): Promise<{ enqueued: number; manual: number }> {
  const organizationId = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/sync`, {
    method: 'POST',
    headers: internalHeaders(),
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

export async function confirmProposal(
  proposalId: string,
  overrideDestinationPath?: string,
): Promise<{ executed: boolean; destinationPath: string }> {
  const organizationId = await sessionTenant();
  const response = await fetch(`${apiUrl()}/organizations/${organizationId}/proposals/${proposalId}/confirm`, {
    method: 'POST',
    headers: { ...internalHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(overrideDestinationPath ? { overrideDestinationPath } : {}),
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}
