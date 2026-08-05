export async function startSync(): Promise<unknown> {
  const response = await fetch('/api/sync', { method: 'POST' });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

export async function selectReferenceRoot(folderExternalId: string): Promise<unknown> {
  const response = await fetch('/api/drive/reference-root', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderExternalId }),
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

export async function listReferenceFolders(): Promise<Array<{ externalId: string; name: string; parentExternalId: string | null }>> {
  const response = await fetch('/api/drive/reference-folders');
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

export async function listDriveItems(parentId = 'root', pageToken?: string) {
  const search = new URLSearchParams({ parentId });
  if (pageToken) search.set('pageToken', pageToken);
  const response = await fetch(`/api/drive/items?${search}`);
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json() as Promise<{ items: import('./types').DriveInputItemView[]; nextPageToken: string | null }>;
}

export async function launchDriveItem(itemExternalId: string): Promise<unknown> {
  const response = await fetch('/api/drive/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemExternalId }),
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

export async function confirmProposal(
  proposalId: string,
  options?: string | { finalName?: string; destinationFolderExternalId?: string; overrideDestinationPath?: string },
): Promise<{ executed: boolean; destinationPath: string }> {
  const response = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(typeof options === 'string' ? { overrideDestinationPath: options } : options ?? {}),
  });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}

export async function rejectProposal(proposalId: string): Promise<{ executed: boolean; destinationPath: string }> {
  const response = await fetch(`/api/proposals/${encodeURIComponent(proposalId)}/reject`, { method: 'POST' });
  if (!response.ok) throw new Error(`API error ${response.status}`);
  return response.json();
}
