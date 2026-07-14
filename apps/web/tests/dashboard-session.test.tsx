import type { ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// next/link uses the app-router context, which isn't mounted when a server
// component is invoked directly in a unit test — stub it to a plain anchor.
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

const fetchPendingProposals = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/api', () => ({
  fetchPendingProposals: (...args: unknown[]) => fetchPendingProposals(...args),
}));

import { getServerSession } from 'next-auth';
import AppLayout from '@/app/dashboard/layout';
import DashboardPage from '@/app/dashboard/page';

const mockedGetServerSession = vi.mocked(getServerSession);

const session = {
  user: {
    name: 'Camille Perrin',
    email: 'camille@cabinet-exemple.fr',
    organizationId: 'org_9f3c1a',
    membershipId: 'mem_7b21',
    role: 'ADMIN' as const,
  },
  expires: '2099-01-01T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Dashboard layout — session-derived identity, not hardcoded demo data', () => {
  it('renders the signed-in user name, role and initials from the session', async () => {
    mockedGetServerSession.mockResolvedValue(session as never);

    const ui = (await AppLayout({ children: <div>contenu</div> })) as ReactElement;
    render(ui);

    expect(screen.getByText('Camille Perrin')).toBeDefined();
    expect(screen.getByText('Administrateur/Administratrice')).toBeDefined();
    expect(screen.getByText('CP')).toBeDefined();
    expect(screen.getByText('org_9f3c1a')).toBeDefined();

    // The old hardcoded demo identity must be gone.
    expect(screen.queryByText('Marie Laurent')).toBeNull();
    expect(screen.queryByText('Administratrice')).toBeNull();
    expect(screen.queryByText('ML')).toBeNull();
    expect(screen.queryByText('Cabinet JPD Conseil')).toBeNull();
  });

  it('maps the MEMBER role to its French label', async () => {
    mockedGetServerSession.mockResolvedValue({
      ...session,
      user: { ...session.user, name: 'Lucas Dubois', role: 'MEMBER' as const },
    } as never);

    const ui = (await AppLayout({ children: <div>contenu</div> })) as ReactElement;
    render(ui);

    expect(screen.getByText('Membre')).toBeDefined();
    expect(screen.getByText('LD')).toBeDefined();
  });
});

describe('Dashboard page — organizationId comes from the session', () => {
  it('fetches proposals for the session organizationId, not the old demo id', async () => {
    mockedGetServerSession.mockResolvedValue(session as never);

    const ui = (await DashboardPage()) as ReactElement;
    render(ui);

    expect(fetchPendingProposals).toHaveBeenCalledWith('org_9f3c1a');
    expect(fetchPendingProposals).not.toHaveBeenCalledWith('org_demo');
  });
});
