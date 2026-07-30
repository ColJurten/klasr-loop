import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Payload posted by the web app's NextAuth jwt() callback on first sign-in.
 * `provider` is accepted/validated for traceability even though it is not
 * persisted yet — no Membership/User column exists for it today.
 */
export class OnboardUserDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsString()
  @IsNotEmpty()
  provider!: string;

  @IsOptional()
  @IsString()
  providerAccountId?: string;

  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsOptional()
  @IsString({ each: true })
  scopes?: string[];
}
