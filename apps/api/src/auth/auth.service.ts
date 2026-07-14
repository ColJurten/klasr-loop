import { Injectable } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { OrganizationsRepository } from '../organizations/organizations.repository';
import { OrganizationsService } from '../organizations/organizations.service';
import { OnboardUserDto } from './dto/onboard-user.dto';

export interface OnboardResult {
  organizationId: string;
  membershipId: string;
  role: MemberRole;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly organizationsService: OrganizationsService,
  ) {}

  /**
   * Auto-onboarding on first sign-in. If the user already belongs to an
   * organization, reuse it (a user can only be auto-onboarded into one org
   * today). Otherwise mint a brand new organization via
   * OrganizationsService.create() — that logic (createWithOwner) lives
   * there and is not duplicated here.
   */
  async onboard(dto: OnboardUserDto): Promise<OnboardResult> {
    const existing = await this.organizationsRepository.findMembershipByUserEmail(dto.email);
    if (existing) {
      return {
        organizationId: existing.organizationId,
        membershipId: existing.id,
        role: existing.role,
      };
    }

    const organizationName = dto.displayName
      ? `Espace de ${dto.displayName}`
      : `Espace de ${dto.email}`;
    await this.organizationsService.create({ name: organizationName, ownerEmail: dto.email });

    const membership = await this.organizationsRepository.findMembershipByUserEmail(dto.email);
    if (!membership) {
      // createWithOwner just created this membership transactionally — if
      // the follow-up lookup can't find it, the lookup itself is broken,
      // not a legitimate "not found" case.
      throw new Error('Membership lookup failed immediately after onboarding');
    }

    return {
      organizationId: membership.organizationId,
      membershipId: membership.id,
      role: membership.role,
    };
  }
}
