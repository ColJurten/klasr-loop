'use client';

import Link from 'next/link';
import { useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  Database,
  FolderTree,
  ShieldCheck,
} from 'lucide-react';
import { KlasrLogo } from '@/components/logo';
import { ProposalQueue } from '@/app/dashboard/proposal-queue';
import type { FolderChoiceView, ProposalView } from '@/lib/types';

const DEMO_ORGANIZATION_ID = 'org_demo_local';

const DEMO_PROPOSALS: ProposalView[] = [
  {
    id: 'prop_demo_1',
    proposedName: 'Facture_AWS_2026-07.pdf',
    destinationPath: '/Comptabilité/2026/Cloud',
    destinationFolderExternalId: 'demo_folder_cloud',
    confidence: 0.94,
    source: 'LLM',
    document: {
      id: 'doc_demo_1',
      name: 'facture (12).pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_248_000,
    },
  },
  {
    id: 'prop_demo_2',
    proposedName: 'Releve_BanquePopulaire_2026-06.pdf',
    destinationPath: '/Banque/Relevés/2026',
    destinationFolderExternalId: 'demo_folder_banque',
    confidence: 0.97,
    source: 'RULE',
    document: {
      id: 'doc_demo_2',
      name: 'scan0231.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 640_000,
    },
  },
  {
    id: 'prop_demo_3',
    proposedName: 'Avenant_Nexa_Maintenance_2026.docx',
    destinationPath: '/Juridique/Contrats/2026',
    destinationFolderExternalId: 'demo_folder_juridique',
    confidence: 0.68,
    source: 'LLM',
    isNewFolder: true,
    document: {
      id: 'doc_demo_3',
      name: 'document sans titre.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 450_000,
    },
  },
  {
    id: 'prop_demo_retry',
    proposedName: 'Facture_Orange_2026-07.pdf',
    destinationPath: '/Comptabilité/2026/Télécom',
    destinationFolderExternalId: 'demo_folder_telecom',
    confidence: 0.82,
    source: 'LLM',
    document: {
      id: 'doc_demo_4',
      name: 'orange juillet.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 720_000,
    },
  },
];

const DEMO_FOLDERS: FolderChoiceView[] = [
  { externalId: 'demo_folder_cloud', name: 'Cloud', parentExternalId: null, path: '/Comptabilité/2026/Cloud' },
  { externalId: 'demo_folder_telecom', name: 'Télécom', parentExternalId: null, path: '/Comptabilité/2026/Télécom' },
  { externalId: 'demo_folder_banque', name: '2026', parentExternalId: null, path: '/Banque/Relevés/2026' },
  { externalId: 'demo_folder_juridique', name: '2026', parentExternalId: null, path: '/Juridique/Contrats/2026' },
];

const ACTIVITY = [
  {
    label: 'Facture EDF classée',
    detail: '/Comptabilité/2026/Électricité',
    time: '09:42',
    status: 'Validé par Camille',
  },
  {
    label: 'Contrat bail proposé',
    detail: '/Juridique/Baux',
    time: '09:18',
    status: 'Correction de dossier',
  },
  {
    label: 'Relevé Crédit Mutuel archivé',
    detail: '/Banque/Relevés/2026',
    time: '08:55',
    status: 'Règle bancaire',
  },
];

const METRICS = [
  { label: 'À valider', value: '4' },
  { label: 'Classés cette semaine', value: '86' },
  { label: 'Sans contenu stocké', value: '100 %' },
];

