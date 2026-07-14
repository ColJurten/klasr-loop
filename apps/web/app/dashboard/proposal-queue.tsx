'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ProposalCard } from '@/components/proposal-card';
import { Button } from '@/components/ui/button';
import { confirmProposal } from '@/lib/api';
import type { ProposalView } from '@/lib/types';

export function ProposalQueue({
  organizationId,
  initialProposals,
}: {
  organizationId: string;
  initialProposals: ProposalView[];
}) {
  const [proposals] = useState(initialProposals);
  const [bulkState, setBulkState] = useState<'idle' | 'running' | 'done'>('idle');

  async function handleConfirm(proposalId: string, overrideDestinationPath?: string) {
    await confirmProposal(organizationId, proposalId, overrideDestinationPath);
  }

  async function handleConfirmAll() {
    if (bulkState !== 'idle') return;
    setBulkState('running');
    for (const proposal of proposals) {
      try {
        await confirmProposal(organizationId, proposal.id);
      } catch {
        // Les échecs restent visibles carte par carte ; on continue la file.
      }
    }
    setBulkState('done');
  }

  if (proposals.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-ink/50">
        Rien à valider. Déposez des documents dans votre Drive, klasr s&apos;occupe du reste.
      </p>
    );
  }

  return (
    <section aria-label="Propositions de classement" className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-ink/60">
          {proposals.length} proposition{proposals.length > 1 ? 's' : ''} en attente
        </p>
        {/* « Un clic suffit » : le bouton Tout valider domine l'écran. */}
        <Button
          variant="validate"
          className="px-6 py-2.5 text-base"
          onClick={() => void handleConfirmAll()}
          disabled={bulkState !== 'idle'}
        >
          {bulkState === 'running'
            ? 'Classement en cours…'
            : bulkState === 'done'
              ? 'File traitée'
              : 'Tout valider'}
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {proposals.map((proposal) => (
          <ProposalCard key={proposal.id} proposal={proposal} onConfirm={handleConfirm} />
        ))}
      </div>
      <p className="flex items-center gap-2 text-xs text-ink/50">
        <ShieldCheck className="h-3.5 w-3.5 text-sage-deep" strokeWidth={1.5} />
        Vos fichiers ne quittent jamais votre Drive — klasr n&apos;exécute que des
        renommages et déplacements que vous avez validés.
      </p>
    </section>
  );
}
