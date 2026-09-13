import { Injectable } from '@nestjs/common';
import { Folder, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface FolderMetadata {
  id: string;
  name: string;
  parents?: string[];
}

export interface FolderChoice {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  path: string;
}

export interface ReferenceRootView {
  externalId: string;
  name: string;
}

@Injectable()
export class FoldersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByPath(organizationId: string, path: string): Promise<Folder | null> {
    return this.prisma.folder.findFirst({ where: { organizationId, path } });
  }

  findByExternalId(organizationId: string, externalId: string): Promise<Folder | null> {
    return this.prisma.folder.findUnique({
      where: { organizationId_externalId: { organizationId, externalId } },
    });
  }

  async listPaths(organizationId: string): Promise<string[]> {
    const folders = await this.prisma.folder.findMany({
      where: { organizationId, inherited: true },
      select: { path: true },
      orderBy: { path: 'asc' },
    });
    return folders.map((folder) => folder.path);
  }

  async upsertFolderTree(organizationId: string, folders: FolderMetadata[]): Promise<void> {
    await this.importDescendants(organizationId, null, folders);
  }

  async listInherited(organizationId: string): Promise<FolderChoice[]> {
    const folders = await this.prisma.folder.findMany({
      where: { organizationId, inherited: true },
      orderBy: { path: 'asc' },
      select: { externalId: true, name: true, path: true, parent: { select: { externalId: true } } },
    });
    return folders.map((folder) => ({
      externalId: folder.externalId,
      name: folder.name,
      path: folder.path,
      parentExternalId: folder.parent?.externalId ?? null,
    }));
  }

  async getReferenceRoot(organizationId: string): Promise<ReferenceRootView | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { referenceRootExternalId: true, referenceRootName: true },
    });
    if (!organization?.referenceRootExternalId || !organization.referenceRootName) return null;
    return { externalId: organization.referenceRootExternalId, name: organization.referenceRootName };
  }

  async replaceReferenceRoot(
    organizationId: string,
    root: { externalId: string; name: string },
    metadataFolders: FolderMetadata[],
  ): Promise<FolderChoice[]> {
    return this.prisma.$transaction(async (tx) => {
      await tx.document.updateMany({ where: { organizationId }, data: { folderId: null } });
      await tx.folder.deleteMany({ where: { organizationId } });
      await tx.organization.update({
        where: { id: organizationId },
        data: { referenceRootExternalId: root.externalId, referenceRootName: root.name },
      });
      await this.importDescendantsWithClient(tx, organizationId, root.externalId, metadataFolders);
      const folders = await tx.folder.findMany({
        where: { organizationId, inherited: true },
        orderBy: { path: 'asc' },
        select: { externalId: true, name: true, path: true, parent: { select: { externalId: true } } },
      });
      return folders.map((folder) => ({
        externalId: folder.externalId,
        name: folder.name,
        path: folder.path,
        parentExternalId: folder.parent?.externalId ?? null,
      }));
    });
  }

  async importDescendants(
    organizationId: string,
    rootExternalId: string | null,
    folders: FolderMetadata[],
  ): Promise<void> {
    await this.importDescendantsWithClient(this.prisma, organizationId, rootExternalId, folders);
  }

  private async importDescendantsWithClient(
    client: PrismaService | Prisma.TransactionClient,
    organizationId: string,
    rootExternalId: string | null,
    folders: FolderMetadata[],
  ): Promise<void> {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const childrenByParent = new Map<string, FolderMetadata[]>();
    for (const folder of folders) {
      for (const parent of folder.parents ?? []) {
        const siblings = childrenByParent.get(parent) ?? [];
        siblings.push(folder);
        childrenByParent.set(parent, siblings);
      }
    }

    const queue = rootExternalId
      ? (childrenByParent.get(rootExternalId) ?? []).map((folder) => ({ folder, path: `/${folder.name}`, parentDbId: null as string | null }))
      : folders
          .filter((folder) => !(folder.parents ?? []).some((parent) => byId.has(parent)))
          .map((folder) => ({ folder, path: `/${folder.name}`, parentDbId: null as string | null }));

    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.folder.id)) continue;
      visited.add(current.folder.id);
      const saved = await client.folder.upsert({
        where: { organizationId_externalId: { organizationId, externalId: current.folder.id } },
        create: {
          organizationId,
          externalId: current.folder.id,
          name: current.folder.name,
          path: current.path,
          parentId: current.parentDbId,
          inherited: true,
        },
        update: {
          name: current.folder.name,
          path: current.path,
          parentId: current.parentDbId,
          inherited: true,
        },
      });
      for (const child of childrenByParent.get(current.folder.id) ?? []) {
        queue.push({ folder: child, path: `${current.path}/${child.name}`.replace(/\/+/g, '/'), parentDbId: saved.id });
      }
    }
  }
}
