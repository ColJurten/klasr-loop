import { withAuth } from 'next-auth/middleware';

/**
 * Protects /dashboard/**: unauthenticated requests are redirected to the
 * landing page ('/') rather than NextAuth's default /api/auth/signin.
 */
export default withAuth({
  pages: {
    signIn: '/',
  },
});

export const config = {
  matcher: ['/dashboard/:path*'],
};
