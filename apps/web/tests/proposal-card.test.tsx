import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProposalCard } from '@/components/proposal-card';
import type { ProposalView } from '@/lib/types';

const proposal: ProposalView = {
  id: 'prop_1',
  proposedName: 'Facture_EDF_2026-03.pdf',
  destinationPath: '/Comptabilité/Électricité',
  destinationFolderExternalId: 'folder_elec',
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
    render(<ProposalCard proposal={proposal} status="idle" onConfirm={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByText('scan_001.pdf')).toBeDefined();
    expect(screen.getByText('→ Facture_EDF_2026-03.pdf')).toBeDefined();
    expect(screen.getByText('/Comptabilité/Électricité')).toBeDefined();
  });

  it('exposes confidence with text and source, not colour alone', () => {
    render(<ProposalCard proposal={proposal} status="idle" onConfirm={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByLabelText('Confiance 92 %, source IA')).toBeDefined();
  });

  it('executes on a SINGLE click of Valider, without override', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ProposalCard proposal={proposal} status="idle" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: /Valider/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('prop_1', undefined);
  });

  it('allows explicit as-is validation when low confidence still has a destination', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ProposalCard
        proposal={{ ...proposal, confidence: 0.2, reviewRequired: true, reviewReason: 'Texte extrait insuffisant' }}
        status="idle"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText('Texte extrait insuffisant')).toBeDefined();
    expect(screen.getByText(/exclue de Tout valider/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Valider le classement/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('prop_1', undefined));
  });

  it('blocks direct validation when the destination is missing', () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ProposalCard
        proposal={{ ...proposal, confidence: 0.2, reviewRequired: true, reviewReason: 'Destination absente', destinationPath: '', destinationFolderExternalId: null }}
        status="idle"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole('button', { name: /Corriger avant validation/ })).toHaveProperty('disabled', true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ignores double clicks (no double execution)', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ProposalCard proposal={proposal} status="confirming" onConfirm={onConfirm} />);
    const button = screen.getByRole('button', { name: /Valider/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('surfaces a failure without pretending the document was classified', async () => {
    render(<ProposalCard proposal={proposal} status="error" onConfirm={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByText(/Le classement a échoué/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Réessayer/ })).toBeDefined();
    expect(screen.queryByText('Classé')).toBeNull();
  });

  it('keeps recoverable retry failures inside the card click boundary', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('confirm failed'));
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);

    try {
      render(<ProposalCard proposal={proposal} status="error" onConfirm={onConfirm} />);

      fireEvent.click(screen.getByRole('button', { name: /Réessayer/ }));

      await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('prop_1', undefined));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).not.toHaveBeenCalled();
      expect(screen.getByText(/Le classement a échoué/)).toBeDefined();
      expect(screen.getByRole('button', { name: /Réessayer/ })).toBeDefined();
      expect(screen.queryByText('Classé')).toBeNull();
    } finally {
      window.removeEventListener('unhandledrejection', unhandled);
    }
  });

  it('uses an in-product correction dialog instead of window.prompt', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const promptSpy = vi.spyOn(window, 'prompt');
    render(<ProposalCard proposal={proposal} status="idle" onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /Corriger/ }));
    expect(screen.getByRole('dialog', { name: /Corriger la destination/ })).toBeDefined();
    fireEvent.change(screen.getByLabelText('Dossier de destination'), {
      target: { value: '/Comptabilité/Archives' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Confirmer la correction/ }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith('prop_1', '/Comptabilité/Archives'),
    );
    expect(promptSpy).not.toHaveBeenCalled();
  });
});
