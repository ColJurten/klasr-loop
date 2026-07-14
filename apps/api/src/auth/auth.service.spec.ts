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
    // "reuse createWithOwner as-is" is exercised for real, not re-implemented
    // in the test double.
    organizationsService = new OrganizationsService(
      repository as unknown as OrganizationsRepository,
    );
    service = new AuthService(repository as unknown as OrganizationsRepository, organizationsService);
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
});
