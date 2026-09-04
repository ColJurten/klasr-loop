import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsController internal boundary', () => {
  let app: INestApplication;
  let baseUrl: string;
  const service = { create: jest.fn() };
  const originalSecret = process.env.INTERNAL_API_SECRET;

  beforeAll(async () => {
    process.env.INTERNAL_API_SECRET = 'organization-test-secret';
    const module = await Test.createTestingModule({
      controllers: [OrganizationsController],
      providers: [InternalServiceGuard, { provide: OrganizationsService, useValue: service }],
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('HTTP test server did not bind a TCP port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    if (originalSecret === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = originalSecret;
  });

  it('returns 401 before organization creation when the internal secret is missing', async () => {
    const response = await fetch(`${baseUrl}/organizations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Cabinet","ownerEmail":"owner@example.test"}' });
    expect(response.status).toBe(401);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('keeps the authorized organization creation path operational', async () => {
    service.create.mockResolvedValue({ id: 'org_1', name: 'Cabinet' });
    const response = await fetch(`${baseUrl}/organizations`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': 'organization-test-secret' }, body: '{"name":"Cabinet","ownerEmail":"owner@example.test"}' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: 'org_1', name: 'Cabinet' });
  });
});
