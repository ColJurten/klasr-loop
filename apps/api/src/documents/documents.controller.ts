import { Controller, Get, Param, Query } from '@nestjs/common';
import { Document, DocumentStatus } from '@prisma/client';
import { DocumentsService } from './documents.service';

// NOTE: organizationId comes from the URL for now; once auth lands it MUST come
// from the authenticated session (NextAuth JWT), never from client input.
@Controller('organizations/:organizationId/documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Get()
  list(
    @Param('organizationId') organizationId: string,
    @Query('status') status?: DocumentStatus,
  ): Promise<Document[]> {
    return this.service.list(organizationId, status);
  }

  @Get(':documentId')
  getOne(
    @Param('organizationId') organizationId: string,
    @Param('documentId') documentId: string,
  ): Promise<Document> {
    return this.service.getOne(organizationId, documentId);
  }
}
