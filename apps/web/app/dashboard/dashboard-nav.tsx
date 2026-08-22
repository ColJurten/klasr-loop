'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FolderTree, History, LayoutDashboard, LayoutTemplate, ListChecks, Settings, Users } from 'lucide-react';

const NAV = [
  { label: 'Tableau de bord', href: '/dashboard', icon: LayoutDashboard }, { label: 'Arborescence', href: '#', icon: FolderTree },
  { label: 'Historique', href: '#', icon: History }, { label: 'Règles', href: '#', icon: ListChecks }, { label: 'Membres', href: '#', icon: Users },
  { label: 'Templates', href: '#', icon: LayoutTemplate }, { label: 'Paramètres IA', href: '/dashboard/settings', icon: Settings },
];
export function DashboardNav() {
  const pathname = usePathname();
  return <nav className="mt-6 grid grid-cols-2 gap-1 md:flex md:flex-1 md:flex-col" aria-label="Navigation principale">{NAV.map(({ label, href, icon: Icon }) => {
    const active = href !== '#' && pathname === href;
    return <Link key={label} href={href} aria-current={active ? 'page' : undefined} className={`flex min-w-0 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${active ? 'bg-lavender/25 font-medium text-ink' : 'text-ink/60 hover:text-ink'}`}><Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />{label}</Link>;
  })}</nav>;
}
