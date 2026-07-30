export async function startSync(): Promise<unknown> {
  const response = await fetch('/api/sync', { method: 'POST' });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

export async function confirmProposal(
  proposalId: string,
  overrideDestinationPath?: string,
): Promise<{ executed: boolean; destinationPath: string }> {
  const response = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(overrideDestinationPath ? { overrideDestinationPath } : {}),
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}
