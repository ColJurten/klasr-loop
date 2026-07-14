import { Injectable, NotFoundException } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationsRepository } from './organizations.repository';

@Injectable()
export class OrganizationsService {
  constructor(private readonly repository: OrganizationsRepository) {}

  create(dto: CreateOrganizationDto): Promise<Organization> {
    return this.repository.createWithOwner(dto.name, dto.ownerEmail);
  }

  async getById(organizationId: string): Promise<Organization> {
    const organization = await this.repository.findById(organizationId);
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }
}
