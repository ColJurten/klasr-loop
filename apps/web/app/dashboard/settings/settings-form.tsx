'use client';
import { FormEvent, useEffect, useState } from 'react';

type Provider = 'anthropic' | 'openai' | 'mistral' | 'openai-compatible';
interface Configured { configured: boolean; provider?: Provider; model?: string; baseUrl?: string; validatedAt?: string; status?: string; }
const labels: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', mistral: 'Mistral', 'openai-compatible': 'Compatible OpenAI' };

export function SettingsForm() {
  const [provider, setProvider] = useState<Provider>('anthropic'); const [baseUrl, setBaseUrl] = useState(''); const [key, setKey] = useState('');
  const [model, setModel] = useState(''); const [models, setModels] = useState<string[]>([]); const [configured, setConfigured] = useState<Configured>({ configured: false });
  const [busy, setBusy] = useState(false); const [status, setStatus] = useState('Chargement…'); const [error, setError] = useState('');
  useEffect(() => { void load(); }, []);
  async function load() { setBusy(true); try { const response = await fetch('/api/llm-settings'); const body = await response.json(); if (!response.ok) throw new Error(body.error); setConfigured(body); setStatus(body.configured ? 'Configuration active.' : 'Aucune clé configurée. Le fournisseur d’environnement sera utilisé.'); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  function changeProvider(value: Provider) { setProvider(value); setModels([]); setModel(''); setError(''); setStatus(''); }
  async function discover() { setBusy(true); setError(''); setStatus('Découverte des modèles…'); try { const body = await request('POST', payload()); setModels(body.models); setModel(body.models[0] ?? ''); setStatus(`${body.models.length} modèles disponibles.`); } catch (e) { setError(message(e)); setStatus(''); } finally { setBusy(false); } }
  async function save(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); setStatus('Validation du modèle…'); try { const body = await request('PUT', payload()); setConfigured(body); setKey(''); setStatus('Configuration validée et enregistrée.'); } catch (e) { setError(message(e)); setStatus(''); } finally { setBusy(false); } }
  async function remove() { setBusy(true); setError(''); try { await request('DELETE'); setConfigured({ configured: false }); setModels([]); setModel(''); setStatus('Configuration supprimée. Le fournisseur d’environnement sera utilisé.'); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  function payload() { return { provider, apiKey: key, model: model || undefined, baseUrl: provider === 'openai-compatible' ? baseUrl : undefined }; }
  return <div className="mt-6 max-w-xl space-y-5">
    {configured.configured && <section aria-label="Configuration active" className="rounded-lg border border-sage-deep/35 bg-sage/20 p-4 text-sm"><p className="font-medium">{labels[configured.provider!]} · {configured.model}</p><p className="mt-1 text-ink/65">Validée le {configured.validatedAt ? new Date(configured.validatedAt).toLocaleString('fr-FR') : '—'} · clé enregistrée : oui</p><button type="button" onClick={() => void remove()} disabled={busy} className="mt-3 rounded-lg border border-line px-3 py-2 disabled:opacity-50">Supprimer la configuration</button></section>}
    <form onSubmit={save} className="space-y-5 rounded-lg border border-line bg-white p-5">
      <div><label htmlFor="provider" className="text-sm font-medium">Fournisseur</label><select id="provider" value={provider} onChange={(e) => changeProvider(e.target.value as Provider)} disabled={busy} className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2">{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {provider === 'openai-compatible' && <div><label htmlFor="base-url" className="text-sm font-medium">Adresse de base</label><input id="base-url" type="url" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://fournisseur.example/v1" className="mt-2 w-full rounded-lg border border-line px-3 py-2" /></div>}
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
