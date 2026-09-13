import { Body, Controller, Get, Headers, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthService, OnboardResult } from './auth.service';
import { OnboardUserDto } from './dto/onboard-user.dto';
import { EnrollLocalPasswordDto, LocalCredentialsDto, RegisterLocalDto } from './dto/local-credentials.dto';
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

  @Post('register')
  register(@Body() dto: RegisterLocalDto): Promise<OnboardResult> {
    return this.authService.register(dto);
  }

  @Post('credentials')
  authenticate(@Body() dto: LocalCredentialsDto): Promise<OnboardResult | null> {
    return this.authService.authenticate(dto);
  }

  @Get('local-password')
  localPasswordEligibility(
    @Headers('x-user-id') userId: string,
    @Headers('x-organization-id') organizationId: string,
    @Headers('x-membership-id') membershipId: string,
  ): Promise<{ eligible: boolean }> {
    return this.authService.localPasswordEligibility(requireSessionIdentity(userId, organizationId, membershipId));
  }

  @Post('local-password')
  enrollLocalPassword(
    @Headers('x-user-id') userId: string,
    @Headers('x-organization-id') organizationId: string,
    @Headers('x-membership-id') membershipId: string,
    @Body() dto: EnrollLocalPasswordDto,
  ): Promise<{ enrolled: true }> {
    return this.authService.enrollLocalPassword(requireSessionIdentity(userId, organizationId, membershipId), dto.password);
  }
}

function requireSessionIdentity(userId?: string, organizationId?: string, membershipId?: string) {
  if (!userId || !organizationId || !membershipId) throw new UnauthorizedException('authenticated_session_required');
  return { userId, organizationId, membershipId };
}
