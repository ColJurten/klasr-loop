import { DriveConnectionsRepository } from './drive-connections.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('DriveConnectionsRepository — tenant scoping', () => {
  let prisma: {
    driveConnection: { upsert: jest.Mock };
    folder: { upsert: jest.Mock };
  };
  let repository: DriveConnectionsRepository;

  beforeEach(() => {
    prisma = {
      driveConnection: { upsert: jest.fn() },
      folder: { upsert: jest.fn() },
    };
    repository = new DriveConnectionsRepository(prisma as unknown as PrismaService);
  });

  it('upserts the connection scoped to the organizationId, one per org', async () => {
    await repository.upsertForOrganization('org-1', {
      provider: 'GOOGLE_DRIVE',
      externalId: 'account-1',
      encryptedToken: 'cipher-text',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });

    expect(prisma.driveConnection.upsert).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      create: {
        organizationId: 'org-1',
        provider: 'GOOGLE_DRIVE',
        externalId: 'account-1',
        encryptedToken: 'cipher-text',
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
      update: {
        provider: 'GOOGLE_DRIVE',
        externalId: 'account-1',
        encryptedToken: 'cipher-text',
        scopes: ['https://www.googleapis.com/auth/drive.file'],
      },
    });
  });

  it('upserts the root folder keyed by the compound organizationId+externalId unique', async () => {
    await repository.upsertRootFolder('org-1', { externalId: 'folder-1', name: 'Comptabilité' });

    expect(prisma.folder.upsert).toHaveBeenCalledWith({
      where: { organizationId_externalId: { organizationId: 'org-1', externalId: 'folder-1' } },
      create: {
        organizationId: 'org-1',
        priority: true,
        path: '/Comptabilité',
        externalId: 'folder-1',
        name: 'Comptabilité',
      },
      update: { name: 'Comptabilité', path: '/Comptabilité' },
    });
  });
});
