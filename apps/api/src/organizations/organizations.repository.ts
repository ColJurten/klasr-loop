import { Injectable } from '@nestjs/common';
import { Membership, Organization } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** All Prisma access for organizations lives here (layering rule). */
@Injectable()
export class OrganizationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  createWithOwner(name: string, ownerEmail: string): Promise<Organization> {
    return this.prisma.organization.create({
      data: {
        name,
        memberships: {
          create: {
            role: 'ADMIN',
            user: {
              connectOrCreate: {
                where: { email: ownerEmail },
                create: { email: ownerEmail },
              },
            },
          },
        },
      },
    });
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
      where: { user: { email } },
      include: { organization: true },
      orderBy: { id: 'asc' },
    });
  }
}
