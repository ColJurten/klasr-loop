import { DriveConnectionsRepository } from './drive-connections.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('DriveConnectionsRepository — tenant scoping', () => {
  let prisma: {
    driveConnection: { upsert: jest.Mock };
    folder: { upsert: jest.Mock };
    $transaction: jest.Mock;
  };
  let repository: DriveConnectionsRepository;

  beforeEach(() => {
    prisma = {
      driveConnection: { upsert: jest.fn() },
      folder: { upsert: jest.fn() },
      // Runs the callback against the same mocked client, like Prisma's
      // interactive transactions do against a tx client.
      $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    repository = new DriveConnectionsRepository(prisma as unknown as PrismaService);
  });

  it('upserts the root folder, then upserts the connection pointing rootFolderId at it', async () => {
    prisma.folder.upsert.mockResolvedValue({ id: 'folder-db-id' });

    await repository.connect(
      'org-1',
      {
        provider: 'GOOGLE_DRIVE',
        externalId: 'account-1',
        encryptedToken: 'cipher-text',
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
      { externalId: 'folder-1', name: 'Comptabilité' },
    );

    expect(prisma.folder.upsert).toHaveBeenCalledWith({
      where: { organizationId_externalId: { organizationId: 'org-1', externalId: 'folder-1' } },
      create: { organizationId: 'org-1', path: '/Comptabilité', externalId: 'folder-1', name: 'Comptabilité' },
      update: { name: 'Comptabilité', path: '/Comptabilité' },
    });

    expect(prisma.driveConnection.upsert).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      create: {
        organizationId: 'org-1',
        rootFolderId: 'folder-db-id',
        provider: 'GOOGLE_DRIVE',
        externalId: 'account-1',
        encryptedToken: 'cipher-text',
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
      update: {
        rootFolderId: 'folder-db-id',
        provider: 'GOOGLE_DRIVE',
        externalId: 'account-1',
        encryptedToken: 'cipher-text',
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
    });
  });

  it('runs both writes inside a single transaction', async () => {
    prisma.folder.upsert.mockResolvedValue({ id: 'folder-db-id' });

    await repository.connect(
      'org-1',
      {
        provider: 'GOOGLE_DRIVE',
        externalId: 'account-1',
        encryptedToken: 'cipher-text',
        scopes: [],
      },
      { externalId: 'folder-1', name: 'Comptabilité' },
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