export function DemoWorkspace() {
  const failedOnce = useRef(new Set<string>());

  async function confirmDemoProposal(
    proposalId: string,
    _options?: string | { finalName?: string; destinationFolderExternalId?: string },
  ) {
    await new Promise((resolve) => setTimeout(resolve, 180));
    if (proposalId === 'prop_demo_retry' && !failedOnce.current.has(proposalId)) {
      failedOnce.current.add(proposalId);
      throw new Error('simulated connector timeout');
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-4">
          <Link href="/" aria-label="Accueil klasr">
            <KlasrLogo />
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="rounded-lg bg-lavender/25 px-3 py-1.5 font-mono text-xs">
              {DEMO_ORGANIZATION_ID}
            </span>
            <Link
              href="/login?callbackUrl=/dashboard"
              className="rounded-lg border border-line px-3 py-1.5 hover:border-ink/30"
            >
              Connexion réelle
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-5 py-6 lg:grid-cols-[1fr_19rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-lg border border-line bg-white p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm text-ink/60">Espace démo local</p>
                <h1 className="mt-1 text-2xl font-medium">Validation de classement</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/65">
                  Données fictives, aucun OAuth, aucun document réel. Les actions simulent le
                  chemin produit sans appeler de Drive de production.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {METRICS.map((metric) => (
                  <div key={metric.label} className="min-w-28 rounded-lg border border-line px-3 py-2">
                    <p className="font-mono text-lg">{metric.value}</p>
                    <p className="text-xs text-ink/60">{metric.label}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-sage-deep/25 bg-sage/20 p-4">
            <div className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-sage-deep" strokeWidth={1.5} />
              <div className="text-sm leading-relaxed">
                <h2 className="font-medium">RGPD et contrôle utilisateur</h2>
                <p className="mt-1 text-ink/65">
                  En production, les fichiers sont streamés depuis le Drive connecté vers l&apos;OCR
                  puis jetés. Klasr ne persiste pas le contenu documentaire ; seuls les
                  métadonnées, propositions et historiques sont conservés. Le renommage et le
                  déplacement ne se déclenchent qu&apos;après validation.
                </p>
              </div>
            </div>
          </section>

          <ProposalQueue
            initialProposals={DEMO_PROPOSALS}
            folders={DEMO_FOLDERS}
            onConfirmProposal={confirmDemoProposal}
            onIgnoreProposal={async () => undefined}
          />
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="rounded-lg border border-line bg-white p-4">
            <div className="flex items-center gap-2">
              <FolderTree className="h-4 w-4 text-lavender-deep" strokeWidth={1.5} />
              <h2 className="font-medium">Arborescence</h2>
            </div>
            <ul className="mt-4 space-y-2 font-mono text-xs text-ink/70">
              <li>/Comptabilité/2026/Cloud</li>
              <li>/Comptabilité/2026/Télécom</li>
              <li>/Banque/Relevés/2026</li>
              <li>/Juridique/Contrats/2026</li>
            </ul>
          </section>

          <section className="rounded-lg border border-line bg-white p-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-lavender-deep" strokeWidth={1.5} />
              <h2 className="font-medium">Activité récente</h2>
            </div>
            <ol className="mt-4 space-y-3">
              {ACTIVITY.map((item) => (
                <li key={`${item.time}-${item.label}`} className="border-t border-line pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.label}</p>
                      <p className="truncate font-mono text-xs text-ink/60">{item.detail}</p>
                    </div>
                    <span className="font-mono text-xs text-ink/60">{item.time}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink/60">{item.status}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="rounded-lg border border-peach-deep/25 bg-peach/25 p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-peach-deep" strokeWidth={1.5} />
              <h2 className="font-medium">Démo maîtrisée</h2>
            </div>
            <p className="mt-2 text-sm text-ink/65">
              Une proposition échoue volontairement au premier essai pour démontrer le retry et
              l&apos;absence de double exécution.
            </p>
          </section>

          <section className="rounded-lg border border-line bg-white p-4">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-lavender-deep" strokeWidth={1.5} />
              <h2 className="font-medium">Données conservées</h2>
            </div>
            <p className="mt-2 text-sm text-ink/65">
              Métadonnées de proposition, décision utilisateur et historique d&apos;action. Pas
              d&apos;octets ni de texte complet de document.
            </p>
          </section>
        </aside>
      </main>
    </div>
  );
}
