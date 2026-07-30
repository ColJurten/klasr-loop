import { Injectable } from '@nestjs/common';
import { Document, DocumentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Tenant scoping is structural: every method REQUIRES organizationId.
 * There is intentionally no findById(id) — cross-tenant reads are impossible by design.
 */
@Injectable()
export class DocumentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listByStatus(
    organizationId: string,
    status?: DocumentStatus,
    take = 50,
  ): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { detectedAt: 'desc' },
      take,
    });
  }

  findOne(organizationId: string, documentId: string): Promise<Document | null> {
    return this.prisma.document.findFirst({ where: { id: documentId, organizationId } });
  }

  findPending(organizationId: string, documentId: string): Promise<Document | null> {
    return this.prisma.document.findFirst({
      where: { id: documentId, organizationId, status: 'PENDING' },
    });
  }

  async upsertDocumentMetadata(
    organizationId: string,
    data: {
      externalId: string;
      name: string;
      mimeType: string;
      sizeBytes: number;
      folderExternalId?: string;
      supported: boolean;
    },
  ): Promise<{ id: string; status: DocumentStatus; created: boolean; supported: boolean }> {
    const existing = await this.prisma.document.findUnique({
      where: { organizationId_externalId: { organizationId, externalId: data.externalId } },
    });
    const folder = data.folderExternalId
      ? await this.prisma.folder.findUnique({
          where: {
            organizationId_externalId: {
              organizationId,
              externalId: data.folderExternalId,
            },
          },
        })
      : null;
    const status: DocumentStatus = data.supported ? existing?.status ?? 'PENDING' : 'MANUAL';
    const document = await this.prisma.document.upsert({
      where: { organizationId_externalId: { organizationId, externalId: data.externalId } },
      create: {
        organizationId,
        externalId: data.externalId,
        name: data.name,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        status,
        folderId: folder?.id,
      },
      update: {
        name: data.name,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        folderId: folder?.id,
        status,
      },
    });
    return { id: document.id, status: document.status, created: !existing, supported: data.supported };
  }

  async markManual(organizationId: string, documentId: string): Promise<void> {
    await this.prisma.document.updateMany({
      where: { id: documentId, organizationId },
      data: { status: 'MANUAL' },
    });
  }

  async markProposed(organizationId: string, documentId: string): Promise<void> {
    await this.prisma.document.updateMany({
      where: { id: documentId, organizationId, status: 'PENDING' },
      data: { status: 'PROPOSED' },
    });
  }

  async updateStatus(
    organizationId: string,
    documentId: string,
    status: DocumentStatus,
  ): Promise<Document> {
    // updateMany + scoped where guarantees no cross-tenant write, then re-read.
    await this.prisma.document.updateMany({
      where: { id: documentId, organizationId },
      data: { status },
    });
    return this.prisma.document.findFirstOrThrow({ where: { id: documentId, organizationId } });
  }
}
