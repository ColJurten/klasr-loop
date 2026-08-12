'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, CornerDownRight, FolderPlus, RotateCcw, X } from 'lucide-react';
import { Button } from './ui/button';
import type { FolderChoiceView, ProposalView } from '@/lib/types';

export type ProposalStatus = 'idle' | 'confirming' | 'done' | 'error';

interface ProposalCardProps {
  proposal: ProposalView;
  folders: FolderChoiceView[];
  status: ProposalStatus;
  /** Called exactly once per confirmation; parent executes the API call. */
  onConfirm: (proposalId: string, options?: string | { finalName?: string; destinationFolderExternalId?: string }) => Promise<void>;
  onReject?: (proposalId: string) => Promise<void>;
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
  return <span className={`rounded-lg px-2 py-0.5 font-mono text-xs ${tone}`}>{percent}%</span>;
}

function sourceLabel(source: ProposalView['source']): string {
  return source === 'RULE' ? 'règle' : 'IA';
}

/**
 * Écran critique du produit : une proposition = une ligne, un clic sur
 * « Valider » EXÉCUTE le déplacement/renommage. « Corriger » est le chemin
 * secondaire. Aucune ombre, bordures fines, chemins en JetBrains Mono.
 */
export function ProposalCard({ proposal, folders = [], status, onConfirm, onReject }: ProposalCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [finalName, setFinalName] = useState(proposal.proposedName);
  const [destinationFolderExternalId, setDestinationFolderExternalId] = useState(
    proposal.destinationFolderExternalId ?? folders.find((folder) => folder.path === proposal.destinationPath)?.externalId ?? '',
  );
  const percent = Math.round(proposal.confidence * 100);
  const isBusy = status === 'confirming';
  const isDone = status === 'done';
  const needsReview = proposal.reviewRequired || proposal.confidence < 0.7 || !proposal.destinationFolderExternalId;
  const canValidateAsIs = Boolean(proposal.destinationFolderExternalId || proposal.destinationPath);

  const filenameError = validateFilename(finalName);
  const selectedFolder = folders.find((folder) => folder.externalId === destinationFolderExternalId);

  async function handleConfirm(options?: string | { finalName?: string; destinationFolderExternalId?: string }) {
    if (isBusy || isDone) return;
    await onConfirm(proposal.id, options);
    setDialogOpen(false);
  }

  function handleUserConfirm(options?: string | { finalName?: string; destinationFolderExternalId?: string }) {
    void handleConfirm(options).catch(() => {
      // The parent owns the visible error state; this click boundary only prevents
      // expected retry failures from escaping as unhandled browser rejections.
    });
  }

  return (
    <div
      data-testid={`proposal-${proposal.id}`}
      className="rounded-lg border border-line bg-white p-4"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-1.5">
          <p className="truncate font-mono text-sm text-ink/60">{proposal.document.name}</p>
          <p className="flex items-center gap-2 truncate font-mono text-sm">
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-lavender-deep" strokeWidth={1.5} />
            <span className="truncate">→ {proposal.proposedName}</span>
          </p>
          <p className="flex items-center gap-2 truncate text-sm text-ink/70">
            <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-ink/60" strokeWidth={1.5} />
            <span className="truncate font-mono">{proposal.destinationPath || 'Destination à corriger'}</span>
            {proposal.isNewFolder && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-peach px-2 py-0.5 text-xs text-ink">
                <FolderPlus className="h-3 w-3" strokeWidth={1.5} />
                nouveau dossier
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
          <span
            className="inline-flex items-center gap-2"
            aria-label={`Confiance ${percent} %, source ${sourceLabel(proposal.source)}`}
          >
            <ConfidenceBadge confidence={proposal.confidence} />
            <span className="text-xs text-ink/60">{sourceLabel(proposal.source)}</span>
          </span>
          {needsReview && (
            <span className="inline-flex items-center gap-1 rounded-lg bg-peach px-2 py-1 text-xs text-ink">
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.5} />
              à vérifier
            </span>
          )}
          {isDone ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-sage px-3 py-1.5 text-sm font-medium text-ink">
              <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
              Classé
            </span>
          ) : (
            <>
              <Button
                variant="validate"
                onClick={() => handleUserConfirm()}
                disabled={isBusy || !canValidateAsIs}
                aria-label={
                  !canValidateAsIs
                    ? `Corriger avant validation de ${proposal.document.name}`
                    : status === 'error'
                    ? `Réessayer le classement de ${proposal.document.name}`
                    : `Valider le classement de ${proposal.document.name}`
                }
              >
                {isBusy ? 'Classement...' : status === 'error' ? 'Réessayer' : 'Valider'}
              </Button>
              <Button
                variant="secondary"
                disabled={isBusy}
                onClick={() => setDialogOpen(true)}
              >
                Corriger
              </Button>
              <Button
                variant="ghost"
                disabled={isBusy}
                onClick={() => void onReject?.(proposal.id)}
              >
                Retirer
              </Button>
            </>
          )}
        </div>
      </div>
      {status === 'error' && (
        <div className="mt-3 rounded-lg border border-peach-deep/30 bg-peach/35 px-3 py-2 text-sm text-ink">
          <p>Le classement a échoué. Le document reste à sa place.</p>
          <p className="mt-1 text-xs text-ink/60">
            Réessayez après correction ou conservez la proposition dans la file.
          </p>
        </div>
      )}
      {needsReview && (
        <div className="mt-3 rounded-lg border border-peach-deep/30 bg-peach/35 px-3 py-2 text-sm text-ink">
          <p>{proposal.reviewReason ?? 'Vérifiez le nom et choisissez une destination avant validation.'}</p>
          <p className="mt-1 text-xs text-ink/60">
            Cette proposition est exclue de Tout valider, mais peut être validée seule après vérification.
          </p>
        </div>
      )}

      {dialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`correction-title-${proposal.id}`}
          className="mt-4 rounded-lg border border-line bg-paper p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id={`correction-title-${proposal.id}`} className="text-sm font-medium">
                Corriger la destination
              </h2>
              <p className="mt-1 text-xs text-ink/60">
                La correction ne sera appliquée qu&apos;après validation explicite.
              </p>
            </div>
            <button
              type="button"
              className="rounded-lg p-1.5 text-ink/60 hover:text-ink"
              aria-label="Fermer la correction"
              onClick={() => setDialogOpen(false)}
            >
              <X className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>

          <label htmlFor={`filename-${proposal.id}`} className="mt-4 block text-xs font-medium">
            Nom final
          </label>
          <input
            id={`filename-${proposal.id}`}
            value={finalName}
            onChange={(event) => setFinalName(event.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm text-ink"
            aria-invalid={Boolean(filenameError)}
            aria-describedby={filenameError ? `filename-error-${proposal.id}` : undefined}
          />
          {filenameError && (
            <p id={`filename-error-${proposal.id}`} role="alert" className="mt-1 text-xs text-peach-deep">
              {filenameError}
            </p>
          )}

          <label htmlFor={`destination-${proposal.id}`} className="mt-4 block text-xs font-medium">
            Dossier de destination
          </label>
          {folders.length > 0 ? (
            <select
              id={`destination-${proposal.id}`}
              value={destinationFolderExternalId}
              onChange={(event) => setDestinationFolderExternalId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm text-ink"
            >
              {folders.map((folder) => (
                <option key={folder.externalId} value={folder.externalId}>
                  {folder.path}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`destination-${proposal.id}`}
              value={destinationFolderExternalId || proposal.destinationPath}
              onChange={(event) => setDestinationFolderExternalId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm text-ink"
            />
          )}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setFinalName(proposal.proposedName);
                setDestinationFolderExternalId(proposal.destinationFolderExternalId ?? folders.find((folder) => folder.path === proposal.destinationPath)?.externalId ?? '');
              }}
            >
              <RotateCcw className="mr-1.5 inline h-3.5 w-3.5" strokeWidth={1.5} />
              Réinitialiser
            </Button>
            <Button
              type="button"
              variant="validate"
              disabled={isBusy || Boolean(filenameError) || (folders.length > 0 && !selectedFolder)}
              onClick={() => handleUserConfirm(
                selectedFolder
                  ? { finalName: finalName.trim(), destinationFolderExternalId }
                  : destinationFolderExternalId || proposal.destinationPath,
              )}
            >
              Confirmer la correction
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function validateFilename(value: string): string | null {
  const name = value.trim();
  if (name.length === 0) return 'Le nom ne peut pas être vide.';
  if (name === '.' || name === '..' || name.includes('..')) return 'Les traversées de chemin sont interdites.';
  if (name.includes('/') || name.includes('\\')) return 'Les séparateurs de chemin sont interdits.';
  if (hasControlCharacter(name)) return 'Les caractères de contrôle sont interdits.';
  return null;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
}
