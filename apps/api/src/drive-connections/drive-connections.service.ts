import { Injectable } from '@nestjs/common';
import { ConnectDriveDto } from './dto/connect-drive.dto';
import { DriveConnectionsRepository } from './drive-connections.repository';
import { encryptToken } from './token-cipher';

@Injectable()
export class DriveConnectionsService {
  constructor(private readonly repository: DriveConnectionsRepository) {}

  /**
   * Persists the org's Drive grant. The refresh token is encrypted before it
   * ever reaches the repository/database — never logged in plaintext or
   * encrypted form (RGPD / secrets invariant).
   */
  async connect(dto: ConnectDriveDto): Promise<{ connected: true }> {
    await this.repository.upsertForOrganization(dto.organizationId, {
      provider: dto.provider,
      externalId: dto.externalId,
      encryptedToken: encryptToken(dto.refreshToken),
      scopes: dto.scopes,
    });
    await this.repository.upsertRootFolder(dto.organizationId, dto.rootFolder);
    return { connected: true };
  }
}
