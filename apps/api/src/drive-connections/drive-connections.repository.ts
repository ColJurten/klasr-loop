import { Injectable } from '@nestjs/common';
import { DriveConnection, DriveProvider } from '@prisma/client';
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

  /**
   * Upserts the org's root folder and points DriveConnection.rootFolderId at
   * it, in one transaction. Deliberately not `Folder.priority` — that field
   * means something unrelated ("dossiers prioritaires", a rules concept) —
   * `rootFolderId` is the unambiguous "current connected root", so picking a
   * different root on reconnect just repoints it instead of leaving two
   * folders both claiming to be the root.
   */
  connect(
    organizationId: string,
    connection: ConnectionData,
    rootFolder: RootFolderData,
  ): Promise<DriveConnection> {
    return this.prisma.$transaction(async (tx) => {
      const folder = await tx.folder.upsert({
        where: { organizationId_externalId: { organizationId, externalId: rootFolder.externalId } },
        create: { organizationId, path: `/${rootFolder.name}`, ...rootFolder },
        update: { name: rootFolder.name, path: `/${rootFolder.name}` },
      });

      return tx.driveConnection.upsert({
        where: { organizationId },
        create: { organizationId, rootFolderId: folder.id, ...connection },
        update: { rootFolderId: folder.id, ...connection },
      });
    });
  }
}
