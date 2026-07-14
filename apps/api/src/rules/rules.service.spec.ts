import { ConflictException } from '@nestjs/common';
import { RulesService } from './rules.service';
import { RulesRepository } from './rules.repository';

describe('RulesService', () => {
  let repository: jest.Mocked<Pick<RulesRepository, 'listOrdered' | 'existsAtPriority' | 'create'>>;
  let service: RulesService;

  const dto = {
    priority: 1,
    destinationPath: '/Comptabilité/Électricité',
    conditions: [{ field: 'CONTENT', operator: 'CONTAINS', value: 'edf' }],
  };

  beforeEach(() => {
    repository = {
      listOrdered: jest.fn(),
      existsAtPriority: jest.fn(),
      create: jest.fn(),
    };
    service = new RulesService(repository as unknown as RulesRepository);
  });

  it('rejects a duplicate priority within the same organization', async () => {
    repository.existsAtPriority.mockResolvedValue({ id: 'existing' } as never);
    await expect(service.create('org_1', dto as never)).rejects.toThrow(ConflictException);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('creates the rule scoped to the organization', async () => {
    repository.existsAtPriority.mockResolvedValue(null);
    repository.create.mockResolvedValue({ id: 'rule_1' } as never);
    await service.create('org_1', dto as never);
    expect(repository.create).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ priority: 1, destinationPath: '/Comptabilité/Électricité' }),
      dto.conditions,
    );
  });

  it('lists rules through the tenant-scoped repository', async () => {
    repository.listOrdered.mockResolvedValue([]);
    await service.list('org_1');
    expect(repository.listOrdered).toHaveBeenCalledWith('org_1');
  });
});
