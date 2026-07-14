import type { ProposalView } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

/**
 * Typed API client. organizationId will come from the NextAuth session once
 * auth lands (backlog #1) — NEVER from arbitrary client input.
 */
export async function fetchPendingProposals(organizationId: string): Promise<ProposalView[]> {
  const response = await fetch(`${API_URL}/organizations/${organizationId}/proposals`, {
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

export async function confirmProposal(
  organizationId: string,
  proposalId: string,
  overrideDestinationPath?: string,
): Promise<{ executed: boolean; destinationPath: string }> {
  const response = await fetch(
    `${API_URL}/organizations/${organizationId}/proposals/${proposalId}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(overrideDestinationPath ? { overrideDestinationPath } : {}),
    },
  );
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}
