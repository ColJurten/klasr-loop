import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { ClassificationService } from './classification.service';
import { ConfirmProposalDto } from './dto/confirm-proposal.dto';
import { ProposalWithDocument } from './proposals.repository';
import { SyncService } from './sync.service';

class SelectReferenceRootDto {
  @IsString()
  folderExternalId!: string;
}

class LaunchDriveItemDto {
  @IsString()
  itemExternalId!: string;
}

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

  @Post(':proposalId/reject')
  reject(
    @Param('organizationId') organizationId: string,
    @Param('proposalId') proposalId: string,
  ): Promise<{ executed: true; destinationPath: string }> {
    return this.service.reject(organizationId, proposalId);
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

@Controller('organizations/:organizationId/drive')
@UseGuards(InternalServiceGuard)
export class DriveWorkflowController {
  constructor(private readonly sync: SyncService) {}

  @Get('reference-folders')
  listReferenceFolders(@Param('organizationId') organizationId: string) {
    return this.sync.listReferenceFolderChoices(organizationId);
  }

  @Post('reference-root')
  selectReferenceRoot(
    @Param('organizationId') organizationId: string,
    @Body() dto: SelectReferenceRootDto,
  ) {
    return this.sync.selectReferenceRoot(organizationId, dto.folderExternalId);
  }

  @Get('input-items')
  listInputItems(@Param('organizationId') organizationId: string) {
    return this.sync.listInputItems(organizationId);
  }

  @Post('launch')
  launch(@Param('organizationId') organizationId: string, @Body() dto: LaunchDriveItemDto) {
    return this.sync.launchDriveItem(organizationId, dto.itemExternalId);
  }
}
