import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
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
import { authOptions, type MembershipRole } from '@/lib/auth';
import { SignOutButton } from './sign-out-button';

const NAV = [
  { label: 'Tableau de bord', href: '/dashboard', icon: LayoutDashboard, active: true },
  { label: 'Arborescence', href: '#', icon: FolderTree },
  { label: 'Historique', href: '#', icon: History },
  { label: 'Règles', href: '#', icon: ListChecks },
  { label: 'Membres', href: '#', icon: Users },
  { label: 'Templates', href: '#', icon: LayoutTemplate },
];

const ROLE_LABEL: Record<MembershipRole, string> = {
  ADMIN: 'Administrateur/Administratrice',
  MEMBER: 'Membre',
};

/** Two-letter initials from a display name, e.g. "Marie Laurent" -> "ML". */
function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  // Defensive: middleware already blocks unauthenticated access to /dashboard.
  if (!session?.user) {
    redirect('/');
  }

  const displayName = session.user.name ?? session.user.email ?? 'Utilisateur';
  const roleLabel = ROLE_LABEL[session.user.role];
  const initials = initialsFromName(displayName);

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
          {/* Organization name isn't part of the session yet (only
              organizationId/membershipId/role are) — showing the id keeps
              this honest rather than reintroducing fabricated demo data. */}
          <span className="truncate font-mono text-xs">{session.user.organizationId}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-ink/60" strokeWidth={1.5} />
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

        <div className="border-t border-line pt-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-lavender font-mono text-sm"
            >
              {initials}
            </span>
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium">{displayName}</p>
              <p className="truncate text-xs text-ink/60">{roleLabel}</p>
            </div>
          </div>
          <SignOutButton />
        </div>
      </aside>
      <div className="flex-1">{children}</div>
    </div>
  );
}
