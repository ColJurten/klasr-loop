import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { InternalServiceGuard } from './internal-service.guard';

function contextWithHeaders(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('InternalServiceGuard (fail closed)', () => {
  const ORIGINAL_SECRET = process.env.INTERNAL_API_SECRET;
  let guard: InternalServiceGuard;

  beforeEach(() => {
    guard = new InternalServiceGuard();
  });

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.INTERNAL_API_SECRET;
    } else {
      process.env.INTERNAL_API_SECRET = ORIGINAL_SECRET;
    }
  });

  it('allows the request when the header matches the configured secret exactly', () => {
    process.env.INTERNAL_API_SECRET = 'shared-secret';
    const context = contextWithHeaders({ 'x-internal-secret': 'shared-secret' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws UnauthorizedException when the header is missing', () => {
    process.env.INTERNAL_API_SECRET = 'shared-secret';
    const context = contextWithHeaders({});
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when the header does not match', () => {
    process.env.INTERNAL_API_SECRET = 'shared-secret';
    const context = contextWithHeaders({ 'x-internal-secret': 'wrong-secret' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('fails closed when INTERNAL_API_SECRET is unset, even if a header is sent', () => {
    delete process.env.INTERNAL_API_SECRET;
    const context = contextWithHeaders({ 'x-internal-secret': 'anything' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('fails closed when INTERNAL_API_SECRET is set to an empty string', () => {
    process.env.INTERNAL_API_SECRET = '';
    const context = contextWithHeaders({ 'x-internal-secret': '' });
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });
});
