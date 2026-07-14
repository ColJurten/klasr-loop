import { ConflictException, Injectable } from '@nestjs/common';
import { CreateRuleDto } from './dto/create-rule.dto';
import { RulesRepository, RuleWithConditions } from './rules.repository';

@Injectable()
export class RulesService {
  constructor(private readonly repository: RulesRepository) {}

  /** Rules are evaluated sequentially by ascending priority (product invariant). */
  list(organizationId: string): Promise<RuleWithConditions[]> {
    return this.repository.listOrdered(organizationId);
  }

  async create(organizationId: string, dto: CreateRuleDto): Promise<RuleWithConditions> {
    const clash = await this.repository.existsAtPriority(organizationId, dto.priority);
    if (clash) {
      throw new ConflictException(
        `A rule already exists at priority ${dto.priority} for this organization`,
      );
    }
    return this.repository.create(
      organizationId,
      {
        priority: dto.priority,
        destinationPath: dto.destinationPath,
        suggestedNameTemplate: dto.suggestedNameTemplate,
      },
      dto.conditions,
    );
  }
}
