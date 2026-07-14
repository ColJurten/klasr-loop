import { Injectable } from '@nestjs/common';
import { Organization } from '@prisma/client';
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
}
