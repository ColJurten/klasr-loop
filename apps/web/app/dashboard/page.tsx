import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { getServerSession } from 'next-auth';
import { AlertTriangle, PlugZap, RefreshCcw } from 'lucide-react';
import { authOptions } from '@/lib/auth';
import { getDashboardData, getLlmSettings } from '@/lib/api';
import type { DashboardView } from '@/lib/types';
import { DriveWorkflow } from './drive-workflow';
import { ProposalQueue } from './proposal-queue';
import { StorageOnboarding } from './storage-onboarding';

export const dynamic = 'force-dynamic';
type LlmSummary = { configured?: boolean; provider?: string; model?: string; validatedAt?: string };

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  // Defensive: middleware already blocks unauthenticated access to /dashboard.
  if (!session?.user) {
    redirect('/');
  }
  const displayName = session.user.name ?? session.user.email ?? 'Utilisateur';
  let data: DashboardView | null;
  let llmSettings: LlmSummary | null = null;
  try {
    data = await getDashboardData();
  } catch {
    data = null;
  }
  try {
    llmSettings = await getLlmSettings() as LlmSummary;
  } catch {
    llmSettings = null;
  }

  const metrics = data
    ? [
        { label: 'En attente de validation', value: String(data.metrics.pending) },
        { label: "En cours d'analyse", value: String(data.metrics.analyzing) },
        { label: 'Classés', value: String(data.metrics.classified) },
      ]
    : [];
  const storageMissing = data?.mode === 'production' && !data.connection;

  return (
    <main className="mx-auto max-w-4xl px-8 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-medium">Bonjour, {displayName}</h1>
        <p className="mt-1 text-sm text-ink/60">
          Les propositions, métriques et historiques viennent de la base de données.
        </p>
        {data?.mode === 'local' && (
          <p className="mt-3 inline-flex rounded-lg border border-peach-deep/35 bg-peach/30 px-3 py-1 text-xs font-medium">
            Mode local
          </p>
        )}
        {data?.mode === 'service-account-staging' && (
          <p className="mt-3 inline-flex rounded-lg border border-lavender-deep/35 bg-lavender/30 px-3 py-1 text-xs font-medium">
            Validation staging · identité de service Google
          </p>
        )}
      </header>

      {!data && (
        <section className="mb-8 rounded-lg border border-peach-deep/35 bg-peach/25 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4" strokeWidth={1.5} />
            API indisponible
          </p>
          <p className="mt-1 text-sm text-ink/65">
            Aucune donnée fictive n&apos;est affichée. Relancez l&apos;API puis actualisez.
          </p>
        </section>
      )}

      {storageMissing && <StorageOnboarding />}

      {llmSettings?.configured === false && (
        <section aria-labelledby="llm-onboarding-title" className="mb-8 rounded-lg border border-peach-deep/35 bg-peach/25 p-4">
          <h2 id="llm-onboarding-title" className="text-sm font-medium">Aucune clé LLM configurée</h2>
          <p className="mt-1 text-sm text-ink/70">L&apos;analyse est bloquée tant qu&apos;une clé fournisseur n&apos;est pas validée.</p>
          <Link href="/dashboard/settings" className="mt-3 inline-flex rounded-lg border border-ink px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Configurer</Link>
        </section>
      )}

      {llmSettings?.configured && llmSettings.provider && (
        <section aria-label="Configuration LLM validée" className="mb-8 flex items-center gap-3 rounded-lg border border-sage-deep/35 bg-sage/20 p-4 text-sm">
          <Image src={`/brands/${llmSettings.provider}.svg`} alt={providerLabel(llmSettings.provider)} width={24} height={24} />
          <div><p className="font-medium">{llmSettings.model}</p><p className="text-ink/70">Validée le {llmSettings.validatedAt ? new Date(llmSettings.validatedAt).toLocaleString('fr-FR') : '—'}</p></div>
        </section>
      )}

      {!storageMissing && <section aria-label="Connexion Drive" className="mb-8 rounded-lg border border-line bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              {data?.connection ? <Image src="/brands/google-drive.svg" alt="Google Drive" width={20} height={20} /> : <PlugZap className="h-4 w-4 text-lavender-deep" strokeWidth={1.5} />}
              {data?.mode === 'service-account-staging'
                ? 'Google Drive staging autorisé par compte de service'
                : data?.connection ? 'Google Drive connecté' : 'Google Drive non connecté'}
            </p>
            <p className="mt-1 text-xs text-ink/60">
              {data?.mode === 'service-account-staging'
                ? `Validation automatisée hors production — ne prouve pas le consentement OAuth utilisateur.${data.connection?.lastSyncAt ? ` Dernière synchronisation : ${new Date(data.connection.lastSyncAt).toLocaleString('fr-FR')}` : ''}`
                : data?.connection?.lastSyncAt
                ? `Dernière synchronisation : ${new Date(data.connection.lastSyncAt).toLocaleString('fr-FR')}`
                : data?.connection ? `Connecté le ${new Date(data.connection.connectedAt).toLocaleString('fr-FR')}` : 'Connectez Google pour synchroniser les métadonnées Drive.'}
            </p>
          </div>
        </div>
      </section>}

      <section aria-label="Statistiques" className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-lg border border-line bg-white p-4">
            <p className="font-mono text-2xl">{metric.value}</p>
            <p className="mt-1 text-sm text-ink/60">{metric.label}</p>
          </div>
        ))}
      </section>

      <section
        aria-label="État de file"
        className="mb-10 rounded-lg border border-line bg-white p-4"
      >
        <p className="flex items-center gap-2 text-sm font-medium">
          <RefreshCcw className="h-4 w-4 text-lavender-deep" strokeWidth={1.5} />
          File d&apos;analyse
        </p>
        <p className="mt-1 text-xs text-ink/60">
          {data
            ? `${data.queue.queued} job(s), ${data.queue.active} actif(s), ${data.queue.failed} échec(s).`
            : 'État indisponible.'}
        </p>
      </section>

      {storageMissing ? (
        <section aria-label="Parcours indisponible" className="mb-10 rounded-lg border border-line bg-white p-4">
          <p className="text-sm text-ink/70">Connectez un stockage cloud pour accéder aux étapes d&apos;organisation.</p>
        </section>
      ) : <DriveWorkflow data={data} llmConfigured={llmSettings?.configured === true} />}

      {!storageMissing && <section aria-labelledby="review-title">
        <h2 id="review-title" className="mb-3 text-sm font-medium">4. Suggestions à revoir</h2>
        <ProposalQueue initialProposals={data?.proposals ?? []} folders={data?.folders ?? []} />
      </section>}

      {data && data.history.length > 0 && (
        <section aria-label="Historique" className="mt-10">
          <h2 className="text-sm font-medium">Historique récent</h2>
          <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">
            {data.history.map((item) => (
              <div key={item.id} className="px-4 py-3 text-sm">
                <p className="font-mono">{item.toName ?? item.document.name}</p>
                <p className="text-xs text-ink/60">
                  {item.action === 'IGNORED' ? 'Ignoré' : item.toPath} · {new Date(item.executedAt).toLocaleString('fr-FR')}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function providerLabel(provider: string) {
  return provider === 'openai-compatible' ? 'Compatible' : provider.charAt(0).toUpperCase() + provider.slice(1);
}
