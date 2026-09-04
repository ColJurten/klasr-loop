import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageOnboarding } from '@/app/dashboard/storage-onboarding';

const signIn = vi.fn();
vi.mock('next-auth/react', () => ({ signIn: (...args: unknown[]) => signIn(...args) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Cloud storage onboarding', () => {
  it('opens the real providers and launches the existing Google OAuth route', () => {
    render(<StorageOnboarding />);
    expect(screen.queryByRole('button', { name: 'Google Drive' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Connecter' }));
    const google = screen.getByRole('button', { name: 'Google Drive' });
    const oneDrive = screen.getByRole('button', { name: /OneDrive Bientôt disponible/ });
    expect(google.querySelector('img')?.getAttribute('src')).toContain('google-drive.svg');
    expect(oneDrive.querySelector('img')?.getAttribute('src')).toContain('onedrive.svg');
    expect(oneDrive).toHaveProperty('disabled', true);

    fireEvent.click(google);
    expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/dashboard' });
  });
});
