import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriveWorkflow } from '@/app/dashboard/drive-workflow';
import type { DashboardView } from '@/lib/types';

const clientApi = vi.hoisted(() => ({
  launchDriveItem: vi.fn(),
  listReferenceFolders: vi.fn(),
  selectReferenceRoot: vi.fn(),
}));

vi.mock('@/lib/client-api', () => clientApi);

const baseDashboard: DashboardView = {
  mode: 'production',
  connection: {
    provider: 'GOOGLE_DRIVE',
    connectedAt: '2026-07-30T00:00:00.000Z',
    lastSyncAt: null,
  },
  metrics: { pending: 0, analyzing: 0, classified: 0, documentsIn: 0, ruleMatches: 0, llmCalls: 0, ocrRuns: 0 },
  queue: { queued: 0, ready: 0, active: 0, failed: 0, inlineWorker: false, consuming: false },
  referenceRoot: null,
  folders: [],
  inputItems: [],
  proposals: [],
  history: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DriveWorkflow reference picker', () => {
  it('loads real guarded Drive folders in production and lets the user choose one', async () => {
    clientApi.listReferenceFolders.mockResolvedValueOnce([
      { externalId: 'folder_real_a', name: 'Cabinet Dupont', parentExternalId: null },
      { externalId: 'folder_real_b', name: 'Cabinet Martin', parentExternalId: null },
    ]);
    clientApi.selectReferenceRoot.mockResolvedValueOnce({});

    render(<DriveWorkflow data={baseDashboard} />);

    expect(screen.queryByRole('button', { name: /cabinet de démonstration/i })).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/chargement/i);
    const picker = await screen.findByLabelText(/dossier drive/i);
    fireEvent.change(picker, { target: { value: 'folder_real_b' } });
    fireEvent.click(screen.getByRole('button', { name: /choisir ce dossier/i }));

    await waitFor(() => {
      expect(clientApi.selectReferenceRoot).toHaveBeenCalledWith('folder_real_b');
    });
  });

  it('keeps the deterministic one-click option only in local mode', () => {
    render(<DriveWorkflow data={{ ...baseDashboard, mode: 'local', connection: null }} />);

    expect(screen.getByRole('button', { name: /cabinet de démonstration/i })).toBeDefined();
    expect(clientApi.listReferenceFolders).not.toHaveBeenCalled();
  });

  it('opens the real picker to replace an existing production reference root', async () => {
    clientApi.listReferenceFolders.mockResolvedValueOnce([
      { externalId: 'folder_current', name: 'Cabinet actuel', parentExternalId: null },
      { externalId: 'folder_next', name: 'Cabinet suivant', parentExternalId: null },
    ]);
    clientApi.selectReferenceRoot.mockResolvedValueOnce({});

    render(
      <DriveWorkflow
        data={{
          ...baseDashboard,
          referenceRoot: { externalId: 'folder_current', name: 'Cabinet actuel' },
          folders: [
            {
              externalId: 'child_current',
              name: 'Achats',
              path: '/Cabinet actuel/Achats',
              parentExternalId: 'folder_current',
              inherited: true,
              holding: false,
            },
          ],
        }}
      />,
    );

    expect(screen.queryByLabelText(/dossier drive/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /remplacer/i }));

    const picker = await screen.findByLabelText(/dossier drive/i);
    fireEvent.change(picker, { target: { value: 'folder_next' } });
    fireEvent.click(screen.getByRole('button', { name: /choisir ce dossier/i }));

    await waitFor(() => {
      expect(clientApi.selectReferenceRoot).toHaveBeenCalledWith('folder_next');
    });
    expect(clientApi.selectReferenceRoot).not.toHaveBeenCalledWith('folder_current');
  });

  it('announces an empty production folder list', async () => {
    clientApi.listReferenceFolders.mockResolvedValueOnce([]);

    render(<DriveWorkflow data={baseDashboard} />);

    expect(await screen.findByText(/aucun dossier drive disponible/i)).toBeDefined();
  });

  it('announces production folder loading errors', async () => {
    clientApi.listReferenceFolders.mockRejectedValueOnce(new Error('drive unavailable'));

    render(<DriveWorkflow data={baseDashboard} />);

    expect((await screen.findByRole('alert')).textContent).toMatch(/impossible de charger les dossiers drive/i);
  });
});
