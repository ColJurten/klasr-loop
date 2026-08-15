'use client';
import { FormEvent, useEffect, useState } from 'react';

export function SettingsForm() {
  const [key, setKey] = useState(''); const [provider, setProvider] = useState('compatible'); const [model, setModel] = useState(''); const [models, setModels] = useState<Record<string, string[]>>({}); const [status, setStatus] = useState('');
  useEffect(() => { void fetch('/api/llm-settings').then((response) => response.json()).then((body) => setModels(body.providers ?? {})); }, []);
  function update(value: string) { setKey(value); const next = value.startsWith('sk-ant-') ? 'anthropic' : value.startsWith('sk-proj-') || value.startsWith('sk-') ? 'openai' : value.startsWith('La') ? 'mistral' : 'compatible'; setProvider(next); setModel(models[next]?.[0] ?? ''); setStatus(''); }
  async function submit(event: FormEvent) { event.preventDefault(); const response = await fetch('/api/llm-settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: key, model }) }); setStatus(response.ok ? 'Format validé. Clé immédiatement oubliée.' : 'Clé ou modèle invalide.'); if (response.ok) setKey(''); }
  return <form onSubmit={submit} className="mt-6 max-w-xl space-y-5 rounded-lg border border-line bg-white p-5">
    <div><label htmlFor="api-key" className="text-sm font-medium">Clé API</label><input id="api-key" type="password" autoComplete="off" value={key} onChange={(e) => update(e.target.value)} className="mt-2 w-full rounded-lg border border-line px-3 py-2 font-mono text-sm focus:border-lavender-deep focus:outline-none" aria-describedby="key-help" /><p id="key-help" className="mt-2 text-xs text-ink/60">Détection locale : {provider}. La clé est validée puis immédiatement oubliée ; les traitements de production utilisent uniquement la configuration d’environnement.</p></div>
    <div><label htmlFor="model" className="text-sm font-medium">Modèle</label><select id="model" value={model} onChange={(e) => setModel(e.target.value)} className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm">{(models[provider] ?? []).map((item) => <option key={item}>{item}</option>)}</select></div>
    <button disabled={!model} className="rounded-lg bg-lavender px-4 py-2 text-sm font-medium hover:bg-lavender-deep/30 disabled:opacity-50">Valider</button>
    {status && <p role="status" className="rounded-lg border border-sage-deep/35 bg-sage/25 p-3 text-sm">{status}</p>}
  </form>;
}
