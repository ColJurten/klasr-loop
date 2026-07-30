import { Injectable } from '@nestjs/common';
import { DriveConnection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DriveConnectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByOrganization(organizationId: string): Promise<DriveConnection | null> {
    return this.prisma.driveConnection.findUnique({ where: { organizationId } });
  }

  upsertGoogle(params: {
    organizationId: string;
    externalId: string;
    encryptedToken: string;
    scopes: string[];
  }): Promise<DriveConnection> {
    return this.prisma.driveConnection.upsert({
      where: { organizationId: params.organizationId },
      create: {
        organizationId: params.organizationId,
        provider: 'GOOGLE_DRIVE',
        externalId: params.externalId,
        encryptedToken: params.encryptedToken,
        scopes: params.scopes,
      },
      update: {
        provider: 'GOOGLE_DRIVE',
        externalId: params.externalId,
        encryptedToken: params.encryptedToken,
        scopes: params.scopes,
        connectedAt: new Date(),
      },
    });
  }

  async touchSync(organizationId: string): Promise<void> {
    await this.prisma.driveConnection.updateMany({
      where: { organizationId },
      data: { lastSyncAt: new Date() },
    });
  }
}
