import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}));

import { getServerSession } from 'next-auth';
import { getDashboardData, confirmProposal, listDriveItems, startSync } from '@/lib/api';

const session = {
  user: {
    name: 'Camille',
    email: 'camille@example.test',
    organizationId: 'org_session',
    membershipId: 'mem_1',
    role: 'ADMIN',
  },
};

describe('web BFF API client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue(session as never);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as never;
  });

  it('scopes parent navigation to the session tenant and forwards opaque pagination', async () => {
    process.env.INTERNAL_API_SECRET = 'test-secret';
    process.env.API_URL = 'http://api.local/api/v1';
    await listDriveItems('folder_1', 'page_2');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.local/api/v1/organizations/org_session/drive/items?parentId=folder_1&pageToken=page_2',
      expect.objectContaining({ headers: { 'x-internal-secret': 'test-secret' }, cache: 'no-store' }),
    );
  });

  it('derives dashboard organizationId from the server session and sends only the internal secret header', async () => {
    process.env.INTERNAL_API_SECRET = 'test-secret';
    process.env.API_URL = 'http://api.local/api/v1';

    await getDashboardData();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://api.local/api/v1/organizations/org_session/dashboard',
      expect.objectContaining({
        headers: { 'x-internal-secret': 'test-secret' },
        cache: 'no-store',
      }),
    );
  });

  it('does not accept an organizationId argument for sync or confirmation', async () => {
    process.env.INTERNAL_API_SECRET = 'test-secret';
    process.env.API_URL = 'http://api.local/api/v1';

    await startSync();
    await confirmProposal('prop_1', '/Corrige');

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'http://api.local/api/v1/organizations/org_session/sync',
      expect.any(Object),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'http://api.local/api/v1/organizations/org_session/proposals/prop_1/confirm',
      expect.any(Object),
    );
  });
});
