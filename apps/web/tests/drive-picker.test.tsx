import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// The real next/script defers loading a remote URL — not exercisable in
// jsdom. Stand in for "the script loaded" by calling onLoad synchronously.
vi.mock('next/script', () => ({
  default: ({ onLoad }: { onLoad?: () => void }) => {
    // Deferred to a microtask so this doesn't setState synchronously during
    // DrivePicker's own render (the real next/script only fires onLoad after
    // the script tag has actually loaded, i.e. always post-render).
    Promise.resolve().then(() => onLoad?.());
    return null;
  },
}));

import { DrivePicker } from '@/app/dashboard/drive/drive-picker';

const mockedFetch = vi.fn();
vi.stubGlobal('fetch', mockedFetch);

beforeEach(() => {
  // Google's Picker script sets these globals — stand in for "picker ready".
  (window as unknown as { gapi: unknown }).gapi = {
    load: (_lib: string, callback: () => void) => callback(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DrivePicker', () => {
  it('keeps the pick button disabled until the access token has loaded', async () => {
    mockedFetch.mockReturnValue(new Promise(() => {})); // never resolves

    render(<DrivePicker />);

    const button = screen.getByRole('button', { name: /choisir le dossier racine/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables the pick button once the access token is fetched and the picker script is ready', async () => {
    mockedFetch.mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'at' }) });

    render(<DrivePicker />);

    await waitFor(() => {
      const button = screen.getByRole('button', { name: /choisir le dossier racine/i });
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('shows an error and keeps the button disabled when the token fetch fails', async () => {
    mockedFetch.mockResolvedValue({ ok: false });

    render(<DrivePicker />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeDefined());
    const button = screen.getByRole('button', { name: /choisir le dossier racine/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
