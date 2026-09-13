import { OrganizationsRepository } from './organizations.repository';
import { PrismaService } from '../prisma/prisma.service';

describe('OrganizationsRepository — email normalization', () => {
  let prisma: {
    organization: { create: jest.Mock };
    membership: { findFirst: jest.Mock };
    user: { updateMany: jest.Mock };
  };
  let repository: OrganizationsRepository;

  beforeEach(() => {
    prisma = {
      organization: { create: jest.fn() },
      membership: { findFirst: jest.fn() },
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    repository = new OrganizationsRepository(prisma as unknown as PrismaService);
  });

  it('lowercases and trims the email before creating the owning user', async () => {
    await repository.createWithOwner('Espace de Test', '  Foo.Bar@Example.COM  ');

    expect(prisma.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          memberships: expect.objectContaining({
            create: expect.objectContaining({
              user: { create: { email: 'foo.bar@example.com' } },
            }),
          }),
        }),
      }),
    );
  });

  it('lowercases and trims the email before looking up a membership', async () => {
    await repository.findMembershipByUserEmail('  Foo.Bar@Example.COM  ');

    expect(prisma.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user: { email: 'foo.bar@example.com' } },
      }),
    );
  });

  it('treats differently-cased emails as the same person', async () => {
    await repository.findMembershipByUserEmail('SOMEONE@EXAMPLE.COM');
    await repository.findMembershipByUserEmail('someone@example.com');

    const [firstCallArgs] = prisma.membership.findFirst.mock.calls[0];
    const [secondCallArgs] = prisma.membership.findFirst.mock.calls[1];
    expect(firstCallArgs.where).toEqual(secondCallArgs.where);
  });

  it('atomically enrolls only the exact passwordless Google owner', async () => {
    await expect(repository.enrollLocalPassword('user_1', 'org_1', 'membership_1', 'bcrypt-hash')).resolves.toBe(1);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'user_1', passwordHash: null,
        memberships: { some: { id: 'membership_1', organizationId: 'org_1', role: 'ADMIN' } },
        driveConnection: { is: { organizationId: 'org_1', provider: 'GOOGLE_DRIVE', externalId: { not: 'acceptance' } } },
      },
      data: { passwordHash: 'bcrypt-hash' },
    });
  });
});
