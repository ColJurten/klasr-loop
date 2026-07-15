import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { ConnectDriveDto } from './dto/connect-drive.dto';
import { DriveConnectionsService } from './drive-connections.service';

/**
 * Internal-only endpoint called by the web app's /api/drive/finalize route
 * handler after an org admin completes the Drive OAuth grant + Picker
 * selection — never exposed to end users directly. Guarded by the same
 * shared-secret check as POST /auth/onboarding (fail closed). The web layer
 * has already verified the caller is an ADMIN of organizationId before
 * reaching here.
 */
@Controller('drive-connections')
@UseGuards(InternalServiceGuard)
export class DriveConnectionsController {
  constructor(private readonly driveConnectionsService: DriveConnectionsService) {}

  @Post()
  connect(@Body() dto: ConnectDriveDto): Promise<{ connected: true }> {
    return this.driveConnectionsService.connect(dto);
  }
}
