import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateRuleDto } from './dto/create-rule.dto';
import { RulesService } from './rules.service';
import { RuleWithConditions } from './rules.repository';

@Controller('organizations/:organizationId/rules')
export class RulesController {
  constructor(private readonly service: RulesService) {}

  @Get()
  list(@Param('organizationId') organizationId: string): Promise<RuleWithConditions[]> {
    return this.service.list(organizationId);
  }

  @Post()
  create(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateRuleDto,
  ): Promise<RuleWithConditions> {
    return this.service.create(organizationId, dto);
  }
}
