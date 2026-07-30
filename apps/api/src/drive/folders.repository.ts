import { Injectable } from '@nestjs/common';
import { Folder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface FolderMetadata {
  id: string;
  name: string;
  parents?: string[];
}

@Injectable()
export class FoldersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByPath(organizationId: string, path: string): Promise<Folder | null> {
    return this.prisma.folder.findFirst({ where: { organizationId, path } });
  }

  async listPaths(organizationId: string): Promise<string[]> {
    const folders = await this.prisma.folder.findMany({
      where: { organizationId },
      select: { path: true },
      orderBy: { path: 'asc' },
    });
    return folders.map((folder) => folder.path);
  }

  async upsertFolderTree(organizationId: string, folders: FolderMetadata[]): Promise<void> {
    const pathByExternalId = new Map<string, string>();
    for (const folder of folders) {
      const parentPath = folder.parents?.[0] ? pathByExternalId.get(folder.parents[0]) : undefined;
      const path = `${parentPath ?? ''}/${folder.name}`.replace(/\/+/g, '/');
      pathByExternalId.set(folder.id, path);
      await this.prisma.folder.upsert({
        where: { organizationId_externalId: { organizationId, externalId: folder.id } },
        create: { organizationId, externalId: folder.id, name: folder.name, path },
        update: { name: folder.name, path },
      });
    }
  }
}
