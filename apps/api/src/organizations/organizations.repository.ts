import { Injectable } from '@nestjs/common';
import { Membership, Organization } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** All Prisma access for organizations lives here (layering rule). */
@Injectable()
export class OrganizationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createWithOwner(name: string, ownerEmail: string, user?: { name?: string; passwordHash?: string }): Promise<Organization> {
    const email = normalizeEmail(ownerEmail);
    return this.prisma.organization.create({
      data: {
        name,
        memberships: {
          create: {
            role: 'ADMIN',
            user: {
              create: { email, ...user },
            },
          },
        },
      },
    });
  }

  findLocalIdentity(email: string) {
    return this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true, email: true, name: true, passwordHash: true, memberships: { take: 1, orderBy: { id: 'asc' }, select: { id: true, organizationId: true, role: true } } },
    });
  }

  findLocalIdentityById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, passwordHash: true, memberships: { select: { id: true, organizationId: true, role: true } } },
    });
  }

  async enrollLocalPassword(userId: string, organizationId: string, membershipId: string, passwordHash: string): Promise<number> {
    const result = await this.prisma.user.updateMany({
      where: {
        id: userId,
        passwordHash: null,
        memberships: { some: { id: membershipId, organizationId, role: 'ADMIN' } },
        driveConnection: { is: { organizationId, provider: 'GOOGLE_DRIVE', externalId: { not: 'acceptance' } } },
      },
      data: { passwordHash },
    });
    return result.count;
  }

  findById(organizationId: string): Promise<Organization | null> {
    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }

  /**
   * First membership found for a user's email, with its organization.
   * A user can only be auto-onboarded into one org today — the first
   * membership found (ascending id) is authoritative; multi-org switching
   * is out of scope (see auth module).
   */
  findMembershipByUserEmail(
    email: string,
  ): Promise<(Membership & { organization: Organization }) | null> {
    return this.prisma.membership.findFirst({
      where: { user: { email: normalizeEmail(email) } },
      include: { organization: true },
      orderBy: { id: 'asc' },
    });
  }
}

/**
 * OAuth providers can return the same person's email with differing case
 * (or incidental whitespace). Normalize before every lookup/create so the
 * unique User.email constraint actually catches the same person twice
 * instead of minting a duplicate organization.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
