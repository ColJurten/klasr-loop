import { DriveConnectionsService } from './drive-connections.service';

describe('DriveConnectionsService', () => {
  it('preserves the existing encrypted refresh token when Google omits a later token', async () => {
    const repository = {
      findByOrganization: jest.fn().mockResolvedValue({
        id: 'conn_1',
        organizationId: 'org_1',
        encryptedToken: 'encrypted-old',
        provider: 'GOOGLE_DRIVE',
      }),
      upsertGoogle: jest.fn().mockResolvedValue(undefined),
    };
    const tokens = { encrypt: jest.fn((value: string) => `encrypted-${value}`) };
    const service = new DriveConnectionsService(repository as never, tokens as never);

    await service.upsertGoogleConnection({
      organizationId: 'org_1',
      externalId: 'google-user-1',
      refreshToken: undefined,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });

    expect(repository.upsertGoogle).toHaveBeenCalledWith({
      organizationId: 'org_1',
      externalId: 'google-user-1',
      encryptedToken: 'encrypted-old',
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    expect(tokens.encrypt).not.toHaveBeenCalled();
  });

  it('encrypts the first refresh token before repository persistence', async () => {
    const repository = {
      findByOrganization: jest.fn().mockResolvedValue(null),
      upsertGoogle: jest.fn().mockResolvedValue(undefined),
    };
    const tokens = { encrypt: jest.fn((value: string) => `encrypted-${value}`) };
    const service = new DriveConnectionsService(repository as never, tokens as never);

    await service.upsertGoogleConnection({
      organizationId: 'org_2',
      externalId: 'google-user-2',
      refreshToken: 'new-sensitive-value',
      scopes: ['scope-a'],
    });

    expect(repository.upsertGoogle).toHaveBeenCalledWith(
      expect.objectContaining({ encryptedToken: 'encrypted-new-sensitive-value' }),
    );
  });

  it('rejects missing refresh tokens for a first Google connection', async () => {
    const service = new DriveConnectionsService(
      {
        findByOrganization: jest.fn().mockResolvedValue(null),
        upsertGoogle: jest.fn(),
      } as never,
      { encrypt: jest.fn() } as never,
    );

    await expect(
      service.upsertGoogleConnection({
        organizationId: 'org_3',
        externalId: 'google-user-3',
        refreshToken: undefined,
        scopes: [],
      }),
    ).rejects.toThrow('Missing Google refresh token');
  });
});
