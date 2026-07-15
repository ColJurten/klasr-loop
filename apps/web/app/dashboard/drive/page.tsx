import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { DrivePicker } from './drive-picker';

const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: 'La connexion a expiré ou a été interrompue. Réessayez.',
  token_exchange_failed: "Google n'a pas pu confirmer l'autorisation. Réessayez.",
  no_refresh_token: 'Google n’a pas renvoyé d’accès durable. Réessayez.',
  account_lookup_failed: 'Impossible de lire le compte Google connecté. Réessayez.',
};

export default async function DriveConnectPage({
  searchParams,
}: {
  searchParams: { step?: string; connected?: string; error?: string };
}) {
  const session = await getServerSession(authOptions);

  if (session?.user.role !== 'ADMIN') {
    return (
      <main className="p-8">
        <h1 className="text-lg">Connexion Google Drive</h1>
        <p className="mt-2 text-sm text-ink/60">
          Seul un administrateur ou une administratrice de l&apos;organisation peut
          connecter Google Drive.
        </p>
      </main>
    );
  }

  const errorMessage = searchParams.error ? ERROR_MESSAGES[searchParams.error] : null;

  return (
    <main className="p-8">
      <h1 className="text-lg">Connexion Google Drive</h1>
      <p className="mt-2 max-w-md text-sm text-ink/60">
        klasr a besoin d&apos;un accès en lecture/écriture au dossier racine de votre
        classement pour proposer et exécuter les déplacements de documents.
      </p>

      {errorMessage && (
        <p
          role="alert"
          className="mt-4 max-w-md rounded-lg border border-peach-deep/30 bg-peach/20 px-3 py-2 text-sm text-peach-deep"
        >
          {errorMessage}
        </p>
      )}

      {searchParams.connected === '1' && (
        <p className="mt-4 max-w-md rounded-lg border border-line bg-sage/20 px-3 py-2 text-sm">
          Google Drive est connecté.
        </p>
      )}

      {searchParams.step === 'pick' ? (
        <DrivePicker />
      ) : (
        <a
          href="/api/drive/connect"
          className="mt-6 inline-block rounded-lg border border-line px-4 py-2.5 text-sm hover:border-ink/30"
        >
          Connecter Google Drive
        </a>
      )}
    </main>
  );
}
