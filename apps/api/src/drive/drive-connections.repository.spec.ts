import { DriveConnectionsRepository } from './drive-connections.repository';

describe('DriveConnectionsRepository', () => {
  it('replaces a stale organization binding when upserting a Google connection', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const repository = new DriveConnectionsRepository({ driveConnection: { upsert } } as never);

    await repository.upsertGoogle({ organizationId: 'org_current', userId: 'user_1', externalId: 'google_1', encryptedToken: 'encrypted', scopes: ['drive'] });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ organizationId: 'org_current' }),
    }));
  });
});
