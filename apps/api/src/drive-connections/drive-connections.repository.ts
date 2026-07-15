import { Injectable } from '@nestjs/common';
import { DriveConnection, DriveProvider, Folder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface ConnectionData {
  provider: DriveProvider;
  externalId: string;
  encryptedToken: string;
  scopes: string[];
}

interface RootFolderData {
  externalId: string;
  name: string;
}

/** All Prisma access for Drive connections lives here (layering rule). Every
 * query is scoped by organizationId (multi-tenant invariant). */
@Injectable()
export class DriveConnectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsertForOrganization(organizationId: string, data: ConnectionData): Promise<DriveConnection> {
    return this.prisma.driveConnection.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
  }

  /** The picked root is stored as a top-level Folder row (parentId null,
   * priority true, path = /name) — arborescence sync underneath it is
   * backlog item #2. */
  upsertRootFolder(organizationId: string, data: RootFolderData): Promise<Folder> {
    return this.prisma.folder.upsert({
      where: { organizationId_externalId: { organizationId, externalId: data.externalId } },
      create: { organizationId, priority: true, path: `/${data.name}`, ...data },
      update: { name: data.name, path: `/${data.name}` },
    });
  }
}
