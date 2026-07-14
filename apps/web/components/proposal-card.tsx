'use client';

import { useState } from 'react';
import { ArrowRight, CornerDownRight, FolderPlus } from 'lucide-react';
import { Button } from './ui/button';
import type { ProposalView } from '@/lib/types';

interface ProposalCardProps {
  proposal: ProposalView;
  /** Called exactly once per confirmation; parent executes the API call. */
  onConfirm: (proposalId: string, overrideDestinationPath?: string) => Promise<void>;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  // Pastels fonctionnels : sauge = confiance haute, lavande = moyenne, pêche = à revoir.
  const tone =
    percent >= 90
      ? 'bg-sage text-ink'
      : percent >= 70
        ? 'bg-lavender text-ink'
        : 'bg-peach text-ink';
  return (
    <span className={`rounded-lg px-2 py-0.5 font-mono text-xs ${tone}`}>{percent}%</span>
  );
}

/**
 * Écran critique du produit : une proposition = une ligne, un clic sur
 * « Valider » EXÉCUTE le déplacement/renommage. « Corriger » est le chemin
 * secondaire. Aucune ombre, bordures fines, chemins en JetBrains Mono.
 */
export function ProposalCard({ proposal, onConfirm }: ProposalCardProps) {
  const [state, setState] = useState<'idle' | 'confirming' | 'done' | 'error'>('idle');

  async function handleConfirm(overrideDestinationPath?: string) {
    if (state !== 'idle') return; // pas de double exécution
    setState('confirming');
    try {
      await onConfirm(proposal.id, overrideDestinationPath);
      setState('done');
    } catch {
      setState('error');
    }
  }

  return (
    <div
      data-testid={`proposal-${proposal.id}`}
      className="rounded-xl border border-line bg-white p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <p className="truncate font-mono text-sm text-ink/50">{proposal.document.name}</p>
          <p className="flex items-center gap-2 truncate font-mono text-sm">
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-lavender-deep" strokeWidth={1.5} />
            <span className="truncate">→ {proposal.proposedName}</span>
          </p>
          <p className="flex items-center gap-2 truncate text-sm text-ink/70">
            <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-ink/30" strokeWidth={1.5} />
            <span className="truncate font-mono">{proposal.destinationPath}</span>
            {proposal.isNewFolder && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-peach px-2 py-0.5 text-xs text-ink">
                <FolderPlus className="h-3 w-3" strokeWidth={1.5} />
                nouveau dossier
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ConfidenceBadge confidence={proposal.confidence} />
          {state === 'done' ? (
            <span className="rounded-lg bg-sage px-3 py-1.5 text-sm font-medium text-ink">
              Classé ✓
            </span>
          ) : (
            <>
              <Button
                variant="validate"
                onClick={() => void handleConfirm()}
                disabled={state === 'confirming'}
                aria-label={`Valider le classement de ${proposal.document.name}`}
              >
                {state === 'confirming' ? 'Classement…' : 'Valider'}
              </Button>
              <Button
                variant="secondary"
                disabled={state === 'confirming'}
                onClick={() => {
                  // Correction minimale pour le starter ; remplacée par le
                  // sélecteur d'arborescence dans l'implémentation wireframe.
                  const path = window.prompt('Dossier de destination :', proposal.destinationPath);
                  if (path) void handleConfirm(path);
                }}
              >
                Corriger
              </Button>
            </>
          )}
        </div>
      </div>
      {state === 'error' && (
        <p className="mt-3 rounded-lg bg-peach px-3 py-2 text-sm text-ink">
          Le classement a échoué. Le document reste à sa place — réessayez ou ouvrez
          l&apos;historique pour le détail.
        </p>
      )}
    </div>
  );
}
