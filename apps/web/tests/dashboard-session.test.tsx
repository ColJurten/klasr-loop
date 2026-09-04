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
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => '/dashboard',
}));

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

const dashboardFixture = {
  mode: 'production',
  connection: { provider: 'GOOGLE_DRIVE', connectedAt: '2026-08-28T08:00:00.000Z', lastSyncAt: null },
  referenceRoot: { externalId: 'root', name: 'Cabinet', path: '/Cabinet' },
  folders: [], inputItems: [{ externalId: 'doc-1', name: 'facture.pdf', type: 'file', supported: true, eligible: true }],
  metrics: { pending: 0, analyzing: 0, classified: 0, outcomes: 0, documentsIn: 0, ruleMatches: 0, llmCalls: 0, ocrRuns: 0 },
  queue: { queued: 0, ready: 0, active: 0, failed: 0, inlineWorker: false, consuming: false },
  analysisFailures: 0,
  proposals: [],
  history: [],
};
const getDashboardData = vi.fn().mockResolvedValue(dashboardFixture);
const getLlmSettings = vi.fn().mockResolvedValue({ configured: false });
vi.mock('@/lib/api', () => ({
  getDashboardData: (...args: unknown[]) => getDashboardData(...args),
  getLlmSettings: (...args: unknown[]) => getLlmSettings(...args),
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
    userId: 'user_7b21',
    membershipId: 'mem_7b21',
    role: 'ADMIN' as const,
  },
  expires: '2099-01-01T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  getDashboardData.mockResolvedValue(dashboardFixture);
  getLlmSettings.mockResolvedValue({ configured: false });
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

describe('Dashboard page — organizationId comes from the server BFF', () => {
  it('shows the missing LLM card above KPIs and disables analysis with associated help', async () => {
    mockedGetServerSession.mockResolvedValue(session as never);
    render((await DashboardPage()) as ReactElement);
    const card = screen.getByRole('heading', { name: 'Aucune clé LLM configurée' }).closest('section')!;
    const metrics = screen.getByRole('region', { name: 'Statistiques' });
    expect(card.compareDocumentPosition(metrics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Configurer' }).getAttribute('href')).toBe('/dashboard/settings');
    const launch = screen.getByRole('button', { name: /lancer l'organisation/i }) as HTMLButtonElement;
    expect(launch.disabled).toBe(true);
    expect(document.getElementById(launch.getAttribute('aria-describedby')!)?.textContent).toMatch(/analyse est bloquée/i);
  });

  it('replaces onboarding with the validated provider status', async () => {
    mockedGetServerSession.mockResolvedValue(session as never);
    getLlmSettings.mockResolvedValueOnce({ configured: true, provider: 'mistral', model: 'mistral-small', validatedAt: '2026-08-30T12:00:00Z', status: 'VALID' });
    render((await DashboardPage()) as ReactElement);
    expect(screen.queryByText('Aucune clé LLM configurée')).toBeNull();
    expect(screen.getByRole('img', { name: 'Mistral' })).toBeDefined();
    expect(screen.getByText('mistral-small')).toBeDefined();
    expect(screen.getByText(/Validée le/)).toBeDefined();
  });
  it('puts cloud storage first and gates the regular workflow while unlinked', async () => {
    mockedGetServerSession.mockResolvedValue(session as never);
    getDashboardData.mockResolvedValueOnce({ ...dashboardFixture, connection: null });

    const ui = (await DashboardPage()) as ReactElement;
    render(ui);

    const storage = screen.getByText('Aucun stockage cloud connecté').closest('section');
    const llm = screen.getByText('Aucune clé LLM configurée').closest('section');
    expect(storage).toBeDefined();
    expect(llm).toBeDefined();
    expect(storage!.compareDocumentPosition(llm!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connecter' })).toBeDefined();
    expect(screen.getByText(/connectez un stockage cloud pour accéder aux étapes/i)).toBeDefined();
    expect(screen.queryByText('1. Dossier de référence')).toBeNull();
    expect(screen.queryByText('4. Suggestions à revoir')).toBeNull();
    expect(screen.queryByRole('button', { name: /lancer l'organisation/i })).toBeNull();
    expect(screen.queryByLabelText('Chemin Drive')).toBeNull();
  });

  it('fetches dashboard data without receiving a browser-supplied organizationId', async () => {
    mockedGetServerSession.mockResolvedValue(session as never);

    const ui = (await DashboardPage()) as ReactElement;
    render(ui);

    expect(getDashboardData).toHaveBeenCalledWith();
  });

  it('renders the linked provider logo, status, last sync and workflow', async () => {
    mockedGetServerSession.mockResolvedValue(session as never);
    getDashboardData.mockResolvedValueOnce({
      ...(await getDashboardData()),
      connection: {
        provider: 'GOOGLE_DRIVE',
        connectedAt: '2026-08-28T08:00:00.000Z',
        lastSyncAt: '2026-08-29T09:30:00.000Z',
      },
    });

    const ui = (await DashboardPage()) as ReactElement;
    render(ui);

    expect(screen.getByText('Google Drive connecté')).toBeDefined();
    expect(screen.getByText(/dernière synchronisation/i)).toBeDefined();
    expect(screen.getByRole('img', { name: 'Google Drive' })).toBeDefined();
    expect(screen.getByText('1. Dossier de référence')).toBeDefined();
  });

  it('shows sync-derived freshness in the service-account acceptance state', async () => {
    mockedGetServerSession.mockResolvedValue(session as never);
    getDashboardData.mockResolvedValueOnce({
      ...(await getDashboardData()),
      mode: 'service-account-staging',
      connection: {
        provider: 'GOOGLE_DRIVE',
        connectedAt: '2026-08-28T08:00:00.000Z',
        lastSyncAt: '2026-08-30T09:00:00.000Z',
      },
    });

    render((await DashboardPage()) as ReactElement);

    expect(screen.getByText(/dernière synchronisation/i)).toBeDefined();
    expect(screen.getByText(/ne prouve pas le consentement OAuth utilisateur/i)).toBeDefined();
  });

  it('redirects to / and never fetches proposals when there is no session', async () => {
    mockedGetServerSession.mockResolvedValue(null as never);

    await expect(DashboardPage()).rejects.toThrow('NEXT_REDIRECT:/');

    expect(mockedRedirect).toHaveBeenCalledWith('/');
    expect(getDashboardData).not.toHaveBeenCalled();
  });
});
