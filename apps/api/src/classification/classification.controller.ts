import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { ClassificationService } from './classification.service';
import { ConfirmProposalDto } from './dto/confirm-proposal.dto';
import { ProposalWithDocument } from './proposals.repository';
import { SyncService } from './sync.service';

@Controller('organizations/:organizationId/proposals')
@UseGuards(InternalServiceGuard)
export class ClassificationController {
  constructor(
    private readonly service: ClassificationService,
    private readonly sync: SyncService,
  ) {}

  @Get()
  listPending(@Param('organizationId') organizationId: string): Promise<ProposalWithDocument[]> {
    return this.service.listPending(organizationId);
  }

  @Post(':proposalId/confirm')
  confirm(
    @Param('organizationId') organizationId: string,
    @Param('proposalId') proposalId: string,
    @Body() dto: ConfirmProposalDto,
  ): Promise<{ executed: true; destinationPath: string }> {
    return this.service.confirm(organizationId, proposalId, dto);
  }
}

@Controller('organizations/:organizationId/sync')
@UseGuards(InternalServiceGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post()
  run(@Param('organizationId') organizationId: string) {
    return this.sync.syncOrganization(organizationId);
  }
}
