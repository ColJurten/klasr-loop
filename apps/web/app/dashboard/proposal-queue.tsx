'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { ProposalCard, type ProposalStatus } from '@/components/proposal-card';
import { Button } from '@/components/ui/button';
import { confirmProposal, ignoreProposal } from '@/lib/client-api';
import type { FolderChoiceView, ProposalView } from '@/lib/types';

type ConfirmProposalHandler = (
  proposalId: string,
  options?: string | { finalName?: string; destinationFolderExternalId?: string; overrideDestinationPath?: string },
) => Promise<unknown>;

type IgnoreProposalHandler = (proposalId: string) => Promise<unknown>;

export function ProposalQueue({
  initialProposals,
  folders = [],
  onConfirmProposal = confirmProposal,
  onIgnoreProposal = ignoreProposal,
}: {
  initialProposals: ProposalView[];
  folders: FolderChoiceView[];
  onConfirmProposal?: ConfirmProposalHandler;
  onIgnoreProposal?: IgnoreProposalHandler;
}) {
  const router = useRouter();
  const [statuses, setStatuses] = useState<Record<string, ProposalStatus>>({});
  const [bulkState, setBulkState] = useState<'idle' | 'running' | 'done' | 'partial'>('idle');

  const visibleProposals = initialProposals.filter((proposal) => statuses[proposal.id] !== 'done');
  const doneCount = initialProposals.length - visibleProposals.length;

  function getStatus(proposalId: string): ProposalStatus {
    return statuses[proposalId] ?? 'idle';
  }

  async function handleConfirm(proposalId: string, options?: string | { finalName?: string; destinationFolderExternalId?: string; overrideDestinationPath?: string }) {
    const currentStatus = getStatus(proposalId);
    if (currentStatus === 'confirming' || currentStatus === 'done') return;

    setStatuses((current) => ({ ...current, [proposalId]: 'confirming' }));
    try {
      await onConfirmProposal(proposalId, options);
      setStatuses((current) => ({ ...current, [proposalId]: 'done' }));
      router.refresh();
    } catch {
      setStatuses((current) => ({ ...current, [proposalId]: 'error' }));
      throw new Error('confirm failed');
    }
  }

  async function handleIgnore(proposalId: string) {
    const currentStatus = getStatus(proposalId);
    if (currentStatus === 'confirming' || currentStatus === 'done') return;
    setStatuses((current) => ({ ...current, [proposalId]: 'confirming' }));
    try {
      await onIgnoreProposal(proposalId);
      setStatuses((current) => ({ ...current, [proposalId]: 'done' }));
      router.refresh();
    } catch {
      setStatuses((current) => ({ ...current, [proposalId]: 'error' }));
    }
  }

  async function handleConfirmAll() {
    if (bulkState === 'running') return;
    const pendingProposals = initialProposals.filter((proposal) => {
      const status = getStatus(proposal.id);
      return status !== 'done' && status !== 'confirming' && isBulkEligible(proposal);
    });

    if (pendingProposals.length === 0) return;

    setBulkState('running');
    let failed = 0;
    for (const proposal of pendingProposals) {
      try {
        await handleConfirm(proposal.id);
      } catch {
        failed += 1;
      }
    }
    setBulkState(failed > 0 ? 'partial' : 'done');
  }

  if (initialProposals.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-line p-10 text-center">
        <h2 className="font-medium">Rien à valider</h2>
        <p className="mt-2 text-sm text-ink/60">
          Déposez des documents dans votre Drive, klasr s&apos;occupe du reste.
        </p>
      </section>
    );
  }

  if (visibleProposals.length === 0) {
    return (
      <section className="rounded-lg border border-sage-deep/25 bg-sage/25 p-8 text-center">
        <CheckCircle2 className="mx-auto h-6 w-6 text-sage-deep" strokeWidth={1.5} />
        <h2 className="mt-3 font-medium">File terminée</h2>
        <p className="mt-2 text-sm text-ink/65">
          Tous les documents proposés ont été classés après validation explicite.
        </p>
      </section>
    );
  }

  const bulkLabel =
    bulkState === 'running'
      ? 'Classement en cours...'
      : bulkState === 'done'
        ? 'File traitée'
        : 'Tout valider';

  return (
    <section aria-label="Propositions de classement" className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink/60">
          {visibleProposals.length} proposition{visibleProposals.length > 1 ? 's' : ''} à valider
        </p>
        <Button
          variant="validate"
          className="w-full px-6 py-2.5 text-base sm:w-auto"
          onClick={() => void handleConfirmAll()}
          disabled={bulkState === 'running' || visibleProposals.every((proposal) => !isBulkEligible(proposal))}
        >
          {bulkLabel}
        </Button>
      </div>
      {visibleProposals.some((proposal) => !isBulkEligible(proposal)) && (
        <p role="status" className="rounded-lg border border-peach-deep/30 bg-peach/35 px-3 py-2 text-sm">
          Les propositions à faible confiance sont exclues de Tout valider et restent validables une par une.
        </p>
      )}
      {bulkState === 'partial' && (
        <p role="status" className="rounded-lg border border-peach-deep/30 bg-peach/35 px-3 py-2 text-sm">
          {doneCount} classement{doneCount > 1 ? 's' : ''} réussi{doneCount > 1 ? 's' : ''},{' '}
          {visibleProposals.length} à reprendre.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {visibleProposals.map((proposal) => (
          <ProposalCard
            key={proposal.id}
            proposal={proposal}
            folders={folders}
            status={getStatus(proposal.id)}
            onConfirm={handleConfirm}
            onIgnore={handleIgnore}
          />
        ))}
      </div>
      <p className="flex items-center gap-2 text-xs text-ink/60">
        <ShieldCheck className="h-3.5 w-3.5 text-sage-deep" strokeWidth={1.5} />
        Les octets sont streamés depuis le Drive vers l&apos;OCR puis jetés. Klasr ne
        persiste jamais le contenu documentaire et n&apos;exécute aucun renommage ou
        déplacement sans validation explicite.
      </p>
    </section>
  );
}

function isBulkEligible(proposal: ProposalView): boolean {
  return !proposal.reviewRequired && proposal.confidence >= 0.7 && Boolean(proposal.destinationFolderExternalId);
}
