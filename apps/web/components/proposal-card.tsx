'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowRight, Check, CornerDownRight, FileText, Folder, FolderPlus, RotateCcw, X } from 'lucide-react';
import { Button } from './ui/button';
import type { FolderChoiceView, ProposalView } from '@/lib/types';

export type ProposalStatus = 'idle' | 'confirming' | 'done' | 'error';

interface ProposalCardProps {
  proposal: ProposalView;
  folders: FolderChoiceView[];
  status: ProposalStatus;
  /** Called exactly once per confirmation; parent executes the API call. */
  onConfirm: (proposalId: string, options?: string | { finalName?: string; destinationFolderExternalId?: string; overrideDestinationPath?: string }) => Promise<void>;
  onIgnore?: (proposalId: string) => Promise<void>;
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
export function ProposalCard({ proposal, folders = [], status, onConfirm, onIgnore }: ProposalCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [finalName, setFinalName] = useState(proposal.proposedName);
  const [destinationFolderExternalId, setDestinationFolderExternalId] = useState(
    proposal.destinationFolderExternalId ?? folders.find((folder) => folder.path === proposal.destinationPath)?.externalId ?? '',
  );
  const correctionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const filenameRef = useRef<HTMLInputElement>(null);
  const percent = Math.round(proposal.confidence * 100);
  const isBusy = status === 'confirming';
  const isDone = status === 'done';
  const needsReview = proposal.reviewRequired || proposal.confidence < 0.7 || !proposal.destinationFolderExternalId;
  const canValidateAsIs = Boolean(proposal.destinationFolderExternalId || proposal.destinationPath);

  const filenameError = validateFilename(finalName);
  const selectedFolder = folders.find((folder) => folder.externalId === destinationFolderExternalId);

  function resetCorrection() {
    setFinalName(proposal.proposedName);
    setDestinationFolderExternalId(
      proposal.destinationFolderExternalId ?? folders.find((folder) => folder.path === proposal.destinationPath)?.externalId ?? '',
    );
  }

  function openCorrection() {
    resetCorrection();
    setDialogOpen(true);
  }

  function closeCorrection() {
    setDialogOpen(false);
  }

  useEffect(() => {
    if (!dialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const outsideElements = Array.from(document.body.children).filter((element) => !element.contains(dialogRef.current));
    const outsideState = outsideElements.map((element) => ({
      element: element as HTMLElement,
      inert: (element as HTMLElement).inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    }));
    outsideState.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    });
    filenameRef.current?.focus();

    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCorrection();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    function keepFocusInside(event: FocusEvent) {
      if (dialogRef.current && event.target instanceof Node && !dialogRef.current.contains(event.target)) {
        filenameRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('focusin', keepFocusInside);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('focusin', keepFocusInside);
      outsideState.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', ariaHidden);
      });
      correctionTriggerRef.current?.focus();
    };
  }, [dialogOpen]);

  async function handleConfirm(options?: string | { finalName?: string; destinationFolderExternalId?: string; overrideDestinationPath?: string }) {
    if (isBusy || isDone) return;
    await onConfirm(proposal.id, options);
    setDialogOpen(false);
  }

  function handleUserConfirm(options?: string | { finalName?: string; destinationFolderExternalId?: string; overrideDestinationPath?: string }) {
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
                onClick={(event) => {
                  correctionTriggerRef.current = event.currentTarget;
                  openCorrection();
                }}
              >
                Corriger
              </Button>
              <span className="group relative">
                <Button
                  variant="ghost"
                  disabled={isBusy}
                  onClick={() => void onIgnore?.(proposal.id)}
                  title="Ignorer cette proposition — le fichier reste à sa place"
                >
                  Ignorer
                </Button>
                <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-10 mt-1 w-64 rounded-lg bg-ink px-2 py-1 text-xs text-paper opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                  Ignorer cette proposition — le fichier reste à sa place
                </span>
              </span>
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

      {dialogOpen && createPortal(
        <div className="fixed inset-0 z-40" data-testid="correction-overlay">
          <button
            type="button"
            aria-label="Fermer la correction par l’arrière-plan"
            className="absolute inset-0 h-full w-full cursor-default bg-ink/45"
            onClick={closeCorrection}
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`correction-title-${proposal.id}`}
            aria-describedby={`correction-help-${proposal.id}`}
            className="fixed inset-y-0 right-0 z-50 grid w-[min(1120px,92vw)] grid-cols-1 overflow-hidden border-l border-line bg-paper lg:grid-cols-[1.05fr_1fr]"
          >
            <section className="hidden min-h-0 flex-col border-r border-line bg-paper lg:flex">
              <header className="border-b border-line px-7 py-5">
                <p className="font-mono text-[11px] uppercase tracking-wider text-ink/60">Document original</p>
                <p className="mt-1 font-mono text-sm">{proposal.document.name}</p>
              </header>
              <div className="flex flex-1 flex-col justify-center p-7">
                <div className="rounded-lg border border-line bg-white p-7 text-center">
                  <FileText className="mx-auto h-10 w-10 text-lavender-deep" strokeWidth={1.5} />
                  <p className="mt-4 break-all font-mono text-sm">{proposal.document.name}</p>
                  <p className="mt-2 text-xs text-ink/70">Aucun contenu du document n’est conservé ni affiché.</p>
                </div>
                <div className="mt-6 rounded-lg border border-peach-deep/30 bg-peach/35 p-4">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-ink/60">Motif de l’analyse</p>
                  <p className="mt-2 text-sm">{proposal.reviewReason ?? 'La proposition peut être ajustée avant sa validation explicite.'}</p>
                </div>
              </div>
            </section>

            <section className="flex min-h-0 flex-col bg-paper">
              <header className="flex items-start justify-between border-b border-line px-8 py-5">
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-wider text-ink/60">Proposition Klasr</span>
                    <span aria-label={`Confiance ${percent} %, source ${sourceLabel(proposal.source)}`}>
                      <ConfidenceBadge confidence={proposal.confidence} />
                    </span>
                  </div>
                  <h2 id={`correction-title-${proposal.id}`} className="text-[22px] font-medium tracking-tight">Éditer la proposition</h2>
                </div>
                <button type="button" className="rounded-lg p-2 text-ink/70 hover:text-ink" aria-label="Fermer" onClick={closeCorrection}>
                  <X className="h-5 w-5" strokeWidth={1.5} />
                </button>
              </header>

              <div className="flex-1 space-y-7 overflow-y-auto px-8 py-7">
                <p id={`correction-help-${proposal.id}`} className="rounded-lg border border-sage-deep/30 bg-sage/20 p-3 text-sm">
                  Rien ne sera renommé ni déplacé avant votre validation explicite.
                </p>
                <div>
                  <label htmlFor={`filename-${proposal.id}`} className="mb-2 block font-mono text-xs uppercase tracking-wider text-ink/70">Nom du fichier proposé</label>
                  <input
                    ref={filenameRef}
                    id={`filename-${proposal.id}`}
                    value={finalName}
                    onChange={(event) => setFinalName(event.target.value)}
                    className="w-full rounded-lg border border-line bg-white px-4 py-3 font-mono text-sm text-ink"
                    aria-invalid={Boolean(filenameError)}
                    aria-describedby={filenameError ? `filename-error-${proposal.id}` : undefined}
                  />
                  {filenameError && <p id={`filename-error-${proposal.id}`} role="alert" className="mt-1 text-xs text-ink">{filenameError}</p>}
                </div>

                <div>
                  <label htmlFor={`destination-${proposal.id}`} className="mb-2 block font-mono text-xs uppercase tracking-wider text-ink/70">Dossier de destination</label>
                  <div className="mb-3 flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2.5 font-mono text-sm">
                    <Folder className="h-4 w-4 shrink-0 text-lavender-deep" strokeWidth={1.5} />
                    {selectedFolder?.path || destinationFolderExternalId || proposal.destinationPath || 'Choisissez un dossier hérité'}
                  </div>
                  {folders.length > 0 ? (
                    <select id={`destination-${proposal.id}`} value={destinationFolderExternalId} onChange={(event) => setDestinationFolderExternalId(event.target.value)} className="w-full rounded-lg border border-line bg-white px-4 py-3 font-mono text-sm text-ink">
                      <option value="" disabled>Choisissez dans l’arborescence héritée</option>
                      {folders.map((folder) => <option key={folder.externalId} value={folder.externalId}>{folder.path}</option>)}
                    </select>
                  ) : (
                    <input id={`destination-${proposal.id}`} value={destinationFolderExternalId || proposal.destinationPath} onChange={(event) => setDestinationFolderExternalId(event.target.value)} className="w-full rounded-lg border border-line bg-white px-4 py-3 font-mono text-sm text-ink" />
                  )}
                  <p className="mt-2 text-xs text-ink/70">Seuls les dossiers de l’arborescence héritée sont acceptés.</p>
                </div>

                <div className="rounded-lg border border-peach-deep/30 bg-peach/35 p-4 lg:hidden">
                  <p className="font-mono text-[11px] uppercase tracking-wider text-ink/60">Motif de l’analyse</p>
                  <p className="mt-2 text-sm">{proposal.reviewReason ?? 'La proposition peut être ajustée avant sa validation explicite.'}</p>
                </div>
              </div>

              <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line bg-paper px-8 py-5">
                <button type="button" className="inline-flex items-center gap-1.5 rounded text-sm text-ink/70 hover:text-ink" onClick={resetCorrection}>
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Restaurer la proposition
                </button>
                <div className="flex items-center gap-3">
                  <Button type="button" variant="secondary" onClick={closeCorrection}>Annuler</Button>
                  <Button
                    type="button"
                    variant="validate"
                    disabled={isBusy || Boolean(filenameError) || (folders.length > 0 && !selectedFolder)}
                    onClick={() => handleUserConfirm(selectedFolder
                      ? { finalName: finalName.trim(), destinationFolderExternalId }
                      : { finalName: finalName.trim(), overrideDestinationPath: (destinationFolderExternalId || proposal.destinationPath).trim() })}
                  >
                    Valider
                  </Button>
                </div>
              </footer>
            </section>
          </div>
        </div>,
        document.body,
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
