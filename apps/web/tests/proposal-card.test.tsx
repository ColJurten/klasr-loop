import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('labels ignore with the exact provider-safety tooltip', () => {
    render(<ProposalCard proposal={proposal} status="idle" onConfirm={vi.fn()} onIgnore={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Ignorer' }).getAttribute('title')).toBe(
      'Ignorer cette proposition — le fichier reste à sa place',
    );
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
    expect(screen.getByRole('dialog', { name: /Éditer la proposition/ })).toBeDefined();
    fireEvent.change(screen.getByLabelText('Dossier de destination'), {
      target: { value: '/Comptabilité/Archives' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith('prop_1', {
        finalName: 'Facture_EDF_2026-03.pdf',
        overrideDestinationPath: '/Comptabilité/Archives',
      }),
    );
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('opens Corriger as the reference-sized correction overlay with the required information and action order', () => {
    render(
      <ProposalCard
        proposal={{ ...proposal, reviewReason: 'Destination non reconnue dans l’arborescence héritée' }}
        folders={[
          { externalId: 'folder_elec', path: '/Comptabilité/Électricité' },
          { externalId: 'folder_social', path: '/Social/2026' },
        ]}
        status="idle"
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Corriger' }));

    const dialog = screen.getByRole('dialog', { name: 'Éditer la proposition' });
    expect(dialog.className).toContain('fixed');
    expect(dialog.className).toContain('w-[min(1120px,92vw)]');
    expect(within(dialog).getAllByText('scan_001.pdf').length).toBeGreaterThan(0);
    expect(within(dialog).getByDisplayValue('Facture_EDF_2026-03.pdf')).toBeDefined();
    expect(within(dialog).getAllByText('Destination non reconnue dans l’arborescence héritée').length).toBeGreaterThan(0);
    expect(within(dialog).getByLabelText('Confiance 92 %, source IA')).toBeDefined();
    expect(Array.from(dialog.querySelectorAll('button')).map((button) => button.textContent?.trim()).filter(Boolean).slice(-3)).toEqual([
      'Restaurer la proposition',
      'Annuler',
      'Valider',
    ]);
    expect(screen.queryByRole('button', { name: 'Enregistrer sans valider' })).toBeNull();
  });

  it('contains keyboard focus, closes with Escape and restores the Corriger trigger', async () => {
    render(<ProposalCard proposal={proposal} folders={[{ externalId: 'folder_elec', path: '/Comptabilité/Électricité' }]} status="idle" onConfirm={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Corriger' });
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Éditer la proposition' });
    const filename = within(dialog).getByLabelText('Nom du fichier proposé');
    await waitFor(() => expect(document.activeElement).toBe(filename));

    const last = within(dialog).getByRole('button', { name: 'Valider' });
    const first = within(dialog).getByRole('button', { name: 'Fermer' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Éditer la proposition' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('lets a missing-destination low-confidence proposal select an inherited folder and validate explicitly', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <ProposalCard
        proposal={{ ...proposal, confidence: 0.2, reviewRequired: true, reviewReason: 'no_destination_match', destinationPath: '', destinationFolderExternalId: null }}
        folders={[{ externalId: 'folder_social', path: '/Social/2026' }]}
        status="idle"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Corriger' }));
    fireEvent.change(screen.getByLabelText('Dossier de destination'), { target: { value: 'folder_social' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('prop_1', {
      finalName: 'Facture_EDF_2026-03.pdf',
      destinationFolderExternalId: 'folder_social',
    }));
  });

  it('retains the edited filename and destination path when no folder catalogue is available', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ProposalCard proposal={proposal} folders={[]} status="idle" onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: 'Corriger' }));
    fireEvent.change(screen.getByLabelText('Nom du fichier proposé'), { target: { value: '  Facture_Corrigee.pdf  ' } });
    fireEvent.change(screen.getByLabelText('Dossier de destination'), { target: { value: ' /Archives/2026 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('prop_1', {
      finalName: 'Facture_Corrigee.pdf',
      overrideDestinationPath: '/Archives/2026',
    }));
  });

  it('exposes an invalid filename as an assertive ink-coloured alert', () => {
    render(<ProposalCard proposal={proposal} folders={[]} status="idle" onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Corriger' }));
    fireEvent.change(screen.getByLabelText('Nom du fichier proposé'), { target: { value: 'bad/name.pdf' } });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('séparateurs de chemin');
    expect(alert.className).toContain('text-ink');
    expect(screen.getByRole('button', { name: 'Valider' })).toHaveProperty('disabled', true);
  });

  it('has no overlay entrance-transition utility because REF-E has no entrance motion', () => {
    render(<ProposalCard proposal={proposal} status="idle" onConfirm={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Corriger' }));

    const overlay = screen.getByTestId('correction-overlay');
    expect(overlay.innerHTML).not.toContain('motion-reduce:transition-none');
  });
});
