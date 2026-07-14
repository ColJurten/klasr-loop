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
