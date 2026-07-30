'use client';

import { useEffect, useState } from 'react';
import { FolderCheck, Play, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { launchDriveItem, listReferenceFolders, selectReferenceRoot } from '@/lib/client-api';
import type { DashboardView, DriveInputItemView, FolderChoiceView } from '@/lib/types';

const LOCAL_REFERENCE_ID = 'local_root_cabinet';

export function DriveWorkflow({ data }: { data: DashboardView | null }) {
  const [referenceState, setReferenceState] = useState<'idle' | 'running' | 'error'>('idle');
  const [folderListState, setFolderListState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
  const [referenceFolders, setReferenceFolders] = useState<Array<{ externalId: string; name: string; parentExternalId: string | null }>>([]);
  const [selectedReference, setSelectedReference] = useState('');
  const [launchState, setLaunchState] = useState<'idle' | 'running' | 'error' | 'done'>('idle');
  const [selectedInput, setSelectedInput] = useState(data?.inputItems?.find((item) => item.eligible)?.externalId ?? '');
  const [showReferencePicker, setShowReferencePicker] = useState(() => Boolean(data && data.mode !== 'local' && !data.referenceRoot));
  const productionReferencePicker = Boolean(data && data.mode !== 'local' && showReferencePicker);

  useEffect(() => {
    if (data && data.mode !== 'local' && !data.referenceRoot) {
      setShowReferencePicker(true);
    }
  }, [data]);

  useEffect(() => {
    if (!productionReferencePicker) return;
    let active = true;
    setFolderListState('loading');
    listReferenceFolders()
      .then((folders) => {
        if (!active) return;
        setReferenceFolders(folders);
        setSelectedReference(folders[0]?.externalId ?? '');
        setFolderListState('ready');
      })
      .catch(() => {
        if (!active) return;
        setReferenceFolders([]);
        setSelectedReference('');
        setFolderListState('error');
      });
    return () => {
      active = false;
    };
  }, [productionReferencePicker]);

  async function chooseReference(folderExternalId: string) {
    setReferenceState('running');
    try {
      await selectReferenceRoot(folderExternalId);
      reloadDashboard();
    } catch {
      setReferenceState('error');
    }
  }

  async function launch() {
    if (!selectedInput) return;
    setLaunchState('running');
    try {
      await launchDriveItem(selectedInput);
      setLaunchState('done');
      reloadDashboard();
    } catch {
      setLaunchState('error');
    }
  }

  const folders = data?.folders ?? [];
  const inputItems = data?.inputItems ?? [];

  return (
    <div className="mb-10 space-y-4">
      <section aria-labelledby="reference-title" className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="reference-title" className="flex items-center gap-2 text-sm font-medium">
              <FolderCheck className="h-4 w-4 text-lavender-deep" strokeWidth={1.5} />
              1. Dossier de référence
            </h2>
            <p className="mt-1 text-sm text-ink/65">
              {data?.referenceRoot
                ? data.referenceRoot.name
                : 'Choisissez la racine Drive dont klasr hérite les destinations.'}
            </p>
          </div>
          {data?.mode === 'local' || data?.referenceRoot ? (
            <Button
              type="button"
              variant={data?.referenceRoot ? 'secondary' : 'validate'}
              disabled={!data || referenceState === 'running'}
              onClick={() => {
                if (data?.mode === 'local') {
                  void chooseReference(LOCAL_REFERENCE_ID);
                  return;
                }
                setShowReferencePicker(true);
              }}
            >
              {data?.referenceRoot ? 'Remplacer' : 'Choisir Cabinet de démonstration'}
            </Button>
          ) : null}
        </div>
        {productionReferencePicker && (
          <div className="mt-4" aria-live="polite">
            {folderListState === 'loading' && (
              <p role="status" className="text-sm text-ink/65">Chargement des dossiers Drive...</p>
            )}
            {folderListState === 'error' && (
              <div role="alert" className="rounded-lg border border-peach-deep/30 bg-peach/35 px-3 py-2 text-sm">
                <p>Impossible de charger les dossiers Drive.</p>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-2"
                  onClick={() => {
                    setFolderListState('idle');
                    setTimeout(() => setFolderListState('loading'), 0);
                    listReferenceFolders()
                      .then((folders) => {
                        setReferenceFolders(folders);
                        setSelectedReference(folders[0]?.externalId ?? '');
                        setFolderListState('ready');
                      })
                      .catch(() => setFolderListState('error'));
                  }}
                >
                  Réessayer
                </Button>
              </div>
            )}
            {folderListState === 'ready' && referenceFolders.length === 0 && (
              <p className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink/65">
                Aucun dossier Drive disponible.
              </p>
            )}
            {folderListState === 'ready' && referenceFolders.length > 0 && (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor="reference-folder" className="block text-xs font-medium">
                    Dossier Drive
                  </label>
                  <select
                    id="reference-folder"
                    value={selectedReference}
                    onChange={(event) => setSelectedReference(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                  >
                    {referenceFolders.map((folder) => (
                      <option key={folder.externalId} value={folder.externalId}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  type="button"
                  variant="validate"
                  disabled={!selectedReference || referenceState === 'running'}
                  onClick={() => void chooseReference(selectedReference)}
                >
                  Choisir ce dossier
                </Button>
              </div>
            )}
          </div>
        )}
        {referenceState === 'error' && (
          <p role="alert" className="mt-3 rounded-lg border border-peach-deep/30 bg-peach/35 px-3 py-2 text-sm">
            Impossible de sélectionner le dossier. Réessayez.
          </p>
        )}
      </section>

      <section aria-labelledby="tree-title" className="rounded-lg border border-line bg-white p-4">
        <h2 id="tree-title" className="text-sm font-medium">2. Structure héritée</h2>
        <FolderTree folders={folders} />
      </section>

      <section aria-labelledby="input-title" className="rounded-lg border border-line bg-white p-4">
        <h2 id="input-title" className="text-sm font-medium">3. Fichiers à organiser</h2>
        {inputItems.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">Sélectionnez d&apos;abord un dossier de référence.</p>
        ) : (
          <>
            <label htmlFor="drive-input" className="mt-3 block text-xs font-medium">
              Élément Drive existant
            </label>
            <select
              id="drive-input"
              value={selectedInput}
              onChange={(event) => setSelectedInput(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
            >
              {inputItems.map((item) => (
                <option key={item.externalId} value={item.externalId} disabled={!item.eligible}>
                  {item.type === 'folder' ? 'Dossier' : 'Fichier'} - {item.name}{item.eligible ? '' : ` (${reasonLabel(item)})`}
                </option>
              ))}
            </select>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" variant="validate" disabled={!selectedInput || launchState === 'running'} onClick={() => void launch()}>
                <Play className="mr-1.5 inline h-3.5 w-3.5" strokeWidth={1.5} />
                Lancer l&apos;organisation
              </Button>
              {launchState === 'running' && (
                <span role="status" className="inline-flex items-center gap-2 text-sm text-ink/65">
                  <RefreshCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
                  Analyse en cours
                </span>
              )}
            </div>
          </>
        )}
        {launchState === 'error' && (
          <p role="alert" className="mt-3 rounded-lg border border-peach-deep/30 bg-peach/35 px-3 py-2 text-sm">
            Le lancement a échoué. Les propositions déjà traitées ne sont pas ré-enfilées.
          </p>
        )}
      </section>
    </div>
  );
}

function reloadDashboard(): void {
  if (process.env.NODE_ENV === 'test') return;
  window.location.reload();
}

function FolderTree({ folders }: { folders: FolderChoiceView[] }) {
  if (folders.length === 0) {
    return <p className="mt-2 text-sm text-ink/60">Aucun descendant importé pour le moment.</p>;
  }
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {folders.map((folder) => (
        <li key={folder.externalId} className="font-mono text-ink/75" style={{ paddingLeft: `${Math.max(folder.path.split('/').length - 2, 0) * 1}rem` }}>
          {folder.path}
        </li>
      ))}
    </ul>
  );
}

function reasonLabel(item: DriveInputItemView): string {
  if (item.reason === 'unsupported') return 'non supporté';
  if (item.reason === 'inside-reference-tree') return 'arborescence héritée exclue';
  return 'indisponible';
}
