import { UploadCloud } from 'lucide-react';
import { fetchPendingProposals } from '@/lib/api';
import type { ProposalView } from '@/lib/types';
import { ProposalQueue } from './proposal-queue';

export const dynamic = 'force-dynamic';

// Tenant de démonstration tant que l'auth n'est pas branchée (backlog #1) —
// ensuite dérivé de la session NextAuth, jamais d'une saisie client.
const DEMO_ORGANIZATION_ID = 'org_demo';

const FALLBACK_PROPOSALS: ProposalView[] = [
  {
    id: 'prop_demo_1',
    proposedName: 'Facture_Cloud_AWS_2026-06.pdf',
    destinationPath: '/Comptabilité/2026/Cloud',
    confidence: 0.94,
    source: 'LLM',
    document: {
      id: 'doc_demo_1',
      name: 'facture (12).pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_200_000,
    },
  },
  {
    id: 'prop_demo_2',
    proposedName: 'Releve_BP_2026-06.pdf',
    destinationPath: '/Banque/Relevés',
    confidence: 0.95,
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
    proposedName: 'Avenant_Prestataire_Nexa_2026.docx',
    destinationPath: '/Juridique/Contrats/2026',
    confidence: 0.68,
    source: 'LLM',
    isNewFolder: true,
    document: {
      id: 'doc_demo_3',
      name: 'document sans titre.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sizeBytes: 450_000,
    },
  },
];

const METRICS = [
  { label: 'En attente de validation', value: '24' },
  { label: "En cours d'analyse", value: '3' },
  { label: 'Classés ce mois', value: '1 284' },
];

export default async function DashboardPage() {
  let proposals = FALLBACK_PROPOSALS;
  let live = true;
  try {
    proposals = await fetchPendingProposals(DEMO_ORGANIZATION_ID);
  } catch {
    live = false; // API hors ligne : données de démonstration, l'UI reste explorable
  }

  return (
    <main className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-medium">Bonjour, Marie</h1>
        <p className="mt-1 text-sm text-ink/60">
          {live
            ? 'Voici l’état de votre espace de travail aujourd’hui.'
            : 'API hors ligne — données de démonstration.'}
        </p>
      </header>

      <section aria-label="Statistiques" className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {METRICS.map((metric) => (
          <div key={metric.label} className="rounded-xl border border-line bg-white p-4">
            <p className="font-mono text-2xl">{metric.value}</p>
            <p className="mt-1 text-sm text-ink/60">{metric.label}</p>
          </div>
        ))}
      </section>

      <section
        aria-label="Déposer des documents"
        className="mb-10 flex flex-col items-center gap-2 rounded-xl border border-dashed border-lavender-deep/40 bg-lavender/10 px-6 py-10 text-center"
      >
        <UploadCloud className="h-6 w-6 text-lavender-deep" strokeWidth={1.5} />
        <p className="text-sm font-medium">Déposez vos documents ici</p>
        <p className="text-xs text-ink/50">
          Factures, contrats, relevés — en vrac, sans vous soucier du nom.
        </p>
      </section>

      <ProposalQueue organizationId={DEMO_ORGANIZATION_ID} initialProposals={proposals} />
    </main>
  );
}
