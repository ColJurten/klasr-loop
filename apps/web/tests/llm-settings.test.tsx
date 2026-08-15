import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectProvider, modelAllowlist } from '@/lib/llm-settings';
import { SettingsForm } from '@/app/dashboard/settings/settings-form';

afterEach(() => { vi.unstubAllGlobals(); delete process.env.KLASR_ANTHROPIC_MODELS; });

describe('session-only LLM settings', () => {
  it('detects providers without retaining keys and obtains model ids from configuration', () => {
    process.env.KLASR_ANTHROPIC_MODELS = 'model-a, model-b';
    expect(detectProvider('sk-ant-synthetic')).toBe('anthropic');
    expect(detectProvider('LaSyntheticMistral')).toBe('mistral');
    expect(modelAllowlist().anthropic).toEqual(['model-a', 'model-b']);
  });

  it('loads the server allowlist and clears the key after validation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ providers: { anthropic: ['configured-anthropic'] } }) })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock); render(<SettingsForm />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Clé API'), { target: { value: 'sk-ant-synthetic-key' } });
    expect((screen.getByLabelText('Modèle') as HTMLSelectElement).value).toBe('configured-anthropic');
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect((screen.getByLabelText('Clé API') as HTMLInputElement).value).toBe(''));
    expect(fetchMock.mock.calls[1][1].body).toContain('sk-ant-synthetic-key');
  });
});
