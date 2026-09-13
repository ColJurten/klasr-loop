'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Folder, FolderCheck, Play, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { launchDriveItem, listDriveItems, selectReferenceRoot } from '@/lib/client-api';
import type { DashboardView, DriveInputItemView, FolderChoiceView } from '@/lib/types';

const LOCAL_REFERENCE_ID = 'local_root_cabinet';
const PRODUCTION_INPUT_SELECTION_KEY = 'klasr-drive-input-selection';
const PRODUCTION_LAUNCH_KEY = 'klasr-drive-launch';
type DrivePath = Array<{ id: string; name: string }>;
type DriveSelection = { selected: string; path: DrivePath };
type LaunchSnapshot = { state: 'running' | 'done'; baseline: { outcomes: number; failures: number }; target: number | null; startedAt: number };

export function DriveWorkflow({ data, llmConfigured = true }: { data: DashboardView | null; llmConfigured?: boolean }) {
  const router = useRouter();
  const [referenceState, setReferenceState] = useState<'idle' | 'running' | 'error'>('idle');
  const [launchState, setLaunchState] = useState<'idle' | 'running' | 'error' | 'done'>('idle');
  const [launchBaseline, setLaunchBaseline] = useState({ outcomes: 0, failures: 0 });
  const [launchTarget, setLaunchTarget] = useState<number | null>(null);
  const [launchStartedAt, setLaunchStartedAt] = useState<number | null>(null);
  const [selectedInput, setSelectedInput] = useState(data?.inputItems?.find((item) => item.eligible)?.externalId ?? '');
  const [restoredInputPath, setRestoredInputPath] = useState<DrivePath | null>(null);
  const [showReferencePicker, setShowReferencePicker] = useState(() => Boolean(data && data.mode !== 'local' && !data.referenceRoot));
  const productionReferencePicker = Boolean(data && data.mode !== 'local' && showReferencePicker);

  useEffect(() => {
    const selection = savedProductionInputSelection();
    if (selection) {
      setSelectedInput(selection.selected);
      setRestoredInputPath(selection.path);
    }
    const launch = savedProductionLaunch();
    if (!launch) return;
    if (Date.now() - launch.startedAt >= 30_000) {
      clearProductionLaunch();
      setLaunchState('error');
      return;
    }
    if (launch.state === 'done' && launch.target !== null && (data?.metrics.outcomes ?? 0) >= launch.target) {
      clearProductionLaunch();
      return;
    }
    if ((data?.analysisFailures ?? 0) > launch.baseline.failures) {
      clearProductionLaunch();
      setLaunchState('error');
      return;
    }
    setLaunchBaseline(launch.baseline);
    setLaunchTarget(launch.target);
    setLaunchStartedAt(launch.startedAt);
    setLaunchState(launch.state);
  }, []);

  useEffect(() => {
    if (data && data.mode !== 'local' && !data.referenceRoot) {
      setShowReferencePicker(true);
    }
  }, [data]);

  useEffect(() => {
    if (launchState !== 'done') return;
    if (launchTarget !== null && (data?.metrics.outcomes ?? 0) >= launchTarget) {
      clearProductionLaunch();
      setLaunchState('idle');
      setLaunchStartedAt(null);
      return;
    }
    if ((data?.analysisFailures ?? 0) > launchBaseline.failures) {
      clearProductionLaunch();
      setLaunchState('error');
      setLaunchStartedAt(null);
    }
  }, [data, launchBaseline.failures, launchState, launchTarget]);

  useEffect(() => {
    if (launchState !== 'running' && launchState !== 'done') return;
    if (launchStartedAt === null) return;
    const remaining = 30_000 - (Date.now() - launchStartedAt);
    if (remaining <= 0) {
      clearProductionLaunch();
      setLaunchState('error');
      setLaunchStartedAt(null);
      return;
    }
    const interval = window.setInterval(() => router.refresh(), 1_000);
    const timeout = window.setTimeout(() => {
      clearProductionLaunch();
      setLaunchState('error');
      setLaunchStartedAt(null);
    }, remaining);
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [launchStartedAt, launchState, router]);

  function selectInput(itemExternalId: string, path?: DrivePath) {
    setSelectedInput(itemExternalId);
    if (path) saveProductionInputSelection({ selected: itemExternalId, path });
  }

  function clearInputSelection() {
    setSelectedInput('');
    clearProductionInputSelection();
  }

  async function chooseReference(folderExternalId: string) {
    setReferenceState('running');
    try {
      await selectReferenceRoot(folderExternalId);
      router.refresh();
    } catch {
      setReferenceState('error');
    }
  }

  async function launch() {
    if (!selectedInput) return;
    await launchSelectedItem(selectedInput);
  }

  async function launchSelectedItem(itemExternalId: string) {
    const baseline = { outcomes: data?.metrics.outcomes ?? 0, failures: data?.analysisFailures ?? 0 };
    const startedAt = Date.now();
    setLaunchBaseline(baseline);
    setLaunchTarget(null);
    setLaunchStartedAt(startedAt);
    setLaunchState('running');
    saveProductionLaunch({ state: 'running', baseline, target: null, startedAt });
    try {
      const result = await launchDriveItem(itemExternalId);
      const target = baseline.outcomes + result.enqueued;
      setLaunchTarget(target);
      if (result.enqueued > 0) {
        setLaunchState('done');
        saveProductionLaunch({ state: 'done', baseline, target, startedAt });
      } else {
        setLaunchState('idle');
        setLaunchStartedAt(null);
        clearProductionLaunch();
      }
      router.refresh();
    } catch {
      clearProductionLaunch();
      setLaunchState('error');
      setLaunchStartedAt(null);
    }
  }

  async function launchItem(itemExternalId: string) {
    selectInput(itemExternalId);
    await launchSelectedItem(itemExternalId);
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
        {productionReferencePicker && <DriveBrowser mode="folder" busy={referenceState === 'running'} onChoose={(item) => void chooseReference(item.externalId)} />}
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
        {!data?.referenceRoot ? (
          <p className="mt-2 text-sm text-ink/60">Sélectionnez d&apos;abord un dossier de référence.</p>
        ) : data.mode !== 'local' ? (
          <DriveBrowser mode="input" busy={launchState === 'running' || launchState === 'done' || !llmConfigured} describedBy={!llmConfigured ? 'llm-launch-help' : undefined} selected={selectedInput} initialPath={restoredInputPath ?? undefined} onSelect={selectInput} onStaleSelection={clearInputSelection} onChoose={(item) => void launchItem(item.externalId)} />
        ) : inputItems.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">Aucun fichier disponible.</p>
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
              <Button type="button" variant="validate" aria-describedby={!llmConfigured ? 'llm-launch-help' : undefined} disabled={!llmConfigured || !selectedInput || launchState === 'running' || launchState === 'done'} onClick={() => void launch()}>
                <Play className="mr-1.5 inline h-3.5 w-3.5" strokeWidth={1.5} />
                Lancer l&apos;organisation
              </Button>
            </div>
          </>
        )}
        {!llmConfigured && <p id="llm-launch-help" role="tooltip" className="mt-3 text-sm text-ink/70">L&apos;analyse est bloquée : configurez et validez une clé LLM.</p>}
        {(launchState === 'running' || launchState === 'done') && (
          <p role="status" className="mt-3 inline-flex items-center gap-2 text-sm text-ink/65">
            <RefreshCcw className="h-3.5 w-3.5" strokeWidth={1.5} />
            Analyse en cours
          </p>
        )}
        {launchState === 'error' && (
          <p role="alert" className="mt-3 rounded-lg border border-peach-deep/30 bg-peach/35 px-3 py-2 text-sm">
            L&apos;analyse a échoué. Vérifiez la connexion Drive puis relancez ce fichier. Aucun contenu documentaire n&apos;a été conservé.
          </p>
        )}
      </section>
    </div>
  );
}

