import { Module } from '@nestjs/common';
import { DriveConnectionsController } from './drive-connections.controller';
import { DriveConnectionsService } from './drive-connections.service';
import { DriveConnectionsRepository } from './drive-connections.repository';

@Module({
  controllers: [DriveConnectionsController],
  providers: [DriveConnectionsService, DriveConnectionsRepository],
})
export class DriveConnectionsModule {}
