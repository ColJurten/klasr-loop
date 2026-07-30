import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { DriveModule } from '../drive/drive.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InternalServiceGuard } from './guards/internal-service.guard';

@Module({
  imports: [OrganizationsModule, DriveModule],
  controllers: [AuthController],
  providers: [AuthService, InternalServiceGuard],
})
export class AuthModule {}
