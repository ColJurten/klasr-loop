import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

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
    const providedHeader = request.headers['x-internal-secret'];
    const providedSecret = Array.isArray(providedHeader) ? providedHeader[0] : providedHeader;

    if (
      !expectedSecret ||
      typeof providedSecret !== 'string' ||
      !secretsMatch(expectedSecret, providedSecret)
    ) {
      throw new UnauthorizedException('Invalid internal service credentials');
    }

    return true;
  }
}

/**
 * Constant-time comparison via fixed-length SHA-256 digests. This is the
 * sole gate in front of organization-minting, so a plain `!==` (which can
 * leak timing information proportional to the matching prefix length, and
 * whose runtime also varies with string length) is not good enough. Hashing
 * first also sidesteps `timingSafeEqual`'s requirement that both buffers be
 * the same length — a differing length would otherwise throw instead of
 * failing closed.
 */
function secretsMatch(expected: string, provided: string): boolean {
  const expectedHash = createHash('sha256').update(expected).digest();
  const providedHash = createHash('sha256').update(provided).digest();
  return timingSafeEqual(expectedHash, providedHash);
}