function DriveBrowser({ mode, busy, describedBy, selected: selectedProp, initialPath, onSelect, onStaleSelection, onChoose }: { mode: 'folder' | 'input'; busy: boolean; describedBy?: string; selected?: string; initialPath?: DrivePath; onSelect?: (itemExternalId: string, path: DrivePath) => void; onStaleSelection?: () => void; onChoose: (item: DriveInputItemView) => void }) {
  const [path, setPath] = useState<DrivePath>([{ id: 'root', name: 'Mon Drive' }]);
  const [items, setItems] = useState<DriveInputItemView[]>([]);
  const [localSelected, setLocalSelected] = useState('');
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadedParent, setLoadedParent] = useState('');
  const parent = path[path.length - 1];
  const selected = selectedProp ?? localSelected;

  function load(parentId: string, pageToken?: string, append = false) {
    setState('loading');
    listDriveItems(parentId, pageToken)
      .then((page) => {
        setItems((current) => append ? [...current, ...page.items] : page.items);
        setNextPageToken(page.nextPageToken);
        if (!onSelect) setLocalSelected('');
        setLoadedParent(parentId);
        setState('ready');
      })
      .catch(() => setState('error'));
  }

  useEffect(() => {
    if (initialPath?.length) setPath(initialPath);
  }, [initialPath]);
  useEffect(() => { load(parent.id); }, [parent.id]);
  useEffect(() => {
    if (state === 'ready' && loadedParent === parent.id && selected && onStaleSelection && !items.some((item) => item.externalId === selected)) {
      onStaleSelection();
    }
  }, [items, loadedParent, onStaleSelection, parent.id, selected, state]);
  const chosen = items.find((item) => item.externalId === selected);

  return (
    <div className="mt-4 rounded-lg border border-line bg-paper p-3" aria-live="polite">
      <nav aria-label="Chemin Drive" className="mb-3 flex flex-wrap items-center gap-1 text-xs">
        {path.map((entry, index) => (
          <button key={entry.id} type="button" className="rounded px-2 py-1 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2" onClick={() => setPath(path.slice(0, index + 1))}>
            {index > 0 && <span aria-hidden="true">/ </span>}{entry.name}
          </button>
        ))}
      </nav>
      {path.length > 1 && <Button type="button" variant="secondary" className="mb-3" onClick={() => setPath(path.slice(0, -1))}><ChevronLeft className="mr-1 h-4 w-4" />Retour</Button>}
      {state === 'loading' && <p role="status" className="text-sm text-ink/65">Chargement du dossier Drive…</p>}
      {state === 'error' && <div role="alert" className="rounded-lg border border-peach-deep/30 bg-peach/35 p-3 text-sm"><p>Drive est indisponible ou l’autorisation a expiré.</p><Button type="button" variant="secondary" className="mt-2" onClick={() => load(parent.id)}>Réessayer</Button></div>}
      {state === 'ready' && items.length === 0 && <p className="text-sm text-ink/60">Ce dossier est vide.</p>}
      {state === 'ready' && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((item) => {
            const selectable = mode === 'folder'
              ? item.type === 'folder' && (item.eligible || item.reason === 'reference-required')
              : item.eligible;
            return <li key={item.externalId} className="flex min-h-11 flex-col gap-2 rounded-lg border border-line bg-white p-2 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" disabled={item.type !== 'folder'} onClick={() => setPath([...path, { id: item.externalId, name: item.name }])} className="min-w-0 text-left font-mono text-sm disabled:cursor-default">
                {item.type === 'folder' && <Folder className="mr-2 inline h-4 w-4 text-lavender-deep" />}{item.name}
                {!item.supported && <span className="ml-2 rounded bg-peach px-2 py-0.5 font-sans text-xs">Non supporté</span>}
              </button>
              {selectable && <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="radio" name={`drive-${mode}`} value={item.externalId} checked={selected === item.externalId} onChange={() => onSelect ? onSelect(item.externalId, path) : setLocalSelected(item.externalId)} />Sélectionner</label>}
            </li>;
          })}
        </ul>
      )}
      {nextPageToken && <Button type="button" variant="secondary" className="mt-3" disabled={state === 'loading'} onClick={() => load(parent.id, nextPageToken, true)}>Afficher la suite</Button>}
      <Button type="button" variant="validate" className="mt-3 w-full sm:w-auto" aria-describedby={describedBy} disabled={!chosen || busy} onClick={() => chosen && onChoose(chosen)}>
        {mode === 'folder' ? 'Choisir ce dossier' : <><Play className="mr-1.5 h-3.5 w-3.5" />Lancer l&apos;organisation</>}
      </Button>
    </div>
  );
}

