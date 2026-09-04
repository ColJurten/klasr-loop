import { ConflictException, ForbiddenException, Injectable, Optional } from '@nestjs/common';
import { compare, hash } from 'bcrypt';
import { MemberRole } from '@prisma/client';
import { OrganizationsService } from '../organizations/organizations.service';
import { DriveConnectionsService } from '../drive/drive-connections.service';
import { OnboardUserDto } from './dto/onboard-user.dto';
import { LocalCredentialsDto, RegisterLocalDto } from './dto/local-credentials.dto';

export interface OnboardResult {
  userId: string;
  organizationId: string;
  membershipId: string;
  role: MemberRole;
}

export interface SessionIdentity {
  userId: string;
  organizationId: string;
  membershipId: string;
}

// Matches CreateOrganizationDto's @MaxLength(120) — the generated org name
// below is built from an OAuth display name, which never goes through the
// controller's ValidationPipe (this call bypasses HTTP), so it must be
// guarded here instead of relying on class-validator to catch it.
const ORGANIZATION_NAME_MAX_LENGTH = 120;
const DUMMY_PASSWORD_HASH = '$2b$12$yuR8xkWWsAfobvFldfSncuL.syXJJ2EdCMj0ZTk7i3..fYZKTvTrO';

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
    const email = dto.email.trim().toLowerCase();
    if (dto.emailVerified !== true) throw new Error('OAuth email is not verified');

    const identity = await this.organizationsService.findLocalIdentity(email);
    if (identity?.passwordHash) throw new Error('OAuth identity cannot be linked automatically');

    const existing = await this.organizationsService.findMembershipByEmail(email);
    if (existing) {
      const currentIdentity = identity ?? await this.organizationsService.findLocalIdentity(email);
      if (currentIdentity?.passwordHash) throw new Error('OAuth identity cannot be linked automatically');
      await this.upsertGoogleConnectionIfPresent(existing.organizationId, existing.userId, dto);
      return {
        userId: existing.userId,
        organizationId: existing.organizationId,
        membershipId: existing.id,
        role: existing.role,
      };
    }

    const rawName = dto.displayName ? `Espace de ${dto.displayName}` : `Espace de ${dto.email}`;
    const organizationName = rawName.slice(0, ORGANIZATION_NAME_MAX_LENGTH);

    try {
      await this.organizationsService.create({ name: organizationName, ownerEmail: email });
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

    const racedIdentity = await this.organizationsService.findLocalIdentity(email);
    if (racedIdentity?.passwordHash) throw new Error('OAuth identity cannot be linked automatically');
    const membership = await this.organizationsService.findMembershipByEmail(email);
    if (!membership) {
      // createWithOwner just created this membership transactionally — if
      // the follow-up lookup can't find it, the lookup itself is broken,
      // not a legitimate "not found" case.
      throw new Error('Membership lookup failed immediately after onboarding');
    }

    await this.upsertGoogleConnectionIfPresent(membership.organizationId, membership.userId, dto);

    return {
      userId: membership.userId,
      organizationId: membership.organizationId,
      membershipId: membership.id,
      role: membership.role,
    };
  }

  async register(dto: RegisterLocalDto): Promise<OnboardResult> {
    const email = dto.email.trim().toLowerCase();
    if (await this.organizationsService.findLocalIdentity(email)) throw new ConflictException('email_registered');
    try {
      await this.organizationsService.create(
        { name: `Espace de ${dto.displayName}`.slice(0, ORGANIZATION_NAME_MAX_LENGTH), ownerEmail: email },
        { name: dto.displayName, passwordHash: await hash(dto.password, 12) },
      );
    } catch (error) {
      if (isUniqueConstraintViolation(error)) throw new ConflictException('email_registered');
      throw error;
    }
    const membership = await this.organizationsService.findMembershipByEmail(email);
    if (!membership) throw new Error('Membership lookup failed immediately after registration');
    return { userId: membership.userId, organizationId: membership.organizationId, membershipId: membership.id, role: membership.role };
  }

  async authenticate(dto: LocalCredentialsDto): Promise<OnboardResult | null> {
    const user = await this.organizationsService.findLocalIdentity(dto.email.trim().toLowerCase());
    const membership = user?.memberships[0];
    const passwordMatches = await compare(dto.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user?.passwordHash || !membership || !passwordMatches) return null;
    return { userId: user.id, organizationId: membership.organizationId, membershipId: membership.id, role: membership.role };
  }

  async localPasswordEligibility(session: SessionIdentity): Promise<{ eligible: boolean }> {
    return { eligible: await this.isEligibleForLocalPassword(session) };
  }

  async enrollLocalPassword(session: SessionIdentity, password: string): Promise<{ enrolled: true }> {
    if (!(await this.isEligibleForLocalPassword(session))) throw new ForbiddenException('local_enrollment_forbidden');
    const updated = await this.organizationsService.enrollLocalPassword(
      session.userId,
      session.organizationId,
      session.membershipId,
      await hash(password, 12),
    );
    if (updated !== 1) throw new ConflictException('local_enrollment_conflict');
    return { enrolled: true };
  }

  private async isEligibleForLocalPassword(session: SessionIdentity): Promise<boolean> {
    const identity = await this.organizationsService.findLocalIdentityById(session.userId);
    const membership = identity?.memberships.find(({ id, organizationId, role }) =>
      id === session.membershipId && organizationId === session.organizationId && role === 'ADMIN');
    if (!identity || identity.id !== session.userId || identity.passwordHash || !membership) return false;
    const connection = await this.driveConnections?.findByUser(session.organizationId, session.userId);
    return connection?.provider === 'GOOGLE_DRIVE' && connection.externalId !== 'acceptance';
  }

  private async upsertGoogleConnectionIfPresent(
    organizationId: string,
    userId: string,
    dto: OnboardUserDto,
  ): Promise<void> {
    if (dto.provider !== 'google' || (!dto.providerAccountId && !dto.refreshToken)) return;
    await this.driveConnections?.upsertGoogleConnection({
      organizationId,
      userId,
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
