import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationsRepository } from './organizations.repository';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationsRepository],
  // Only the service is exported: other modules (e.g. auth) go through
  // OrganizationsService's public API, never OrganizationsRepository
  // directly — the repository stays private to this module.
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