function savedProductionInputSelection(): DriveSelection | null {
  const value = readSessionJson<unknown>(PRODUCTION_INPUT_SELECTION_KEY);
  if (value === null) return null;
  if (isDriveSelection(value)) return value;
  clearProductionInputSelection();
  return null;
}

function saveProductionInputSelection(selection: DriveSelection) {
  writeSessionJson(PRODUCTION_INPUT_SELECTION_KEY, selection);
}

function clearProductionInputSelection() {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(PRODUCTION_INPUT_SELECTION_KEY);
}

function savedProductionLaunch(): LaunchSnapshot | null {
  const value = readSessionJson<unknown>(PRODUCTION_LAUNCH_KEY);
  if (value === null) return null;
  if (isLaunchSnapshot(value)) return value;
  clearProductionLaunch();
  return null;
}

function saveProductionLaunch(snapshot: LaunchSnapshot) {
  writeSessionJson(PRODUCTION_LAUNCH_KEY, snapshot);
}

function clearProductionLaunch() {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(PRODUCTION_LAUNCH_KEY);
}

function readSessionJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  const value = window.sessionStorage.getItem(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

function writeSessionJson(key: string, value: unknown) {
  if (typeof window !== 'undefined') window.sessionStorage.setItem(key, JSON.stringify(value));
}

function isDriveSelection(value: unknown): value is DriveSelection {
  return Boolean(
    value && typeof value === 'object'
    && typeof (value as DriveSelection).selected === 'string'
    && Array.isArray((value as DriveSelection).path)
    && (value as DriveSelection).path.length > 0
    && (value as DriveSelection).path.every((entry) => entry && typeof entry.id === 'string' && typeof entry.name === 'string'),
  );
}

function isLaunchSnapshot(value: unknown): value is LaunchSnapshot {
  const snapshot = value as LaunchSnapshot;
  return Boolean(
    snapshot && typeof snapshot === 'object'
    && (snapshot.state === 'running' || snapshot.state === 'done')
    && snapshot.baseline && typeof snapshot.baseline.outcomes === 'number' && typeof snapshot.baseline.failures === 'number'
    && (typeof snapshot.target === 'number' || snapshot.target === null)
    && typeof snapshot.startedAt === 'number',
  );
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
  if (item.reason === 'reference-root') return 'racine de référence exclue';
  return 'indisponible';
}
