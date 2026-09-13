import { Injectable, NotFoundException } from '@nestjs/common';
import { Membership, Organization } from '@prisma/client';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { OrganizationsRepository } from './organizations.repository';

@Injectable()
export class OrganizationsService {
  constructor(private readonly repository: OrganizationsRepository) {}

  create(dto: CreateOrganizationDto, user?: { name?: string; passwordHash?: string }): Promise<Organization> {
    return user
      ? this.repository.createWithOwner(dto.name, dto.ownerEmail, user)
      : this.repository.createWithOwner(dto.name, dto.ownerEmail);
  }

  findLocalIdentity(email: string) {
    return this.repository.findLocalIdentity(email);
  }

  findLocalIdentityById(userId: string) {
    return this.repository.findLocalIdentityById(userId);
  }

  enrollLocalPassword(userId: string, organizationId: string, membershipId: string, passwordHash: string): Promise<number> {
    return this.repository.enrollLocalPassword(userId, organizationId, membershipId, passwordHash);
  }

  async getById(organizationId: string): Promise<Organization> {
    const organization = await this.repository.findById(organizationId);
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  /**
   * First (and today, only) membership for a user's email — the public
   * entry point other modules (e.g. auth, for onboarding) use instead of
   * reaching into OrganizationsRepository directly.
   */
  findMembershipByEmail(
    email: string,
  ): Promise<(Membership & { organization: Organization }) | null> {
    return this.repository.findMembershipByUserEmail(email);
  }
}
