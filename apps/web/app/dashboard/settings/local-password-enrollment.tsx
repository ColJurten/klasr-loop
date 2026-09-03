'use client';
import { FormEvent, useEffect, useState } from 'react';

export function LocalPasswordEnrollment() {
  const [eligible, setEligible] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { void fetch('/api/auth/enroll-local').then(async response => setEligible(response.ok && (await response.json()).eligible === true)).catch(() => setEligible(false)); }, []);
  if (eligible !== true) return message
    ? <p role="status" className="mt-6 max-w-xl rounded-lg border border-sage-deep/35 bg-sage/25 p-3 text-sm">{message}</p>
    : <span data-testid="local-enrollment-unavailable" className="sr-only" />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage('');
    const form = event.currentTarget;
    const data = new FormData(form);
    if (data.get('password') !== data.get('confirmation')) { setError('Les mots de passe ne correspondent pas.'); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/auth/enroll-local', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: data.get('password') }) });
      if (!response.ok) throw new Error();
      form.reset(); setEligible(false); setMessage('Mot de passe ajouté. Vous pourrez l’utiliser à votre prochaine connexion.');
    } catch { setError('Impossible d’ajouter le mot de passe. Il existe peut-être déjà.'); }
    finally { setBusy(false); }
  }

  return <section className="mt-6 max-w-xl rounded-lg border border-line bg-white p-5" aria-labelledby="local-password-title">
    <h2 id="local-password-title" className="text-lg font-medium">Ajouter un mot de passe klasr</h2>
    <p className="mt-2 text-sm text-ink/65">Ajoutez une connexion locale à ce compte Google vérifié.</p>
    <form onSubmit={submit} className="mt-4 space-y-4">
      <PasswordField id="local-password" name="password" label="Nouveau mot de passe" />
      <PasswordField id="local-password-confirmation" name="confirmation" label="Confirmer le mot de passe local" />
      <button disabled={busy} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60">Ajouter mon mot de passe</button>
    </form>
    {message && <p role="status" className="mt-4 rounded-lg border border-sage-deep/35 bg-sage/25 p-3 text-sm">{message}</p>}
    {error && <p role="alert" className="mt-4 rounded-lg border border-peach-deep bg-peach/20 p-3 text-sm">{error}</p>}
  </section>;
}

function PasswordField({ id, name, label }: { id: string; name: string; label: string }) {
  return <div><label htmlFor={id} className="text-sm font-medium">{label}</label><input id={id} name={name} type="password" minLength={12} maxLength={128} required autoComplete="new-password" className="mt-1 w-full rounded-lg border border-line px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" /></div>;
}
