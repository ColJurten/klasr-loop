import { BadRequestException, Injectable } from '@nestjs/common';
import { DriveConnection } from '@prisma/client';
import { TokenEncryptionService } from '../auth/token-encryption.service';
import { DriveConnectionsRepository } from './drive-connections.repository';

export interface UpsertGoogleConnectionInput {
  organizationId: string;
  externalId: string;
  refreshToken?: string;
  scopes: string[];
}

@Injectable()
export class DriveConnectionsService {
  constructor(
    private readonly repository: DriveConnectionsRepository,
    private readonly tokens: TokenEncryptionService,
  ) {}

  findByOrganization(organizationId: string): Promise<DriveConnection | null> {
    return this.repository.findByOrganization(organizationId);
  }

  async upsertGoogleConnection(input: UpsertGoogleConnectionInput): Promise<DriveConnection> {
    const existing = await this.repository.findByOrganization(input.organizationId);
    const encryptedToken = input.refreshToken
      ? this.tokens.encrypt(input.refreshToken)
      : existing?.encryptedToken;

    if (!encryptedToken) {
      throw new BadRequestException('Missing Google refresh token');
    }

    return this.repository.upsertGoogle({
      organizationId: input.organizationId,
      externalId: input.externalId,
      encryptedToken,
      scopes: input.scopes,
    });
  }

  touchSync(organizationId: string): Promise<void> {
    return this.repository.touchSync(organizationId);
  }
}
