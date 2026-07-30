import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TokenEncryptionService } from '../auth/token-encryption.service';
import { DRIVE_EXECUTOR } from '../classification/drive-executor.port';
import { DriveConnectionsRepository } from './drive-connections.repository';
import { DriveConnectionsService } from './drive-connections.service';
import { FoldersRepository } from './folders.repository';
import { GoogleDriveExecutor } from './google-drive.executor';
import { GoogleTokenService } from './google-token.service';
import { LocalDriveExecutor } from './local-drive.executor';

function driveExecutorFactory(
  google: GoogleDriveExecutor,
  local: LocalDriveExecutor,
): GoogleDriveExecutor | LocalDriveExecutor {
  if (process.env.KLASR_LOCAL_MVP === 'true') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('KLASR_LOCAL_MVP cannot run in production');
    }
    return local;
  }
  return google;
}

@Module({
  imports: [ConfigModule],
  providers: [
    TokenEncryptionService,
    { provide: 'TOKEN_ENCRYPTION_KEY', useValue: process.env.TOKEN_ENCRYPTION_KEY ?? '' },
    DriveConnectionsRepository,
    DriveConnectionsService,
    FoldersRepository,
    GoogleTokenService,
    GoogleDriveExecutor,
    LocalDriveExecutor,
    { provide: DRIVE_EXECUTOR, useFactory: driveExecutorFactory, inject: [GoogleDriveExecutor, LocalDriveExecutor] },
  ],
  exports: [DRIVE_EXECUTOR, DriveConnectionsService, DriveConnectionsRepository, FoldersRepository],
})
export class DriveModule {}
