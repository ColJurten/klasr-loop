import { randomBytes } from 'crypto';
import { DriveConnectionsService } from './drive-connections.service';
import { DriveConnectionsRepository } from './drive-connections.repository';
import { decryptToken } from './token-cipher';
import { ConnectDriveDto } from './dto/connect-drive.dto';

describe('DriveConnectionsService', () => {
  const ORIGINAL_KEY = process.env.TOKEN_ENCRYPTION_KEY;
  let repository: { connect: jest.Mock };
  let service: DriveConnectionsService;

  const dto: ConnectDriveDto = Object.assign(new ConnectDriveDto(), {
    organizationId: 'org-1',
    provider: 'GOOGLE_DRIVE',
    externalId: 'account-1',
    refreshToken: 'raw-refresh-token',
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    rootFolder: { externalId: 'folder-1', name: 'Comptabilité' },
  });

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    repository = { connect: jest.fn() };
    service = new DriveConnectionsService(repository as unknown as DriveConnectionsRepository);
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.TOKEN_ENCRYPTION_KEY;
    } else {
      process.env.TOKEN_ENCRYPTION_KEY = ORIGINAL_KEY;
    }
  });

  it('never persists the refresh token in plaintext', async () => {
    await service.connect(dto);

    const [, connectionData] = repository.connect.mock.calls[0];
    expect(connectionData.encryptedToken).not.toBe('raw-refresh-token');
    expect(decryptToken(connectionData.encryptedToken)).toBe('raw-refresh-token');
  });

  it('scopes the write to the given organizationId and forwards the root folder', async () => {
    await service.connect(dto);

    const [organizationId, , rootFolder] = repository.connect.mock.calls[0];
    expect(organizationId).toBe('org-1');
    expect(rootFolder).toEqual(dto.rootFolder);
  });

  it('resolves with a plain connected acknowledgement', async () => {
    await expect(service.connect(dto)).resolves.toEqual({ connected: true });
  });
});
