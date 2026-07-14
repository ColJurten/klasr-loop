import { OrganizationsRepository } from '../organizations/organizations.repository';
import { OrganizationsService } from '../organizations/organizations.service';
import { AuthService } from './auth.service';

describe('AuthService.onboard', () => {
  let repository: jest.Mocked<
    Pick<OrganizationsRepository, 'findMembershipByUserEmail' | 'createWithOwner'>
  >;
  let organizationsService: OrganizationsService;
  let service: AuthService;

  beforeEach(() => {
    repository = {
      findMembershipByUserEmail: jest.fn(),
      createWithOwner: jest.fn(),
    };
    // Real OrganizationsService on top of the mocked repository, so
    // "reuse createWithOwner as-is" is exercised for real, not
    // re-implemented in the test double. AuthService itself only ever sees
    // OrganizationsService (layering rule — it must not depend on
    // OrganizationsRepository directly).
    organizationsService = new OrganizationsService(
      repository as unknown as OrganizationsRepository,
    );
    service = new AuthService(organizationsService);
  });

  it('creates a brand new organization for an unknown email', async () => {
    repository.findMembershipByUserEmail
      .mockResolvedValueOnce(null) // no existing membership
      .mockResolvedValueOnce({
        id: 'membership_1',
        role: 'ADMIN',
        userId: 'user_1',
        organizationId: 'org_1',
        organization: { id: 'org_1', name: 'Espace de Marie', createdAt: new Date() },
      } as never);
    repository.createWithOwner.mockResolvedValue({
      id: 'org_1',
      name: 'Espace de Marie',
      createdAt: new Date(),
    } as never);

    const result = await service.onboard({
      email: 'marie@example.com',
      displayName: 'Marie',
      provider: 'google',
    });

    expect(repository.createWithOwner).toHaveBeenCalledWith('Espace de Marie', 'marie@example.com');
    expect(result).toEqual({ organizationId: 'org_1', membershipId: 'membership_1', role: 'ADMIN' });
  });

  it('falls back to the email for the org name when displayName is absent', async () => {
    repository.findMembershipByUserEmail
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'membership_2',
        role: 'ADMIN',
        userId: 'user_2',
        organizationId: 'org_2',
        organization: { id: 'org_2', name: 'Espace de anon@example.com', createdAt: new Date() },
      } as never);
    repository.createWithOwner.mockResolvedValue({
      id: 'org_2',
      name: 'Espace de anon@example.com',
      createdAt: new Date(),
    } as never);

    await service.onboard({ email: 'anon@example.com', provider: 'azure-ad' });

    expect(repository.createWithOwner).toHaveBeenCalledWith(
      'Espace de anon@example.com',
      'anon@example.com',
    );
  });

  it('reuses the existing membership without creating a new organization', async () => {
    repository.findMembershipByUserEmail.mockResolvedValue({
      id: 'membership_3',
      role: 'MEMBER',
      userId: 'user_3',
      organizationId: 'org_3',
      organization: { id: 'org_3', name: 'Espace existant', createdAt: new Date() },
    } as never);

    const result = await service.onboard({ email: 'existing@example.com', provider: 'google' });

    expect(repository.createWithOwner).not.toHaveBeenCalled();
    expect(result).toEqual({ organizationId: 'org_3', membershipId: 'membership_3', role: 'MEMBER' });
  });

  it('truncates an overly long generated organization name to 120 characters', async () => {
    const longDisplayName = 'A'.repeat(200);
    repository.findMembershipByUserEmail
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'membership_4',
        role: 'ADMIN',
        userId: 'user_4',
        organizationId: 'org_4',
        organization: { id: 'org_4', name: 'Espace de A...', createdAt: new Date() },
      } as never);
    repository.createWithOwner.mockResolvedValue({
      id: 'org_4',
      name: 'Espace de A...',
      createdAt: new Date(),
    } as never);

    await service.onboard({
      email: 'long@example.com',
      displayName: longDisplayName,
      provider: 'google',
    });

    const [nameArg] = repository.createWithOwner.mock.calls[0];
    expect(nameArg.length).toBeLessThanOrEqual(120);
    expect(nameArg.startsWith('Espace de AAA')).toBe(true);
  });

  it('throws when the post-creation membership lookup finds nothing (defensive)', async () => {
    repository.findMembershipByUserEmail.mockResolvedValue(null); // both calls return null
    repository.createWithOwner.mockResolvedValue({
      id: 'org_ghost',
      name: 'Espace de ghost@example.com',
      createdAt: new Date(),
    } as never);

    await expect(
      service.onboard({ email: 'ghost@example.com', provider: 'google' }),
    ).rejects.toThrow('Membership lookup failed immediately after onboarding');
  });

  it('recovers from a concurrent create race (unique constraint) by re-reading the membership', async () => {
    repository.findMembershipByUserEmail
      .mockResolvedValueOnce(null) // pre-create: no membership yet
      .mockResolvedValueOnce({
        // post-create: the concurrent winner's membership is now visible
        id: 'membership_5',
        role: 'ADMIN',
        userId: 'user_5',
        organizationId: 'org_5',
        organization: { id: 'org_5', name: 'Espace de race@example.com', createdAt: new Date() },
      } as never);
    repository.createWithOwner.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed on the fields: (`email`)'), {
        code: 'P2002',
      }),
    );

    const result = await service.onboard({ email: 'race@example.com', provider: 'google' });

    expect(result).toEqual({ organizationId: 'org_5', membershipId: 'membership_5', role: 'ADMIN' });
  });

  it('rethrows non-unique-constraint errors from organization creation', async () => {
    repository.findMembershipByUserEmail.mockResolvedValueOnce(null);
    repository.createWithOwner.mockRejectedValue(new Error('database is down'));

    await expect(
      service.onboard({ email: 'broken@example.com', provider: 'google' }),
    ).rejects.toThrow('database is down');
  });
});
