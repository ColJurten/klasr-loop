import { ExtractedPage } from './extraction.types';

const MAX_CHARS = 20_000;
const KEY_FIELD = /\b(invoice|facture|contrat|contract|receipt|reçu|date|total|montant|tva|vat|siret|iban|référence|reference|n[°o]|€|eur)\b/i;

export function normalizeText(value: string): string {
  return [...value.normalize('NFKC')].map((char) => { const code = char.charCodeAt(0); return (code < 32 && code !== 9 && code !== 10) || code === 127 ? ' ' : char; }).join('')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function normalizePages(pages: ExtractedPage[]): string {
  const normalized = pages.map((page) => ({ ...page, text: normalizeText(page.text) }));
  const counts = new Map<string, number>();
  for (const page of normalized) {
    for (const line of new Set(page.text.split('\n').filter((line) => line.length >= 4))) {
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }
  const furnitureThreshold = Math.max(2, Math.ceil(normalized.length * 0.6));
  const useful = normalized.map((page) => page.text.split('\n').filter((line) => (counts.get(line) ?? 0) < furnitureThreshold).join('\n'));
  const joined = useful.filter(Boolean).join('\n\n--- page ---\n\n');
  if (joined.length <= MAX_CHARS) return joined;
  const keyLines = [...new Set(useful.flatMap((text) => text.split('\n').filter((line) => KEY_FIELD.test(line))))].join('\n');
  const tailBudget = Math.min(2_000, Math.max(0, MAX_CHARS - 12_000 - keyLines.length));
  return [joined.slice(0, 12_000), keyLines, tailBudget ? joined.slice(-tailBudget) : ''].filter(Boolean).join('\n').slice(0, MAX_CHARS);
}

export function qualityFor(text: string): 'ok' | 'sparse' | 'empty' {
  const count = (text.match(/[a-z0-9À-ÿ]/gi) ?? []).length;
  return count === 0 ? 'empty' : count < 20 ? 'sparse' : 'ok';
}
