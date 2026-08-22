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
import { AuthModule } from './auth/auth.module';
import { DriveModule } from './drive/drive.module';
import { JobsModule } from './jobs/jobs.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { LlmSettingsModule } from './llm-settings/llm-settings.module';

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
    AuthModule,
    DriveModule,
    JobsModule,
    DashboardModule,
    LlmSettingsModule,
  ],
})
export class AppModule {}
