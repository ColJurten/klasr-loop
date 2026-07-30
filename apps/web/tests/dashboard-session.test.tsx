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

// Mirrors Next's real behavior: redirect() throws (aborting the render)
// rather than returning — a no-op mock would let execution fall through to
// code that assumes a session exists, masking the branch entirely.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

const fetchPendingProposals = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/api', () => ({
  fetchPendingProposals: (...args: unknown[]) => fetchPendingProposals(...args),
  confirmProposal: vi.fn().mockResolvedValue({ executed: true, destinationPath: '/' }),
}));

import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import AppLayout from '@/app/dashboard/layout';
import DashboardPage from '@/app/dashboard/page';

const mockedGetServerSession = vi.mocked(getServerSession);
const mockedRedirect = vi.mocked(redirect);

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

  it('redirects to / and never renders dashboard chrome when there is no session', async () => {
    mockedGetServerSession.mockResolvedValue(null as never);

    // The component must throw (aborting before the JSX return) rather than
    // reach code that assumes session.user exists — proving dashboard
    // chrome (nav, identity block) is never produced for this render.
    await expect(AppLayout({ children: <div>contenu</div> })).rejects.toThrow(
      'NEXT_REDIRECT:/',
    );

    expect(mockedRedirect).toHaveBeenCalledWith('/');
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

  it('redirects to / and never fetches proposals when there is no session', async () => {
    mockedGetServerSession.mockResolvedValue(null as never);

    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT:/');

    expect(mockedRedirect).toHaveBeenCalledWith('/');
    expect(fetchPendingProposals).not.toHaveBeenCalled();
  });
});
