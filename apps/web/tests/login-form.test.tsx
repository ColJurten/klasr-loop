import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const signIn = vi.fn();
vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => signIn(...args),
}));

const searchParamsGet = vi.fn();
vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => searchParamsGet(key) }),
}));

import { LoginForm } from '@/app/login/login-form';

function setSearchParams(params: Record<string, string>) {
  searchParamsGet.mockImplementation((key: string) => params[key] ?? null);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('LoginForm — error banner', () => {
  it('renders no error banner when there is no error param', () => {
    setSearchParams({});
    render(<LoginForm />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the mapped message for a known error code', () => {
    setSearchParams({ error: 'Callback' });
    render(<LoginForm />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('La connexion SSO a échoué. Réessayez.');
  });

  it('falls back to the default message for an unmapped error code', () => {
    setSearchParams({ error: 'SomeUnknownCode' });
    render(<LoginForm />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Une erreur de connexion est survenue. Réessayez.');
  });
});

describe('LoginForm — provider sign-in', () => {
  it('hides the staging acceptance provider by default', () => {
    vi.stubEnv('NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT', 'false');
    setSearchParams({});
    render(<LoginForm />);

    expect(screen.queryByRole('button', { name: 'Validation Google staging' })).toBeNull();
  });

  it('wires the staging acceptance provider only under its public flag', () => {
    vi.stubEnv('NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT', 'true');
    setSearchParams({ callbackUrl: '/dashboard/history' });
    render(<LoginForm />);

    fireEvent.click(screen.getByRole('button', { name: 'Validation Google staging' }));

    expect(signIn).toHaveBeenCalledWith('google-service-account-acceptance', { callbackUrl: '/dashboard/history' });
  });

  it('offers the local sign-in lifecycle from the visible form', () => {
    setSearchParams({});
    render(<LoginForm />);

    expect(screen.getByLabelText('Adresse e-mail')).toBeTruthy();
    expect(screen.getByLabelText('Mot de passe')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Créer un compte' })).toBeTruthy();
  });

  it('signs in with Google using the callbackUrl from the query string', () => {
    setSearchParams({ callbackUrl: '/dashboard/history' });
    render(<LoginForm />);

    fireEvent.click(screen.getByText('Continuer avec Google'));

    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard/history' });
  });

  it('keeps Microsoft visible but disabled with an accessible ownership explanation', () => {
    setSearchParams({ callbackUrl: '/dashboard/history' });
    render(<LoginForm />);

    const microsoft = screen.getByRole('button', { name: /Microsoft.*Bientôt disponible/ });
    expect(microsoft).toHaveProperty('disabled', true);
    expect(microsoft.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText(/liaison sûre.*propriété/i)).toBeTruthy();
    fireEvent.click(microsoft);
    fireEvent.keyDown(microsoft, { key: 'Enter' });
    fireEvent.keyDown(microsoft, { key: ' ' });

    expect(signIn).not.toHaveBeenCalled();
  });

  it('defaults the callbackUrl to /dashboard when the query param is absent', () => {
    setSearchParams({});
    render(<LoginForm />);

    fireEvent.click(screen.getByText('Continuer avec Google'));

    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard' });
  });

  it('replaces an unsafe callbackUrl with /dashboard', () => {
    setSearchParams({ callbackUrl: 'https://attacker.example/steal' });
    render(<LoginForm />);

    fireEvent.click(screen.getByText('Continuer avec Google'));

    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard' });
  });
});

describe('LoginForm — local errors', () => {
  it('shows the exact French wrong-password message', async () => {
    setSearchParams({});
    signIn.mockResolvedValue({ error: 'CredentialsSignin' });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'local@example.com' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'wrong password!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Adresse e-mail ou mot de passe incorrect.');
  });

  it('shows the exact French already-registered message', async () => {
    setSearchParams({});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ code: 'email_registered' }) }));
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer un compte' }));
    fireEvent.change(screen.getByLabelText('Nom affiché'), { target: { value: 'Marie' } });
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'oauth@example.com' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Cette adresse e-mail est déjà enregistrée.');
  });

  it('shows the exact French confirmation-mismatch message without registering', async () => {
    setSearchParams({});
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer un compte' }));
    fireEvent.change(screen.getByLabelText('Nom affiché'), { target: { value: 'Marie' } });
    fireEvent.change(screen.getByLabelText('Adresse e-mail'), { target: { value: 'marie@example.com' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByLabelText('Confirmer le mot de passe'), { target: { value: 'different password!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Les mots de passe ne correspondent pas.');
    expect(request).not.toHaveBeenCalled();
  });
});
