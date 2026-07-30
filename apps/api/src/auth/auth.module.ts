import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InternalServiceGuard } from './guards/internal-service.guard';

@Module({
  imports: [OrganizationsModule],
  controllers: [AuthController],
  providers: [AuthService, InternalServiceGuard],
})
export class AuthModule {}
