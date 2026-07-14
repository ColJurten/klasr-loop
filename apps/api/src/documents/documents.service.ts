import { Injectable, NotFoundException } from '@nestjs/common';
import { Document, DocumentStatus } from '@prisma/client';
import { DocumentsRepository } from './documents.repository';

@Injectable()
export class DocumentsService {
  constructor(private readonly repository: DocumentsRepository) {}

  list(organizationId: string, status?: DocumentStatus): Promise<Document[]> {
    return this.repository.listByStatus(organizationId, status);
  }

  async getOne(organizationId: string, documentId: string): Promise<Document> {
    const document = await this.repository.findOne(organizationId, documentId);
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }
}
