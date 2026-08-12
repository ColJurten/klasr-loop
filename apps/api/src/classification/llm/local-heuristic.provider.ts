/**
 * Heuristic "local model": keyword scoring against folder path segments.
 * First stage of the cascade (eco-design).
 */
import { LlmClassification, LlmProvider } from './provider';

const MIN_CONFIDENCE = 0.55;
const FALLBACK_MIN_SCORE = 0.25;

function normalize(text: string): string {
  return text
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokenize(text: string): Set<string> {
  return new Set(normalize(text).match(/[a-z0-9]{3,}/g) ?? []);
}

/** Prefix tolerance handles singular/plural ("releve" vs "releves"). */
function tokenHits(part: string, tokens: Set<string>): boolean {
  for (const token of tokens) {
    if (token === part) return true;
    if (part.length >= 4 && token.startsWith(part)) return true;
    if (token.length >= 4 && part.startsWith(token)) return true;
  }
  return false;
}

export class LocalHeuristicProvider implements LlmProvider {
  readonly name = 'local';

  async classify(params: {
    documentText: string;
    filename: string;
    folderPaths: string[];
  }): Promise<LlmClassification | null> {
    const tokens = tokenize(params.documentText);
    const ranked = rankFolderPaths(params.folderPaths, tokens);
    const best = chooseBestRankedPath(ranked);
    if (!best || best.score < MIN_CONFIDENCE) return null;
    const filename = inferFilename(params.documentText, params.filename);
    return {
      proposedName: filename.name,
      destinationPath: best.path,
      confidence: Math.round(Math.min(best.score, 0.8) * 100) / 100,
      filenameConfidence: filename.hasDocumentSignals ? 0.7 : 0.35,
      destinationConfidence: Math.round(Math.min(best.score, 0.8) * 100) / 100,
      reviewRequired: !filename.hasDocumentSignals,
      reviewReason: !filename.hasDocumentSignals ? 'Nom à vérifier: signaux documentaires insuffisants' : undefined,
    };
  }
}

export async function deterministicLocalFallback(params: {
  documentText: string;
  filename: string;
  folderPaths: string[];
}): Promise<LlmClassification | null> {
  const tokens = tokenize(params.documentText);
  const ranked = rankFolderPaths(params.folderPaths, tokens);
  const best = chooseBestRankedPath(ranked);
  if (!best || best.score < FALLBACK_MIN_SCORE) return null;
  const filename = inferFilename(params.documentText, params.filename);
  return {
    proposedName: filename.name,
    destinationPath: best.path,
    confidence: 0.25,
    filenameConfidence: filename.hasDocumentSignals ? 0.55 : 0.25,
    destinationConfidence: 0.25,
    reviewRequired: true,
    reviewReason: 'Classement à faible confiance: vérifier le nom et la destination',
  };
}

function rankFolderPaths(folderPaths: string[], tokens: Set<string>): Array<{ path: string; score: number; depth: number }> {
  return folderPaths
    .map((path) => {
      const parts = [...tokenize(path)];
      return {
        path,
        score: parts.length ? parts.filter((part) => tokenHits(part, tokens)).length / parts.length : 0,
        depth: parts.length,
      };
    })
    .sort((left, right) => right.score - left.score || right.depth - left.depth || left.path.localeCompare(right.path));
}

function chooseBestRankedPath(ranked: Array<{ path: string; score: number; depth: number }>): { path: string; score: number } | null {
  const best = ranked[0];
  if (!best) return null;
  const closeContenders = ranked.slice(1).filter((candidate) => best.score - candidate.score < 0.15);
  return closeContenders.every((candidate) => isNestedPath(best.path, candidate.path)) ? best : null;
}

function isNestedPath(left: string, right: string): boolean {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/g, '');
}

function inferFilename(documentText: string, originalFilename: string): { name: string; hasDocumentSignals: boolean } {
  const extension = extensionOf(originalFilename);
  const type = documentType(documentText);
  const date = documentText.match(/\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.]([0-3]\d)\b/)?.[0];
  const invoice = documentText.match(/\b(?:facture|invoice)\s*(?:n[°o.]*)?\s*([A-Z0-9][A-Z0-9-]{2,})/i)?.[1];
  const party = documentText.match(/\b(?:fournisseur|supplier|client|societe|société|entre)\s*:?\s*([A-Z][\p{L}0-9 &.-]{2,40})/iu)?.[1];
  const parts = [type, party, date, invoice].filter(Boolean);
  if (parts.length < 2) return { name: sanitizeFilename(originalFilename), hasDocumentSignals: false };
  return { name: sanitizeFilename(`${parts.join('_')}${extension}`), hasDocumentSignals: true };
}

function documentType(text: string): string | null {
  const normalized = normalize(text);
  if (normalized.includes('facture') || normalized.includes('invoice')) return 'Facture';
  if (normalized.includes('contrat') || normalized.includes('agreement')) return 'Contrat';
  if (normalized.includes('recu') || normalized.includes('receipt')) return 'Recu';
  if (normalized.includes('courrier') || normalized.includes('lettre')) return 'Courrier';
  return null;
}

function extensionOf(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index > 0 ? filename.slice(index).toLowerCase() : '';
}

function sanitizeFilename(filename: string): string {
  const sanitized = filename
    .normalize('NFKC')
    .replaceAll('/', '_')
    .replaceAll('\\', '_')
    .split('')
    .map((char) => isControlCharacter(char) ? '_' : char)
    .join('')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^\.+$/, 'document')
    .slice(0, 160);
  return sanitized.includes('..') ? sanitized.replace(/\.\.+/g, '.') : sanitized;
}

function isControlCharacter(char: string): boolean {
  const code = char.charCodeAt(0);
  return code < 32 || code === 127;
}
