import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { ConfirmProposalDto } from './dto/confirm-proposal.dto';
import { ProposalWithDocument } from './proposals.repository';

@Controller('organizations/:organizationId/proposals')
export class ClassificationController {
  constructor(private readonly service: ClassificationService) {}

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
