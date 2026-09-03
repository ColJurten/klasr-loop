import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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

class ListDriveItemsDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(512)
  parentId?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(2048)
  pageToken?: string;
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
    @Headers('x-user-id') userId: string,
  ): Promise<{ executed: true; destinationPath: string }> {
    return this.service.confirm(organizationId, proposalId, dto, userId);
  }

  @Post(':proposalId/ignore')
  ignore(
    @Param('organizationId') organizationId: string,
    @Param('proposalId') proposalId: string,
  ): Promise<{ ignored: true }> {
    return this.service.ignore(organizationId, proposalId);
  }
}

@Controller('organizations/:organizationId/sync')
@UseGuards(InternalServiceGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post()
  run(@Param('organizationId') organizationId: string, @Headers('x-user-id') userId: string) {
    return this.sync.syncOrganization(organizationId, userId);
  }
}

@Controller('organizations/:organizationId/drive')
@UseGuards(InternalServiceGuard)
export class DriveWorkflowController {
  constructor(private readonly sync: SyncService) {}

  @Get('reference-folders')
  listReferenceFolders(@Param('organizationId') organizationId: string, @Headers('x-user-id') userId: string) {
    return this.sync.listReferenceFolderChoices(organizationId, userId);
  }

  @Post('reference-root')
  selectReferenceRoot(
    @Param('organizationId') organizationId: string,
    @Headers('x-user-id') userId: string,
    @Body() dto: SelectReferenceRootDto,
  ) {
    return this.sync.selectReferenceRoot(organizationId, userId, dto.folderExternalId);
  }

  @Get('input-items')
  listInputItems(@Param('organizationId') organizationId: string, @Headers('x-user-id') userId: string) {
    return this.sync.listInputItems(organizationId, userId);
  }

  @Get('items')
  listItems(@Param('organizationId') organizationId: string, @Headers('x-user-id') userId: string, @Query() query: ListDriveItemsDto) {
    return this.sync.listDriveItems(organizationId, userId, query.parentId ?? 'root', query.pageToken);
  }

  @Post('launch')
  launch(@Param('organizationId') organizationId: string, @Headers('x-user-id') userId: string, @Body() dto: LaunchDriveItemDto) {
    return this.sync.launchDriveItem(organizationId, userId, dto.itemExternalId);
  }
}
