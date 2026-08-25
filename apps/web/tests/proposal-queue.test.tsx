import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProposalQueue } from '@/app/dashboard/proposal-queue';
import type { ProposalView } from '@/lib/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const proposals: ProposalView[] = [
  {
    id: 'prop_ok',
    proposedName: 'Facture_Acme_2026-07.pdf',
    destinationPath: '/Comptabilité/2026/Fournisseurs',
    destinationFolderExternalId: 'folder_fournisseurs',
    confidence: 0.96,
    source: 'RULE',
    document: {
      id: 'doc_ok',
      name: 'acme.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1200,
    },
  },
  {
    id: 'prop_retry',
    proposedName: 'Contrat_Nexa_2026.pdf',
    destinationPath: '/Juridique/Contrats',
    destinationFolderExternalId: 'folder_contrats',
    confidence: 0.72,
    source: 'LLM',
    document: {
      id: 'doc_retry',
      name: 'scan-contrat.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1400,
    },
  },
];

afterEach(cleanup);

describe('ProposalQueue', () => {
  it('handles a partial bulk failure and leaves failed rows retryable', async () => {
    const onConfirm = vi.fn((proposalId: string) =>
      proposalId === 'prop_retry' ? Promise.reject(new Error('drive down')) : Promise.resolve(),
    );

    render(
      <ProposalQueue
        initialProposals={proposals}
        onConfirmProposal={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tout valider' }));

    await waitFor(() => expect(screen.getByText(/1 classement réussi, 1 à reprendre/)).toBeDefined());
    expect(screen.queryByText('Facture_Acme_2026-07.pdf')).toBeNull();
    expect(screen.getByTestId('proposal-prop_retry')).toBeDefined();
    expect(screen.getByRole('button', { name: /Réessayer/ })).toBeDefined();
  });

  it('shows an empty success state after all proposals are validated', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <ProposalQueue
        initialProposals={[proposals[0]]}
        onConfirmProposal={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Valider/ }));

    await waitFor(() => expect(screen.getByText('File terminée')).toBeDefined());
    expect(screen.getByText(/Tous les documents proposés ont été classés/)).toBeDefined();
  });

  it('shows a calm empty state when there is nothing to review', () => {
    render(<ProposalQueue initialProposals={[]} />);
    expect(screen.getByText('Rien à valider')).toBeDefined();
  });

  it('excludes review-required proposals from bulk validation', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(
      <ProposalQueue
        initialProposals={[proposals[0], { ...proposals[1], reviewRequired: true, confidence: 0.2, destinationFolderExternalId: null }]}
        onConfirmProposal={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Tout valider' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(onConfirm).toHaveBeenCalledWith('prop_ok', undefined);
    expect(screen.getByText(/faible confiance sont exclues/)).toBeDefined();
  });
});
