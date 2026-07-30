import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { AlertTriangle, PlugZap, RefreshCcw } from 'lucide-react';
import { authOptions } from '@/lib/auth';
import { getDashboardData } from '@/lib/api';
import type { DashboardView } from '@/lib/types';
import { DriveWorkflow } from './drive-workflow';
import { ProposalQueue } from './proposal-queue';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  // Defensive: middleware already blocks unauthenticated access to /dashboard.
  if (!session?.user) {
    redirect('/');
  }
  const displayName = session.user.name ?? session.user.email ?? 'Utilisateur';
  let data: DashboardView | null;
  try {
    data = await getDashboardData();
  } catch {
    data = null;
  }

  const metrics = data
    ? [
        { label: 'En attente de validation', value: String(data.metrics.pending) },
        { label: "En cours d'analyse", value: String(data.metrics.analyzing) },
        { label: 'Classés', value: String(data.metrics.classified) },
      ]
    : [];

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

      <section aria-label="Connexion Drive" className="mb-8 rounded-lg border border-line bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <PlugZap className="h-4 w-4 text-lavender-deep" strokeWidth={1.5} />
              {data?.connection ? 'Google Drive connecté' : 'Google Drive non connecté'}
            </p>
            <p className="mt-1 text-xs text-ink/60">
              {data?.connection?.lastSyncAt
                ? `Dernière synchronisation : ${new Date(data.connection.lastSyncAt).toLocaleString('fr-FR')}`
                : 'Connectez Google pour synchroniser les métadonnées Drive.'}
            </p>
          </div>
        </div>
      </section>

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

      <DriveWorkflow data={data} />

      <section aria-labelledby="review-title">
        <h2 id="review-title" className="mb-3 text-sm font-medium">4. Suggestions à revoir</h2>
        <ProposalQueue initialProposals={data?.proposals ?? []} folders={data?.folders ?? []} />
      </section>

      {data && data.history.length > 0 && (
        <section aria-label="Historique" className="mt-10">
          <h2 className="text-sm font-medium">Historique récent</h2>
          <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-white">
            {data.history.map((item) => (
              <div key={item.id} className="px-4 py-3 text-sm">
                <p className="font-mono">{item.toName ?? item.document.name}</p>
                <p className="text-xs text-ink/60">{item.toPath} · {new Date(item.executedAt).toLocaleString('fr-FR')}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
