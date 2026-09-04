import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsForm } from '@/app/dashboard/settings/settings-form';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (body: object, ok = true) => ({ ok, json: async () => body });

describe('tenant LLM settings', () => {
  it('discovers, selects a non-default model, saves, clears the key and reloads a safe summary', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ configured: false }))
      .mockResolvedValueOnce(response({ models: ['fixture-a', 'fixture-z'] }))
      .mockResolvedValueOnce(response({ configured: true, provider: 'openai-compatible', model: 'fixture-z', baseUrl: 'http://127.0.0.1:4321/v1', validatedAt: '2026-08-16T12:00:00Z', status: 'VALID' }));
    vi.stubGlobal('fetch', fetchMock); render(<SettingsForm />);
    await screen.findByText(/Aucune clé configurée/);
    const providers = screen.getByRole('radiogroup', { name: 'Fournisseur' });
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    const compatible = screen.getByRole('radio', { name: 'Compatible' });
    fireEvent.click(compatible);
    expect((compatible as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText('URL de base'), { target: { value: 'http://127.0.0.1:4321/v1' } });
    fireEvent.change(screen.getByLabelText('Clé API'), { target: { value: 'synthetic-fixture-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Découvrir les modèles' }));
    await screen.findByText('2 modèles disponibles.');
    fireEvent.change(screen.getByLabelText('Modèle'), { target: { value: 'fixture-z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider et enregistrer' }));
    await screen.findByText('Configuration validée et enregistrée.');
    expect((screen.getByLabelText('Clé API') as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Compatible OpenAI · fixture-z')).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ provider: 'openai-compatible', model: 'fixture-z' });
    expect(providers).toBeTruthy();
  });

  it('moves provider selection with arrow keys and conditionally requires the compatible URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ configured: false })));
    render(<SettingsForm />);
    await screen.findByText(/Aucune clé configurée/);
    const anthropic = screen.getByRole('radio', { name: 'Anthropic' });
    anthropic.focus();
    fireEvent.keyDown(anthropic, { key: 'ArrowRight' });
    expect((screen.getByRole('radio', { name: 'OpenAI' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Compatible' }));
    expect((screen.getByLabelText('URL de base') as HTMLInputElement).required).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Mistral' }));
    expect(screen.queryByLabelText('URL de base')).toBeNull();
  });

  it('supports manual compatible model, actionable errors, loading locks, and delete', async () => {
    let finish!: (value: unknown) => void;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ configured: true, provider: 'anthropic', model: 'configured-model', validatedAt: '2026-08-16T12:00:00Z' }))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValueOnce(response({ error: 'Clé API refusée par le fournisseur.' }, false))
      .mockResolvedValueOnce(response({ configured: false }));
    vi.stubGlobal('fetch', fetchMock); render(<SettingsForm />);
    await screen.findByText('Anthropic · configured-model');
    fireEvent.change(screen.getByLabelText('Clé API'), { target: { value: 'synthetic-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Découvrir les modèles' }));
    expect((screen.getByRole('button', { name: 'Découvrir les modèles' }) as HTMLButtonElement).disabled).toBe(true);
    finish(response({ error: 'Découverte indisponible.' }, false));
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('Modèle'), { target: { value: 'manual-model' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remplacer et enregistrer' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Clé API refusée');
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer la configuration' }));
    await waitFor(() => expect(screen.queryByLabelText('Configuration active')).toBeNull());
    expect(screen.getByRole('status').textContent).toContain('Configuration supprimée');
  });
});
