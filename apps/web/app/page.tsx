import Link from 'next/link';
import { Eye, MousePointerClick, ShieldCheck } from 'lucide-react';
import { KlasrLogo, KlasrMark } from '@/components/logo';

const BENEFITS = [
  {
    icon: MousePointerClick,
    title: 'Un clic suffit',
    body: "L'IA analyse chaque document et propose un nom et un dossier. Vous validez, klasr exécute le rangement dans votre Drive.",
  },
  {
    icon: ShieldCheck,
    title: 'Vos fichiers restent chez vous',
    body: 'Aucun document stocké chez klasr. Seules les métadonnées sont analysées, puis purgées automatiquement.',
  },
  {
    icon: Eye,
    title: 'Contrôle total',
    body: "Chaque suggestion est visible avant exécution, avec son score de confiance. L'historique trace tout, tout est réversible.",
  },
];

const STEPS = [
  {
    title: 'Connectez votre Drive',
    body: 'Google Drive ou OneDrive, une seule fois. klasr lit uniquement la structure de vos dossiers.',
  },
  {
    title: 'Déposez vos fichiers',
    body: 'Factures, contrats et documents en vrac, sans vous soucier du nom.',
  },
  {
    title: 'Validez les suggestions',
    body: "L'IA propose le meilleur emplacement. Un clic pour confirmer le rangement.",
  },
];

const TIERS = [
  { name: 'Solo', price: 'Gratuit', detail: '50 documents / mois, 1 Drive' },
  { name: 'Pro', price: '19 € / mois', detail: 'Documents illimités, règles avancées', featured: true },
  { name: 'Team', price: '49 € / utilisateur / mois', detail: 'Multi-membres, audit complet' },
];

export default function LandingPage() {
  return (
    <div>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <KlasrLogo />
        <nav className="flex items-center gap-6 text-sm text-ink/70">
          <a href="#fonctionnement" className="hover:text-ink">
            Comment ça marche
          </a>
          <a href="#tarifs" className="hover:text-ink">
            Tarifs
          </a>
          <Link href="/login?callbackUrl=/dashboard" className="hover:text-ink">
            Se connecter
          </Link>
          <Link
            href="/login?callbackUrl=/dashboard"
            className="rounded-lg bg-ink px-4 py-2 font-medium text-paper hover:bg-ink/85"
          >
            Essayer gratuitement
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-6 pb-20 pt-16 text-center">
          <h1 className="text-4xl leading-tight tracking-tight sm:text-5xl">
            Confirmez. <span className="text-lavender-deep">klasr</span> s&apos;occupe du reste.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-ink/60">
            Le classement automatique de vos documents Drive par IA, conçu pour les cabinets
            d&apos;expertise comptable et les professions réglementées.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/login?callbackUrl=/dashboard"
              className="rounded-lg bg-ink px-6 py-3 text-sm font-medium text-paper hover:bg-ink/85"
            >
              Essayer gratuitement
            </Link>
            <a
              href="#fonctionnement"
              className="rounded-lg border border-line px-6 py-3 text-sm hover:border-ink/30"
            >
              Voir le fonctionnement
            </a>
          </div>

          {/* Aperçu produit : une proposition, réduite à l'essentiel */}
          <div className="mx-auto mt-14 max-w-xl rounded-xl border border-line bg-white p-4 text-left">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 font-mono text-sm">
                <p className="truncate text-ink/50">scan_0231.pdf</p>
                <p className="truncate">→ Facture_EDF_2026-06.pdf</p>
                <p className="truncate text-ink/70">/Comptabilité/Électricité</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-lg bg-sage px-2 py-0.5 font-mono text-xs">94%</span>
                <span className="rounded-lg bg-sage px-4 py-2 text-sm font-medium">Valider</span>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-line bg-white">
          <div className="mx-auto grid max-w-5xl gap-10 px-6 py-16 sm:grid-cols-3">
            {BENEFITS.map(({ icon: Icon, title, body }) => (
              <div key={title}>
                <Icon className="h-5 w-5 text-lavender-deep" strokeWidth={1.5} />
                <h2 className="mt-3 font-medium">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink/60">{body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="fonctionnement" className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl">Comment ça marche</h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="font-mono text-sm text-lavender-deep">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="mt-2 font-medium">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink/60">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-y border-line bg-white">
          <figure className="mx-auto max-w-3xl px-6 py-14 text-center">
            <blockquote className="text-lg leading-relaxed">
              « klasr a réduit de 80 % le temps que mes collaborateurs passaient à classer les
              pièces comptables. C&apos;est l&apos;outil qui nous manquait pour passer au cabinet
              100 % numérique. »
            </blockquote>
            <figcaption className="mt-4 text-sm text-ink/60">
              Jean-Pierre Durand — expert-comptable associé, JPD Conseil
            </figcaption>
          </figure>
        </section>

        <section id="tarifs" className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl">Tarifs</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-xl border bg-white p-6 ${
                  tier.featured ? 'border-2 border-lavender-deep' : 'border-line'
                }`}
              >
                <h3 className="font-medium">{tier.name}</h3>
                <p className="mt-2 font-mono text-xl">{tier.price}</p>
                <p className="mt-2 text-sm text-ink/60">{tier.detail}</p>
                <Link
                  href="/login?callbackUrl=/dashboard"
                  className={`mt-6 block rounded-lg px-4 py-2 text-center text-sm font-medium ${
                    tier.featured
                      ? 'bg-ink text-paper hover:bg-ink/85'
                      : 'border border-line hover:border-ink/30'
                  }`}
                >
                  Commencer
                </Link>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-ink/50">
          <span className="inline-flex items-center gap-2">
            <KlasrMark size={16} /> © 2026 klasr
          </span>
          <nav className="flex gap-5">
            <a href="#" className="hover:text-ink">
              Confidentialité (RGPD)
            </a>
            <a href="#" className="hover:text-ink">
              CGU
            </a>
            <a href="#" className="hover:text-ink">
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
