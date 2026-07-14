import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthService, OnboardResult } from './auth.service';
import { OnboardUserDto } from './dto/onboard-user.dto';
import { InternalServiceGuard } from './guards/internal-service.guard';

/**
 * Internal-only endpoint called by the web app's NextAuth callback — never
 * exposed to end users directly. Guarded by the shared-secret check in
 * InternalServiceGuard (fail closed).
 */
@Controller('auth')
@UseGuards(InternalServiceGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('onboarding')
  onboard(@Body() dto: OnboardUserDto): Promise<OnboardResult> {
    return this.authService.onboard(dto);
  }
}
