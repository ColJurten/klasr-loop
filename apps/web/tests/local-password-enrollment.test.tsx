import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalPasswordEnrollment } from '@/app/dashboard/settings/local-password-enrollment';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('offers eligible users an accessible French enrollment flow with bounded feedback', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ eligible: true }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ enrolled: true }) });
  vi.stubGlobal('fetch', request);
  render(<LocalPasswordEnrollment />);

  expect(await screen.findByRole('heading', { name: 'Ajouter un mot de passe klasr' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'correct horse battery' } });
  fireEvent.change(screen.getByLabelText('Confirmer le mot de passe local'), { target: { value: 'correct horse battery' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter mon mot de passe' }));
  expect((await screen.findByRole('status')).textContent).toContain('Mot de passe ajouté');
  expect(request).toHaveBeenLastCalledWith('/api/auth/enroll-local', expect.objectContaining({ method: 'POST' }));
});

it('keeps ineligible accounts hidden and validates confirmation before sending', async () => {
  const request = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ eligible: false }) });
  vi.stubGlobal('fetch', request);
  const { rerender } = render(<LocalPasswordEnrollment />);
  await screen.findByTestId('local-enrollment-unavailable');
  expect(screen.queryByRole('heading', { name: 'Ajouter un mot de passe klasr' })).toBeNull();

  request.mockReset();
  request.mockResolvedValueOnce({ ok: true, json: async () => ({ eligible: true }) });
  rerender(<LocalPasswordEnrollment key="eligible" />);
  await screen.findByRole('heading', { name: 'Ajouter un mot de passe klasr' });
  fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: 'correct horse battery' } });
  fireEvent.change(screen.getByLabelText('Confirmer le mot de passe local'), { target: { value: 'different secure password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter mon mot de passe' }));
  expect(screen.getByRole('alert').textContent).toContain('ne correspondent pas');
  expect(request).toHaveBeenCalledTimes(1);
});
