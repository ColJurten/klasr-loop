import { OrganizationsRepository } from '../organizations/organizations.repository';
import { OrganizationsService } from '../organizations/organizations.service';
import { AuthService } from './auth.service';
import * as bcrypt from 'bcrypt';

describe('AuthService.onboard', () => {
  let repository: jest.Mocked<
    Pick<OrganizationsRepository, 'findMembershipByUserEmail' | 'findLocalIdentity' | 'findLocalIdentityById' | 'enrollLocalPassword' | 'createWithOwner'>
  >;
  let organizationsService: OrganizationsService;
  let service: AuthService;
  const googleConnection = { provider: 'GOOGLE_DRIVE', externalId: 'google-account-1' };

  beforeEach(() => {
    repository = {
      findMembershipByUserEmail: jest.fn(),
      findLocalIdentity: jest.fn(),
      findLocalIdentityById: jest.fn(),
      enrollLocalPassword: jest.fn(),
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

  describe('local password enrollment', () => {
    it('enrolls the authenticated Google-only owner once', async () => {
      repository.findLocalIdentityById.mockResolvedValue({
        id: 'user_1', email: 'owner@example.com', passwordHash: null,
        memberships: [{ id: 'membership_1', organizationId: 'org_1', role: 'ADMIN' }],
      } as never);
      const driveConnections = { findByUser: jest.fn().mockResolvedValue(googleConnection) };
      repository.enrollLocalPassword = jest.fn().mockResolvedValue(1);
      service = new AuthService(organizationsService, driveConnections as never);

      await expect(service.enrollLocalPassword({ userId: 'user_1', organizationId: 'org_1', membershipId: 'membership_1' }, 'correct horse battery'))
        .resolves.toEqual({ enrolled: true });
      expect(repository.enrollLocalPassword).toHaveBeenCalledWith('user_1', 'org_1', 'membership_1', expect.stringMatching(/^\$2[aby]\$12\$/));
      const enrolledHash = repository.enrollLocalPassword.mock.calls[0][3];
      repository.findLocalIdentity.mockResolvedValue({ id: 'user_1', passwordHash: enrolledHash, memberships: [{ id: 'membership_1', organizationId: 'org_1', role: 'ADMIN' }] } as never);
      await expect(service.authenticate({ email: 'owner@example.com', password: 'correct horse battery' })).resolves.toEqual({ userId: 'user_1', organizationId: 'org_1', membershipId: 'membership_1', role: 'ADMIN' });
    });

    it.each([
      ['wrong user', { userId: 'other', organizationId: 'org_1', membershipId: 'membership_1' }, googleConnection],
      ['wrong tenant', { userId: 'user_1', organizationId: 'other', membershipId: 'membership_1' }, googleConnection],
      ['wrong membership', { userId: 'user_1', organizationId: 'org_1', membershipId: 'other' }, googleConnection],
      ['non-Google provider', { userId: 'user_1', organizationId: 'org_1', membershipId: 'membership_1' }, { provider: 'ONEDRIVE', externalId: 'microsoft-1' }],
      ['acceptance adapter', { userId: 'user_1', organizationId: 'org_1', membershipId: 'membership_1' }, { provider: 'GOOGLE_DRIVE', externalId: 'acceptance' }],
    ])('denies %s without mutation', async (_case, session, connection) => {
      repository.findLocalIdentityById.mockResolvedValue({ id: 'user_1', email: 'owner@example.com', passwordHash: null, memberships: [{ id: 'membership_1', organizationId: 'org_1', role: 'ADMIN' }] } as never);
      repository.enrollLocalPassword = jest.fn();
      service = new AuthService(organizationsService, { findByUser: jest.fn().mockResolvedValue(connection) } as never);

      await expect(service.enrollLocalPassword(session, 'correct horse battery')).rejects.toThrow();
      expect(repository.enrollLocalPassword).not.toHaveBeenCalled();
    });

    it('denies an existing password without replacing it', async () => {
      repository.findLocalIdentityById.mockResolvedValue({ id: 'user_1', passwordHash: 'existing', memberships: [{ id: 'membership_1', organizationId: 'org_1', role: 'ADMIN' }] } as never);
      repository.enrollLocalPassword = jest.fn();
      service = new AuthService(organizationsService, { findByUser: jest.fn().mockResolvedValue(googleConnection) } as never);
      await expect(service.enrollLocalPassword({ userId: 'user_1', organizationId: 'org_1', membershipId: 'membership_1' }, 'correct horse battery')).rejects.toThrow();
      expect(repository.enrollLocalPassword).not.toHaveBeenCalled();
    });

    it('allows exactly one concurrent conditional update', async () => {
      repository.findLocalIdentityById.mockResolvedValue({ id: 'user_1', passwordHash: null, memberships: [{ id: 'membership_1', organizationId: 'org_1', role: 'ADMIN' }] } as never);
      repository.enrollLocalPassword = jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
      service = new AuthService(organizationsService, { findByUser: jest.fn().mockResolvedValue(googleConnection) } as never);
      const session = { userId: 'user_1', organizationId: 'org_1', membershipId: 'membership_1' };

      const results = await Promise.allSettled([
        service.enrollLocalPassword(session, 'correct horse battery'),
        service.enrollLocalPassword(session, 'different secure password'),
      ]);
      expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
    });
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
      provider: 'google', emailVerified: true,
    });

    expect(repository.createWithOwner).toHaveBeenCalledWith('Espace de Marie', 'marie@example.com');
    expect(result).toEqual({ userId: 'user_1', organizationId: 'org_1', membershipId: 'membership_1', role: 'ADMIN' });
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

    await service.onboard({ email: 'anon@example.com', provider: 'azure-ad', emailVerified: true });

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

    const result = await service.onboard({ email: 'existing@example.com', provider: 'google', emailVerified: true });

    expect(repository.createWithOwner).not.toHaveBeenCalled();
    expect(result).toEqual({ userId: 'user_3', organizationId: 'org_3', membershipId: 'membership_3', role: 'MEMBER' });
  });

  it('creates the Google connection for the authenticated user, not the organization', async () => {
    repository.findMembershipByUserEmail.mockResolvedValue({
      id: 'membership_shared', role: 'MEMBER', userId: 'user_2', organizationId: 'org_shared',
      organization: { id: 'org_shared', name: 'Cabinet', createdAt: new Date() },
    } as never);
    const driveConnections = { upsertGoogleConnection: jest.fn().mockResolvedValue(undefined) };
    service = new AuthService(organizationsService, driveConnections as never);

    await service.onboard({ email: 'second@example.com', provider: 'google', emailVerified: true, providerAccountId: 'google_2', refreshToken: 'secret', scopes: ['drive'] });

    expect(driveConnections.upsertGoogleConnection).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org_shared', userId: 'user_2', externalId: 'google_2' }));
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
      provider: 'google', emailVerified: true,
    });

    const [nameArg] = repository.createWithOwner.mock.calls[0];
    expect(nameArg.length).toBeLessThanOrEqual(120);
    expect(nameArg.startsWith('Espace de AAA')).toBe(true);
  });

  it('refuses same-email OAuth linking unless the provider explicitly verifies the email', async () => {
    repository.findMembershipByUserEmail.mockResolvedValue({ id: 'membership', role: 'ADMIN', userId: 'user', organizationId: 'org', organization: { id: 'org' } } as never);
    await expect(service.onboard({ email: 'local@example.com', provider: 'google', emailVerified: false })).rejects.toThrow('OAuth email is not verified');
    expect(repository.createWithOwner).not.toHaveBeenCalled();
  });

  it('throws when the post-creation membership lookup finds nothing (defensive)', async () => {
    repository.findMembershipByUserEmail.mockResolvedValue(null); // both calls return null
    repository.createWithOwner.mockResolvedValue({
      id: 'org_ghost',
      name: 'Espace de ghost@example.com',
      createdAt: new Date(),
    } as never);

    await expect(
      service.onboard({ email: 'ghost@example.com', provider: 'google', emailVerified: true }),
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

    const result = await service.onboard({ email: 'race@example.com', provider: 'google', emailVerified: true });

    expect(result).toEqual({ userId: 'user_5', organizationId: 'org_5', membershipId: 'membership_5', role: 'ADMIN' });
  });

  it('rethrows non-unique-constraint errors from organization creation', async () => {
    repository.findMembershipByUserEmail.mockResolvedValueOnce(null);
    repository.createWithOwner.mockRejectedValue(new Error('database is down'));

    await expect(
      service.onboard({ email: 'broken@example.com', provider: 'google', emailVerified: true }),
    ).rejects.toThrow('database is down');
  });

  it('rejects normalized registration when any user identity already exists', async () => {
    repository.findLocalIdentity.mockResolvedValue({ id: 'oauth_user', passwordHash: null } as never);

    await expect(service.register({ email: ' OAuth@Example.COM ', password: 'correct horse battery', displayName: 'Attacker' }))
      .rejects.toThrow('email_registered');
    expect(repository.findLocalIdentity).toHaveBeenCalledWith('oauth@example.com');
    expect(repository.createWithOwner).not.toHaveBeenCalled();
  });

  it('fails a concurrent registration conflict closed', async () => {
    repository.findLocalIdentity.mockResolvedValue(null);
    repository.createWithOwner.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));

    await expect(service.register({ email: 'race@example.com', password: 'correct horse battery', displayName: 'Race' }))
      .rejects.toThrow('email_registered');
  });

  it('authenticates a normalized local identity and rejects a wrong password', async () => {
    const { hash } = await import('bcrypt');
    repository.findLocalIdentity.mockResolvedValue({
      id: 'user_local', passwordHash: await hash('correct horse battery', 12),
      memberships: [{ id: 'membership_local', organizationId: 'org_local', role: 'ADMIN' }],
    } as never);

    await expect(service.authenticate({ email: ' LOCAL@Example.COM ', password: 'correct horse battery' }))
      .resolves.toEqual({ userId: 'user_local', organizationId: 'org_local', membershipId: 'membership_local', role: 'ADMIN' });
    await expect(service.authenticate({ email: 'local@example.com', password: 'wrong password!' })).resolves.toBeNull();
    expect(repository.findLocalIdentity).toHaveBeenCalledWith('local@example.com');
  });

  it.each([
    ['an absent user', null],
    ['an identity without a password', { id: 'oauth', passwordHash: null, memberships: [] }],
  ])('runs the fixed bcrypt comparison for %s and returns the same failure', async (_case, identity) => {
    repository.findLocalIdentity.mockResolvedValue(identity as never);
    const compare = jest.spyOn(bcrypt, 'compare');

    await expect(service.authenticate({ email: 'missing@example.com', password: 'wrong password!' })).resolves.toBeNull();

    expect(compare).toHaveBeenCalledTimes(1);
    expect(compare.mock.calls[0][1]).toMatch(/^\$2[aby]\$12\$/);
    compare.mockRestore();
  });

  it('refuses verified OAuth reuse of an attacker-controlled password identity', async () => {
    repository.findLocalIdentity.mockResolvedValue({ id: 'local', passwordHash: 'hash' } as never);
    repository.findMembershipByUserEmail.mockResolvedValue({ id: 'membership', userId: 'local', organizationId: 'org', role: 'ADMIN' } as never);

    await expect(service.onboard({ email: 'LOCAL@example.com', provider: 'google', emailVerified: true }))
      .rejects.toThrow('OAuth identity cannot be linked automatically');
    expect(repository.createWithOwner).not.toHaveBeenCalled();
  });

  it('refuses a local identity created between the OAuth identity and membership reads', async () => {
    repository.findLocalIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'local', passwordHash: 'hash' } as never);
    repository.findMembershipByUserEmail.mockResolvedValue({ id: 'membership', userId: 'local', organizationId: 'org', role: 'ADMIN' } as never);

    await expect(service.onboard({ email: 'race@example.com', provider: 'google', emailVerified: true }))
      .rejects.toThrow('OAuth identity cannot be linked automatically');
    expect(repository.createWithOwner).not.toHaveBeenCalled();
  });

  it('safely reuses an OAuth-created identity without creating another organization', async () => {
    repository.findLocalIdentity.mockResolvedValue({ id: 'oauth', passwordHash: null } as never);
    repository.findMembershipByUserEmail.mockResolvedValue({ id: 'membership', userId: 'oauth', organizationId: 'org', role: 'ADMIN' } as never);

    await expect(service.onboard({ email: 'OAUTH@example.com', provider: 'google', emailVerified: true }))
      .resolves.toMatchObject({ userId: 'oauth', organizationId: 'org' });
    expect(repository.createWithOwner).not.toHaveBeenCalled();
  });

  it.each(['google', 'future-provider'])('denies %s unless its email is explicitly verified', async (provider) => {
    await expect(service.onboard({ email: 'new@example.com', provider, emailVerified: false }))
      .rejects.toThrow('OAuth email is not verified');
    expect(repository.createWithOwner).not.toHaveBeenCalled();
  });
});
