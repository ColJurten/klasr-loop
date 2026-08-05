import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriveWorkflow } from '@/app/dashboard/drive-workflow';
import type { DashboardView } from '@/lib/types';

const clientApi = vi.hoisted(() => ({ launchDriveItem: vi.fn(), listDriveItems: vi.fn(), selectReferenceRoot: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/lib/client-api', () => clientApi);
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const baseDashboard: DashboardView = {
  mode: 'production', connection: { provider: 'GOOGLE_DRIVE', connectedAt: '2026-07-30T00:00:00.000Z', lastSyncAt: null },
  metrics: { pending: 0, analyzing: 0, classified: 0, outcomes: 0, documentsIn: 0, ruleMatches: 0, llmCalls: 0, ocrRuns: 0 },
  queue: { queued: 0, ready: 0, active: 0, failed: 0, inlineWorker: false, consuming: false },
  analysisFailures: 0,
  referenceRoot: null, folders: [], inputItems: [], proposals: [], history: [],
};

const rootItems = [
  { externalId: 'folder_real', name: 'stg_tree', parentExternalId: null, mimeType: 'application/vnd.google-apps.folder', type: 'folder' as const, supported: true, eligible: true },
  { externalId: 'pdf_real', name: 'document-test.pdf', parentExternalId: null, mimeType: 'application/pdf', type: 'file' as const, supported: true, eligible: true },
  { externalId: 'xlsx_real', name: 'tableur-test.xlsx', parentExternalId: null, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', type: 'file' as const, supported: false, eligible: false, reason: 'unsupported' },
];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('DriveWorkflow production browser', () => {
  it('navigates folders and selects the reference root', async () => {
    clientApi.listDriveItems.mockResolvedValue({
      items: rootItems.map((item) => item.type === 'folder' ? { ...item, eligible: false, reason: 'reference-required' } : item),
      nextPageToken: null,
    });
    clientApi.selectReferenceRoot.mockResolvedValue({});
    render(<DriveWorkflow data={baseDashboard} />);
    expect(await screen.findByText('stg_tree')).toBeDefined();
    fireEvent.click(screen.getAllByLabelText(/sélectionner/i)[0]);
    fireEvent.click(screen.getByRole('button', { name: /choisir ce dossier/i }));
    await waitFor(() => expect(clientApi.selectReferenceRoot).toHaveBeenCalledWith('folder_real'));
  });

  it('shows a root PDF, marks XLSX unsupported, and launches the selected PDF', async () => {
    clientApi.listDriveItems.mockResolvedValue({ items: rootItems, nextPageToken: null });
    clientApi.launchDriveItem.mockResolvedValue({ enqueued: 1, manual: 0 });
    render(<DriveWorkflow data={{ ...baseDashboard, referenceRoot: { externalId: 'folder_real', name: 'stg_tree' } }} />);
    expect(await screen.findByText('document-test.pdf')).toBeDefined();
    expect(screen.getByText('Non supporté')).toBeDefined();
    const choices = screen.getAllByLabelText(/sélectionner/i);
    fireEvent.click(choices.find((choice) => (choice as HTMLInputElement).value === 'pdf_real')!);
    fireEvent.click(screen.getByRole('button', { name: /lancer l'organisation/i }));
    await waitFor(() => expect(clientApi.launchDriveItem).toHaveBeenCalledWith('pdf_real'));
    expect(clientApi.launchDriveItem).not.toHaveBeenCalledWith('xlsx_real');
  });

  it('keeps visible progress and refreshes autonomously until an async proposal arrives', async () => {
    clientApi.listDriveItems.mockResolvedValue({ items: rootItems, nextPageToken: null });
    clientApi.launchDriveItem.mockResolvedValue({ enqueued: 2, manual: 0 });
    const data = { ...baseDashboard, referenceRoot: { externalId: 'folder_real', name: 'stg_tree' } };
    const view = render(<DriveWorkflow data={data} />);
    await vi.waitFor(() => expect(screen.getByText('document-test.pdf')).toBeDefined());
    fireEvent.click(screen.getAllByLabelText(/sélectionner/i).find((choice) => (choice as HTMLInputElement).value === 'pdf_real')!);
    fireEvent.click(screen.getByRole('button', { name: /lancer l'organisation/i }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/analyse en cours/i));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    const firstProposal = {
      id: 'proposal-1', proposedName: 'document-test.pdf', destinationPath: '/Alpha',
      destinationFolderExternalId: 'alpha', confidence: 0.2, source: 'LLM',
      document: { id: 'doc-1', name: 'document-test.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
    } as const;
    view.rerender(<DriveWorkflow data={{ ...data, metrics: { ...data.metrics, outcomes: 1 }, proposals: [firstProposal] }} />);
    expect(screen.getByRole('status')).toBeDefined();
    view.rerender(<DriveWorkflow data={{ ...data, metrics: { ...data.metrics, outcomes: 2 }, proposals: [firstProposal, { ...firstProposal, id: 'proposal-2' }] }} />);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('completes after reviewing the first of two results before the second arrives', async () => {
    clientApi.listDriveItems.mockResolvedValue({ items: rootItems, nextPageToken: null });
    clientApi.launchDriveItem.mockResolvedValue({ enqueued: 2, manual: 0 });
    const data = { ...baseDashboard, referenceRoot: { externalId: 'folder_real', name: 'stg_tree' } };
    const view = render(<DriveWorkflow data={data} />);
    await screen.findByText('document-test.pdf');
    fireEvent.click(screen.getAllByLabelText(/sélectionner/i).find((choice) => (choice as HTMLInputElement).value === 'pdf_real')!);
    fireEvent.click(screen.getByRole('button', { name: /lancer l'organisation/i }));
    view.rerender(<DriveWorkflow data={{ ...data, metrics: { ...data.metrics, outcomes: 1 }, proposals: [] }} />);
    expect(screen.getByRole('status')).toBeDefined();
    view.rerender(<DriveWorkflow data={{ ...data, metrics: { ...data.metrics, outcomes: 2 }, proposals: [] }} />);
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('button', { name: /lancer l'organisation/i })).not.toHaveProperty('disabled', true);
  });

  it('stops polling and shows the requested tenant analysis failure', async () => {
    clientApi.listDriveItems.mockResolvedValue({ items: rootItems, nextPageToken: null });
    clientApi.launchDriveItem.mockResolvedValue({ enqueued: 1, manual: 0 });
    const data = { ...baseDashboard, referenceRoot: { externalId: 'folder_real', name: 'stg_tree' } };
    const view = render(<DriveWorkflow data={data} />);
    await screen.findByText('document-test.pdf');
    fireEvent.click(screen.getAllByLabelText(/sélectionner/i).find((choice) => (choice as HTMLInputElement).value === 'pdf_real')!);
    fireEvent.click(screen.getByRole('button', { name: /lancer l'organisation/i }));
    view.rerender(<DriveWorkflow data={{ ...data, analysisFailures: 1 }} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/analyse a échoué/i);
  });

  it('bounds polling by wall clock even while refreshed dashboard data changes', async () => {
    clientApi.listDriveItems.mockResolvedValue({ items: rootItems, nextPageToken: null });
    clientApi.launchDriveItem.mockResolvedValue({ enqueued: 1, manual: 0 });
    const data = { ...baseDashboard, referenceRoot: { externalId: 'folder_real', name: 'stg_tree' } };
    const view = render(<DriveWorkflow data={data} />);
    await screen.findByText('document-test.pdf');
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getAllByLabelText(/sélectionner/i).find((choice) => (choice as HTMLInputElement).value === 'pdf_real')!);
      fireEvent.click(screen.getByRole('button', { name: /lancer l'organisation/i }));
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByRole('status')).toBeDefined();
      act(() => vi.advanceTimersByTime(20_000));
      view.rerender(<DriveWorkflow data={{ ...data, metrics: { ...data.metrics, analyzing: 1 } }} />);
      view.rerender(<DriveWorkflow data={{ ...data, metrics: { ...data.metrics, analyzing: 1, documentsIn: 1 } }} />);
      act(() => vi.advanceTimersByTime(10_001));
      expect(screen.getByRole('alert').textContent).toMatch(/analyse a échoué/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait for an already-terminal manual item', async () => {
    clientApi.listDriveItems.mockResolvedValue({ items: rootItems, nextPageToken: null });
    clientApi.launchDriveItem.mockResolvedValue({ enqueued: 0, manual: 1 });
    const data = { ...baseDashboard, referenceRoot: { externalId: 'folder_real', name: 'stg_tree' } };
    render(<DriveWorkflow data={data} />);
    await screen.findByText('document-test.pdf');
    fireEvent.click(screen.getAllByLabelText(/sélectionner/i).find((choice) => (choice as HTMLInputElement).value === 'pdf_real')!);
    fireEvent.click(screen.getByRole('button', { name: /lancer l'organisation/i }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('button', { name: /lancer l'organisation/i })).not.toHaveProperty('disabled', true);
  });

  it('shows empty and retryable provider-error states', async () => {
    clientApi.listDriveItems.mockRejectedValueOnce(new Error('provider')).mockResolvedValueOnce({ items: [], nextPageToken: null });
    render(<DriveWorkflow data={baseDashboard} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/autorisation a expiré/i);
    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(await screen.findByText(/ce dossier est vide/i)).toBeDefined();
  });

  it('keeps the deterministic one-click option only in local mode', () => {
    render(<DriveWorkflow data={{ ...baseDashboard, mode: 'local', connection: null }} />);
    expect(screen.getByRole('button', { name: /cabinet de démonstration/i })).toBeDefined();
    expect(clientApi.listDriveItems).not.toHaveBeenCalled();
  });
});
