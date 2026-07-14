import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Fail-closed guard for internal-service-only endpoints.
 *
 * The auth onboarding endpoint mints an organization from a bare email with
 * no other verification (no password, no OAuth token check at this layer —
 * that already happened in NextAuth before this call is made). It must
 * NEVER be reachable without the shared secret, so any ambiguity (missing
 * env var, missing header, mismatch) fails closed with UnauthorizedException.
 *
 * Never log the secret or the header value.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedSecret = process.env.INTERNAL_API_SECRET;
    const request = context.switchToHttp().getRequest<RequestWithHeaders>();
    const providedSecret = request.headers['x-internal-secret'];

    if (!expectedSecret || providedSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid internal service credentials');
    }

    return true;
  }
}
