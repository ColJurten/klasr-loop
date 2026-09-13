import { Injectable } from '@nestjs/common';
import { DriveConnection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DriveConnectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUser(organizationId: string, userId: string): Promise<DriveConnection | null> {
    return this.prisma.driveConnection.findFirst({ where: { organizationId, userId } });
  }

  upsertGoogle(params: {
    organizationId: string;
    userId: string;
    externalId: string;
    encryptedToken: string;
    scopes: string[];
  }): Promise<DriveConnection> {
    return this.prisma.driveConnection.upsert({
      where: { userId: params.userId },
      create: {
        organizationId: params.organizationId,
        userId: params.userId,
        provider: 'GOOGLE_DRIVE',
        externalId: params.externalId,
        encryptedToken: params.encryptedToken,
        scopes: params.scopes,
      },
      update: {
        organizationId: params.organizationId,
        provider: 'GOOGLE_DRIVE',
        externalId: params.externalId,
        encryptedToken: params.encryptedToken,
        scopes: params.scopes,
        connectedAt: new Date(),
      },
    });
  }

  async touchSync(organizationId: string, userId: string): Promise<void> {
    await this.prisma.driveConnection.updateMany({
      where: { organizationId, userId },
      data: { lastSyncAt: new Date() },
    });
  }
}
