import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';
import { RulesRepository } from './rules.repository';

@Module({
  controllers: [RulesController],
  providers: [RulesService, RulesRepository],
  exports: [RulesService],
})
export class RulesModule {}
