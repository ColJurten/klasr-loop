'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { KlasrLogo } from '@/components/logo';

const ERROR_MESSAGES: Record<string, string> = {
  Callback: 'La connexion a échoué. Réessayez.',
  OAuthSignin: 'Impossible de démarrer la connexion. Réessayez.',
  OAuthCallback: 'La connexion a échoué. Réessayez.',
  Default: 'Une erreur est survenue. Réessayez.',
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard';
  const errorCode = searchParams.get('error');
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default) : null;

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <KlasrLogo />
        </div>

        <div className="rounded-lg border border-line bg-white p-8">
          <h1 className="text-center text-lg">Se connecter</h1>
          <p className="mt-2 text-center text-sm text-ink/60">
            Accédez à votre espace klasr avec votre compte professionnel.
          </p>

          {errorMessage && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-peach-deep/30 bg-peach/20 px-3 py-2 text-center text-sm text-peach-deep"
            >
              {errorMessage}
            </p>
          )}

          <div className="mt-6 flex flex-col gap-3">
            {process.env.NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT === 'true' && (
              <button
                type="button"
                onClick={() => signIn('google-service-account-acceptance', { callbackUrl })}
                className="rounded-lg border border-lavender-deep/40 bg-lavender/25 px-4 py-2.5 text-sm hover:border-lavender-deep"
              >
                Validation Google staging
              </button>
            )}
            {process.env.NEXT_PUBLIC_KLASR_LOCAL_MVP === 'true' && (
              <button
                type="button"
                onClick={() => signIn('local-mvp', { callbackUrl })}
                className="rounded-lg border border-peach-deep/40 bg-peach/25 px-4 py-2.5 text-sm hover:border-peach-deep"
              >
                Mode local
              </button>
            )}
            <button
              type="button"
              onClick={() => signIn('google', { callbackUrl })}
              className="rounded-lg border border-line px-4 py-2.5 text-sm hover:border-ink/30"
            >
              Continuer avec Google
            </button>
            <button
              type="button"
              onClick={() => signIn('azure-ad', { callbackUrl })}
              className="rounded-lg border border-line px-4 py-2.5 text-sm hover:border-ink/30"
            >
              Continuer avec Microsoft
            </button>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-ink/60">
          Aucun document stocké chez klasr — seules les métadonnées sont analysées.
        </p>
      </div>
    </div>
  );
}
