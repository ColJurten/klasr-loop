import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { OrganizationsRepository } from './organizations.repository';

@Module({
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationsRepository],
  // OrganizationsRepository is also exported: the auth module needs direct
  // read access to findMembershipByUserEmail for onboarding lookups, while
  // still reusing OrganizationsService.create() for org creation itself
  // (no duplicated Prisma logic).
  exports: [OrganizationsService, OrganizationsRepository],
})
export class OrganizationsModule {}
