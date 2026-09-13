'use client';
import { FormEvent, useState } from 'react';
import Image from 'next/image';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { KlasrLogo } from '@/components/logo';

const SSO_ERRORS: Record<string, string> = { Callback: 'La connexion SSO a échoué. Réessayez.', OAuthSignin: 'Impossible de démarrer la connexion SSO. Réessayez.', OAuthCallback: 'La connexion SSO a échoué. Réessayez.', OAuthAccountNotLinked: 'Ce compte ne peut pas être lié sans adresse e-mail vérifiée.', Default: 'Une erreur de connexion est survenue. Réessayez.' };

export function LoginForm() {
  const searchParams = useSearchParams();
  const rawCallbackUrl = searchParams.get('callbackUrl');
  const callbackUrl = rawCallbackUrl?.startsWith('/') && !rawCallbackUrl.startsWith('//') && !rawCallbackUrl.startsWith('/\\') ? rawCallbackUrl : '/dashboard';
  const errorCode = searchParams.get('error');
  const [signup, setSignup] = useState(false);
  const [error, setError] = useState(errorCode ? (SSO_ERRORS[errorCode] ?? SSO_ERRORS.Default) : '');
  const [busy, setBusy] = useState(false);
  const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const data = Object.fromEntries(new FormData(event.currentTarget));
    if (signup && data.password !== data.confirmation) { setError('Les mots de passe ne correspondent pas.'); setBusy(false); return; }
    if (signup) {
      const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: data.email, password: data.password, displayName: data.displayName }) });
      if (!response.ok) { const body = await response.json() as { code?: string }; setError(body.code === 'email_registered' ? 'Cette adresse e-mail est déjà enregistrée.' : 'Impossible de créer le compte. Vérifiez les informations.'); setBusy(false); return; }
    }
    const result = await signIn('credentials', { email: data.email, password: data.password, callbackUrl, redirect: false });
    if (result?.error) { setError('Adresse e-mail ou mot de passe incorrect.'); setBusy(false); return; }
    window.location.assign(result?.url ?? callbackUrl);
  }

  return <main className="flex min-h-screen items-center justify-center px-4 py-8"><div className="w-full max-w-sm">
    <div className="mb-6 flex justify-center"><KlasrLogo /></div><div className="rounded-lg border border-line bg-white p-6 sm:p-8">
      <h1 className="text-center text-lg">{signup ? 'Créer un compte' : 'Se connecter'}</h1><p className="mt-2 text-center text-sm text-ink/70">Accédez à votre espace klasr avec votre compte professionnel.</p>
      {error && <p role="alert" className="mt-4 rounded-lg border border-peach-deep bg-peach/20 px-3 py-2 text-center text-sm text-ink">{error}</p>}
      <form className="mt-6 space-y-4" onSubmit={submit}>
        {signup && <Field id="displayName" label="Nom affiché" autoComplete="name" />}
        <Field id="email" label="Adresse e-mail" type="email" autoComplete="email" maxLength={254} />
        <Field id="password" label="Mot de passe" type="password" autoComplete={signup ? 'new-password' : 'current-password'} minLength={12} maxLength={128} />
        {signup && <Field id="confirmation" label="Confirmer le mot de passe" type="password" autoComplete="new-password" minLength={12} maxLength={128} />}
        <button disabled={busy} className={`w-full rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 ${focus}`}>{signup ? 'Créer mon compte' : 'Se connecter'}</button>
      </form>
      <button type="button" onClick={() => { setSignup(!signup); setError(''); }} className={`mt-3 w-full text-sm underline underline-offset-4 ${focus}`}>{signup ? 'J’ai déjà un compte' : 'Créer un compte'}</button>
      <div className="my-5 flex items-center gap-3 text-xs text-ink/70" aria-label="ou"><span className="h-px flex-1 bg-line" /><span>ou</span><span className="h-px flex-1 bg-line" /></div>
      <div className="space-y-3"><Provider id="google" label="Google" icon="google.svg" callbackUrl={callbackUrl} colors="border-[#747775] text-[#1F1F1F]" /><button type="button" disabled aria-describedby="microsoft-disabled-reason" className="flex w-full items-center justify-center gap-3 rounded-lg border border-[#8C8C8C] bg-white px-4 py-2.5 text-sm text-[#5E5E5E] disabled:cursor-not-allowed disabled:opacity-70"><Image src="/brands/microsoft.svg" alt="" width={18} height={18} />Continuer avec Microsoft — Bientôt disponible</button><p id="microsoft-disabled-reason" className="text-center text-xs text-ink/70">La liaison sûre attend une preuve de propriété vérifiée par Microsoft.</p></div>
      {process.env.NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT === 'true' && <button type="button" onClick={() => void signIn('google-service-account-acceptance', { callbackUrl })} className={`mt-3 w-full rounded-lg border border-lavender-deep bg-lavender/25 px-4 py-2.5 text-sm ${focus}`}>Validation Google staging</button>}
      {process.env.NEXT_PUBLIC_KLASR_LOCAL_MVP === 'true' && <button type="button" onClick={() => void signIn('local-mvp', { callbackUrl })} className={`mt-3 w-full rounded-lg border border-peach-deep bg-peach/25 px-4 py-2.5 text-sm ${focus}`}>Mode local</button>}
    </div><p className="mt-6 text-center text-xs text-ink/70">Aucun document stocké chez klasr — seules les métadonnées sont analysées.</p>
  </div></main>;
}

function Field({ id, label, ...props }: { id: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) { return <div><label className="text-sm font-medium" htmlFor={id}>{label}</label><input className="mt-1 w-full rounded-lg border border-line px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" id={id} name={id} required {...props} /></div>; }
function Provider({ id, label, icon, callbackUrl, colors }: { id: string; label: string; icon: string; callbackUrl: string; colors: string }) { return <button type="button" onClick={() => void signIn(id, { callbackUrl })} className={`flex w-full items-center justify-center gap-3 rounded-lg border bg-white px-4 py-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${colors}`}><Image src={`/brands/${icon}`} alt="" width={18} height={18} />Continuer avec {label}</button>; }
