import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProposalCard } from '@/components/proposal-card';
import type { ProposalView } from '@/lib/types';

const proposal: ProposalView = {
  id: 'prop_1',
  proposedName: 'Facture_EDF_2026-03.pdf',
  destinationPath: '/Comptabilité/Électricité',
  confidence: 0.92,
  source: 'LLM',
  document: {
    id: 'doc_1',
    name: 'scan_001.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1200,
  },
};

afterEach(cleanup);

describe('ProposalCard — single-click confirmation flow', () => {
  it('shows the proposal (current name, proposed name, destination)', () => {
    render(<ProposalCard proposal={proposal} onConfirm={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByText('scan_001.pdf')).toBeDefined();
    expect(screen.getByText('→ Facture_EDF_2026-03.pdf')).toBeDefined();
    expect(screen.getByText('/Comptabilité/Électricité')).toBeDefined();
  });

  it('executes on a SINGLE click of Valider, without override', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ProposalCard proposal={proposal} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /Valider/ }));
    await waitFor(() => expect(screen.getByText('Classé ✓')).toBeDefined());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('prop_1', undefined);
  });

  it('ignores double clicks (no double execution)', async () => {
    let release: () => void = () => undefined;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    render(<ProposalCard proposal={proposal} onConfirm={onConfirm} />);
    const button = screen.getByRole('button', { name: /Valider/ });
    fireEvent.click(button);
    fireEvent.click(button);
    release();
    await waitFor(() => expect(screen.getByText('Classé ✓')).toBeDefined());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failure without pretending the document was classified', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('drive down'));
    render(<ProposalCard proposal={proposal} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /Valider/ }));
    await waitFor(() => expect(screen.getByText(/Le classement a échoué/)).toBeDefined());
    expect(screen.queryByText('Classé ✓')).toBeNull();
  });
});
