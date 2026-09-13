import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.fn();
vi.mock('next-auth/react', () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}));

import { SignOutButton } from '@/app/dashboard/sign-out-button';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SignOutButton', () => {
  it('signs the user out and redirects to the landing page on click', () => {
    render(<SignOutButton />);

    fireEvent.click(screen.getByText('Se déconnecter'));

    expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
  });
});
