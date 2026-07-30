/**
 * Heuristic "local model": keyword scoring against folder path segments.
 * First stage of the cascade (eco-design) and the offline fallback when no
 * external LLM is configured or reachable.
 */
import { LlmClassification, LlmProvider } from './provider';

const MIN_CONFIDENCE = 0.55;

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
    const tokens = tokenize(`${params.filename} ${params.documentText}`);
    let bestPath: string | null = null;
    let bestScore = 0;
    for (const path of params.folderPaths) {
      const parts = [...tokenize(path)];
      if (parts.length === 0) continue;
      const score = parts.filter((part) => tokenHits(part, tokens)).length / parts.length;
      const deeperThanBest = bestPath ? path.split('/').length > bestPath.split('/').length : true;
      if (score > bestScore || (score === bestScore && deeperThanBest)) {
        bestPath = path;
        bestScore = score;
      }
    }
    if (bestPath === null || bestScore < MIN_CONFIDENCE) return null;
    return {
      proposedName: params.filename,
      destinationPath: bestPath,
      confidence: Math.round(Math.min(bestScore, 0.8) * 100) / 100,
    };
  }
}
