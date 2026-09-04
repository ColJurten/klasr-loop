'use client';
import { FormEvent, useEffect, useState } from 'react';
import Image from 'next/image';

type Provider = 'anthropic' | 'openai' | 'mistral' | 'openai-compatible';
interface Configured { configured: boolean; provider?: Provider; model?: string; baseUrl?: string; validatedAt?: string; status?: string; }
const labels: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', mistral: 'Mistral', 'openai-compatible': 'Compatible OpenAI' };
const providers: Array<{ value: Provider; label: string; accent: string }> = [
  { value: 'anthropic', label: 'Anthropic', accent: '#D97757' }, { value: 'openai', label: 'OpenAI', accent: '#000000' },
  { value: 'mistral', label: 'Mistral', accent: '#FF7000' }, { value: 'openai-compatible', label: 'Compatible', accent: '#525252' },
];

export function SettingsForm() {
  const [provider, setProvider] = useState<Provider>('anthropic'); const [baseUrl, setBaseUrl] = useState(''); const [key, setKey] = useState('');
  const [model, setModel] = useState(''); const [models, setModels] = useState<string[]>([]); const [configured, setConfigured] = useState<Configured>({ configured: false });
  const [busy, setBusy] = useState(false); const [status, setStatus] = useState('Chargement…'); const [error, setError] = useState('');
  useEffect(() => { void load(); }, []);
  async function load() { setBusy(true); try { const response = await fetch('/api/llm-settings'); const body = await response.json(); if (!response.ok) throw new Error(body.error); setConfigured(body); setStatus(body.configured ? 'Configuration active.' : 'Aucune clé configurée. Le fournisseur d’environnement sera utilisé.'); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  function changeProvider(value: Provider) { setProvider(value); setModels([]); setModel(''); setError(''); setStatus(''); }
  function moveProvider(event: React.KeyboardEvent<HTMLInputElement>) { const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0; if (!delta) return; event.preventDefault(); const next = providers[(providers.findIndex((item) => item.value === provider) + delta + providers.length) % providers.length].value; changeProvider(next); requestAnimationFrame(() => document.getElementById(`provider-${next}`)?.focus()); }
  async function discover() { setBusy(true); setError(''); setStatus('Découverte des modèles…'); try { const body = await request('POST', payload()); setModels(body.models); setModel(body.models[0] ?? ''); setStatus(`${body.models.length} modèles disponibles.`); } catch (e) { setError(message(e)); setStatus(''); } finally { setBusy(false); } }
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); setStatus('Validation du modèle…'); try { const body = await request('PUT', payload()); setConfigured(body); setKey(''); setStatus('Configuration validée et enregistrée.'); } catch (e) { setError(message(e)); setStatus(''); } finally { setBusy(false); } }
  async function remove() { setBusy(true); setError(''); try { await request('DELETE'); setConfigured({ configured: false }); setModels([]); setModel(''); setStatus('Configuration supprimée. Le fournisseur d’environnement sera utilisé.'); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  function payload() { return { provider, apiKey: key, model: model || undefined, baseUrl: provider === 'openai-compatible' ? baseUrl : undefined }; }
  return <div className="mt-6 max-w-xl space-y-5">
    {configured.configured && <section aria-label="Configuration active" className="rounded-lg border border-sage-deep/35 bg-sage/20 p-4 text-sm"><p className="flex items-center gap-2 font-medium"><Image src={`/brands/${configured.provider}.svg`} alt={labels[configured.provider!]} width={24} height={24} />{labels[configured.provider!]} · {configured.model}</p><p className="mt-1 text-ink/65">Validée le {configured.validatedAt ? new Date(configured.validatedAt).toLocaleString('fr-FR') : '—'} · clé enregistrée : oui</p><button type="button" onClick={() => void remove()} disabled={busy} className="mt-3 rounded-lg border border-line px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">Supprimer la configuration</button></section>}
    <form onSubmit={save} className="space-y-5 rounded-lg border border-line bg-white p-5">
      <fieldset><legend className="text-sm font-medium">Fournisseur</legend><div role="radiogroup" aria-label="Fournisseur" className="mt-2 grid grid-cols-2 gap-3">{providers.map((item) => <label key={item.value} style={{ borderColor: provider === item.value ? item.accent : undefined }} className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-line bg-white p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2"><input id={`provider-${item.value}`} type="radio" name="provider" value={item.value} checked={provider === item.value} disabled={busy} onChange={() => changeProvider(item.value)} onKeyDown={moveProvider} className="sr-only" /><Image src={`/brands/${item.value}.svg`} alt="" width={28} height={28} /><span className="text-sm font-medium">{item.label}</span></label>)}</div></fieldset>
      {provider === 'openai-compatible' && <div><label htmlFor="base-url" className="text-sm font-medium">URL de base</label><input id="base-url" type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://fournisseur.example/v1" className="mt-2 w-full rounded-lg border border-line px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" /></div>}
      <div><label htmlFor="api-key" className="text-sm font-medium">Clé API</label><input id="api-key" type="password" required autoComplete="new-password" value={key} onChange={(e) => setKey(e.target.value)} className="mt-2 w-full rounded-lg border border-line px-3 py-2 font-mono text-sm" /><p className="mt-2 text-xs text-ink/60">La clé ne sera plus affichée après l’enregistrement.</p></div>
      <button type="button" onClick={() => void discover()} disabled={busy || !key || provider === 'openai-compatible' && !baseUrl} className="rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-50">Découvrir les modèles</button>
      <div><label htmlFor="model" className="text-sm font-medium">Modèle</label>{models.length ? <select id="model" value={model} onChange={(e) => setModel(e.target.value)} className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2">{models.map((item) => <option key={item}>{item}</option>)}</select> : <input id="model" value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider === 'openai-compatible' ? 'Saisie manuelle si la découverte est indisponible' : 'Découvrez les modèles'} className="mt-2 w-full rounded-lg border border-line px-3 py-2" />}</div>
      <button disabled={busy || !key || !model} className="rounded-lg bg-lavender px-4 py-2 text-sm font-medium hover:bg-lavender-deep/30 disabled:opacity-50">{configured.configured ? 'Remplacer et enregistrer' : 'Valider et enregistrer'}</button>
    </form>
    {status && <p role="status" className="rounded-lg border border-sage-deep/35 bg-sage/25 p-3 text-sm">{status}</p>}
    {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  </div>;
}
async function request(method: string, body?: object) { const response = await fetch('/api/llm-settings', { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Opération impossible.'); return data; }
function message(error: unknown) { return error instanceof Error ? error.message : 'Opération impossible.'; }
