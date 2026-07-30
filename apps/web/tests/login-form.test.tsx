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
    expect(alert.textContent).toBe('La connexion a échoué. Réessayez.');
  });

  it('falls back to the default message for an unmapped error code', () => {
    setSearchParams({ error: 'SomeUnknownCode' });
    render(<LoginForm />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Une erreur est survenue. Réessayez.');
  });
});

describe('LoginForm — provider sign-in', () => {
  it('signs in with Google using the callbackUrl from the query string', () => {
    setSearchParams({ callbackUrl: '/dashboard/history' });
    render(<LoginForm />);

    fireEvent.click(screen.getByText('Continuer avec Google'));

    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard/history' });
  });

  it('signs in with Microsoft using the callbackUrl from the query string', () => {
    setSearchParams({ callbackUrl: '/dashboard/history' });
    render(<LoginForm />);

    fireEvent.click(screen.getByText('Continuer avec Microsoft'));

    expect(signIn).toHaveBeenCalledWith('azure-ad', { callbackUrl: '/dashboard/history' });
  });

  it('defaults the callbackUrl to /dashboard when the query param is absent', () => {
    setSearchParams({});
    render(<LoginForm />);

    fireEvent.click(screen.getByText('Continuer avec Google'));

    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard' });
  });
});
