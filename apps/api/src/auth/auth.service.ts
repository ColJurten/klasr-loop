import { Injectable, Optional } from '@nestjs/common';
import { MemberRole } from '@prisma/client';
import { OrganizationsService } from '../organizations/organizations.service';
import { DriveConnectionsService } from '../drive/drive-connections.service';
import { OnboardUserDto } from './dto/onboard-user.dto';

export interface OnboardResult {
  organizationId: string;
  membershipId: string;
  role: MemberRole;
}

// Matches CreateOrganizationDto's @MaxLength(120) — the generated org name
// below is built from an OAuth display name, which never goes through the
// controller's ValidationPipe (this call bypasses HTTP), so it must be
// guarded here instead of relying on class-validator to catch it.
const ORGANIZATION_NAME_MAX_LENGTH = 120;

@Injectable()
export class AuthService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    @Optional() private readonly driveConnections?: DriveConnectionsService,
  ) {}

  /**
   * Auto-onboarding on first sign-in. If the user already belongs to an
   * organization, reuse it (a user can only be auto-onboarded into one org
   * today). Otherwise mint a brand new organization via
   * OrganizationsService.create() — that logic (createWithOwner) lives
   * there and is not duplicated here.
   */
  async onboard(dto: OnboardUserDto): Promise<OnboardResult> {
    const existing = await this.organizationsService.findMembershipByEmail(dto.email);
    if (existing) {
      await this.upsertGoogleConnectionIfPresent(existing.organizationId, dto);
      return {
        organizationId: existing.organizationId,
        membershipId: existing.id,
        role: existing.role,
      };
    }

    const rawName = dto.displayName ? `Espace de ${dto.displayName}` : `Espace de ${dto.email}`;
    const organizationName = rawName.slice(0, ORGANIZATION_NAME_MAX_LENGTH);

    try {
      await this.organizationsService.create({ name: organizationName, ownerEmail: dto.email });
    } catch (error) {
      // Two concurrent first sign-ins for the same brand-new email can both
      // pass the findMembershipByEmail check above and both reach here; the
      // loser hits the unique constraint on User.email instead of a
      // legitimate failure. Fall through to re-read what the winner
      // created instead of letting this 500.
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
    }

    const membership = await this.organizationsService.findMembershipByEmail(dto.email);
    if (!membership) {
      // createWithOwner just created this membership transactionally — if
      // the follow-up lookup can't find it, the lookup itself is broken,
      // not a legitimate "not found" case.
      throw new Error('Membership lookup failed immediately after onboarding');
    }

    await this.upsertGoogleConnectionIfPresent(membership.organizationId, dto);

    return {
      organizationId: membership.organizationId,
      membershipId: membership.id,
      role: membership.role,
    };
  }

  private async upsertGoogleConnectionIfPresent(
    organizationId: string,
    dto: OnboardUserDto,
  ): Promise<void> {
    if (dto.provider !== 'google' || (!dto.providerAccountId && !dto.refreshToken)) return;
    await this.driveConnections?.upsertGoogleConnection({
      organizationId,
      externalId: dto.providerAccountId ?? dto.email,
      refreshToken: dto.refreshToken,
      scopes: dto.scopes ?? [],
    });
  }
}

/**
 * Duck-typed check for Prisma's "unique constraint failed" error (P2002).
 * Duck-typing rather than `instanceof Prisma.PrismaClientKnownRequestError`
 * on purpose: that check is fragile across bundling/module-duplication, and
 * `.code` is the stable, documented signal Prisma sets on these errors.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
