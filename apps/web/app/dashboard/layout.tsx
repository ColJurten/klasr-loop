import Link from 'next/link';
import {
  ChevronsUpDown,
  FolderTree,
  History,
  LayoutDashboard,
  LayoutTemplate,
  ListChecks,
  Users,
} from 'lucide-react';
import { KlasrLogo } from '@/components/logo';

const NAV = [
  { label: 'Tableau de bord', href: '/dashboard', icon: LayoutDashboard, active: true },
  { label: 'Arborescence', href: '#', icon: FolderTree },
  { label: 'Historique', href: '#', icon: History },
  { label: 'Règles', href: '#', icon: ListChecks },
  { label: 'Membres', href: '#', icon: Users },
  { label: 'Templates', href: '#', icon: LayoutTemplate },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-white px-4 py-5">
        <Link href="/" aria-label="Accueil klasr">
          <KlasrLogo />
        </Link>

        <button
          className="mt-6 flex w-full items-center justify-between rounded-lg border border-line px-3 py-2 text-sm hover:border-ink/30"
          aria-label="Changer d'organisation"
        >
          <span className="truncate">Cabinet JPD Conseil</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-ink/40" strokeWidth={1.5} />
        </button>

        <nav className="mt-6 flex flex-1 flex-col gap-1" aria-label="Navigation principale">
          {NAV.map(({ label, href, icon: Icon, active }) => (
            <Link
              key={label}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? 'bg-lavender/25 font-medium text-ink' : 'text-ink/60 hover:text-ink'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.5} />
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3 border-t border-line pt-4">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-lavender font-mono text-sm"
          >
            ML
          </span>
          <div className="min-w-0 text-sm">
            <p className="truncate font-medium">Marie Laurent</p>
            <p className="truncate text-xs text-ink/50">Administratrice</p>
          </div>
        </div>
      </aside>
      <div className="flex-1">{children}</div>
    </div>
  );
}
