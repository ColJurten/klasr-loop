import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configValidationSchema } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { DocumentsModule } from './documents/documents.module';
import { RulesModule } from './rules/rules.module';
import { ClassificationModule } from './classification/classification.module';
import { AnalysesModule } from './analyses/analyses.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: configValidationSchema }),
    PrismaModule,
    HealthModule,
    OrganizationsModule,
    DocumentsModule,
    RulesModule,
    ClassificationModule,
    AnalysesModule,
    // TODO(#backlog): jobs module (pg-boss on PostgreSQL, ADR-004) for async
    // sync/OCR/classification — payloads MUST carry organizationId, be idempotent.
  ],
})
export class AppModule {}
