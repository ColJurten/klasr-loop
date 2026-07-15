import type { ReactElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/app/dashboard/drive/drive-picker', () => ({
  DrivePicker: () => <div>picker-stub</div>,
}));

import { getServerSession } from 'next-auth';
import DriveConnectPage from '@/app/dashboard/drive/page';

const mockedGetServerSession = vi.mocked(getServerSession);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DriveConnectPage — admin gating and status messages', () => {
  it('shows an admin-only notice and no connect link for a MEMBER', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'MEMBER' },
    } as never);

    const ui = (await DriveConnectPage({ searchParams: {} })) as ReactElement;
    render(ui);

    expect(screen.getByText(/seul un administrateur/i)).toBeDefined();
    expect(screen.queryByText('Connecter Google Drive')).toBeNull();
  });

  it('renders the connect link for an ADMIN with no step in progress', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);

    const ui = (await DriveConnectPage({ searchParams: {} })) as ReactElement;
    render(ui);

    const link = screen.getByText('Connecter Google Drive').closest('a');
    expect(link?.getAttribute('href')).toBe('/api/drive/connect');
  });

  it('renders the Picker step instead of the connect link when step=pick', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);

    const ui = (await DriveConnectPage({ searchParams: { step: 'pick' } })) as ReactElement;
    render(ui);

    expect(screen.getByText('picker-stub')).toBeDefined();
    expect(screen.queryByText('Connecter Google Drive')).toBeNull();
  });

  it('maps an error code to its French message', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);

    const ui = (await DriveConnectPage({
      searchParams: { error: 'state_mismatch' },
    })) as ReactElement;
    render(ui);

    expect(screen.getByRole('alert').textContent).toMatch(/expiré|interrompue/i);
  });

  it('shows a success message when connected=1', async () => {
    mockedGetServerSession.mockResolvedValue({
      user: { organizationId: 'org-1', role: 'ADMIN' },
    } as never);

    const ui = (await DriveConnectPage({
      searchParams: { connected: '1' },
    })) as ReactElement;
    render(ui);

    expect(screen.getByText(/est connecté/i)).toBeDefined();
  });
});
