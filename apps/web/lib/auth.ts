import type { DefaultSession, NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import AzureADProvider from 'next-auth/providers/azure-ad';
import CredentialsProvider from 'next-auth/providers/credentials';

export type MembershipRole = 'ADMIN' | 'MEMBER';

interface OnboardingResult {
  organizationId: string;
  membershipId: string;
  role: MembershipRole;
}

declare module 'next-auth' {
  interface Session {
    user: {
      organizationId: string;
      membershipId: string;
      role: MembershipRole;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    organizationId: string;
    membershipId: string;
    role: MembershipRole;
  }
}

// Matches apps/web/lib/api.ts's API_URL convention exactly.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
const DRIVE_SCOPE = 'openid email profile https://www.googleapis.com/auth/drive';

function localProviderEnabled(): boolean {
  if (process.env.KLASR_LOCAL_MVP !== 'true') return false;
  if (process.env.NODE_ENV === 'production' && process.env.KLASR_ACCEPTANCE_LOCAL_MVP !== 'true') {
    throw new Error('KLASR_LOCAL_MVP cannot run in production');
  }
  return true;
}

/**
 * OAuth Google / Microsoft — the only sign-in paths (product decision).
 * Session carries organizationId; API calls must derive tenant from it,
 * never from client input.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      authorization: {
        params: {
          scope: DRIVE_SCOPE,
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID ?? '',
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET ?? '',
      tenantId: process.env.AZURE_AD_TENANT_ID ?? 'common',
    }),
    ...(localProviderEnabled()
      ? [
          CredentialsProvider({
            id: 'local-mvp',
            name: 'Mode local',
            credentials: {},
            async authorize() {
              return {
                id: 'local-user',
                email: 'camille.local@klasr.test',
                name: 'Camille Local',
              };
            },
          }),
        ]
      : []),
  ],
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    // Custom charte-styled sign-in page (app/login) instead of NextAuth's
    // default unstyled one. NextAuth also routes sign-in errors here via the
    // `error` search param when no separate `pages.error` is set.
    signIn: '/login',
  },
  callbacks: {
    /**
     * `account` is only present on the initial sign-in call — that's when we
     * onboard the user into an organization (auto-create on first sign-in,
     * reuse otherwise). On every subsequent call the token is returned
     * unchanged.
     *
     * Multi-tenant invariant: a session must NEVER exist without an
     * organizationId. If onboarding fails (non-2xx or network error), throw
     * so sign-in fails visibly instead of producing a tenant-less session.
     */
    async jwt({ token, user, account }) {
      if (!account) return token;

      if (!user?.email) {
        throw new Error('OAuth sign-in did not return an email — cannot onboard the user');
      }

      const response = await fetch(`${API_URL}/auth/onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.INTERNAL_API_SECRET ?? '',
        },
        body: JSON.stringify({
          email: user.email,
          displayName: user.name,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          refreshToken: typeof account.refresh_token === 'string' ? account.refresh_token : undefined,
          scopes: typeof account.scope === 'string' ? account.scope.split(' ') : [],
        }),
      });

      if (!response.ok) {
        throw new Error(`Auth onboarding failed with status ${response.status}`);
      }

      const onboarding = (await response.json()) as OnboardingResult;
      token.organizationId = onboarding.organizationId;
      token.membershipId = onboarding.membershipId;
      token.role = onboarding.role;

      return token;
    },
    async session({ session, token }) {
      session.user.organizationId = token.organizationId;
      session.user.membershipId = token.membershipId;
      session.user.role = token.role;
      return session;
    },
  },
};
