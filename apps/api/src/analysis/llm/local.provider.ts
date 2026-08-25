import { LlmProvider } from './llm.provider';
import { StructuredGeneration, StructuredResult } from './llm.types';

export class LocalStructuredProvider implements LlmProvider {
  async generate(request: StructuredGeneration): Promise<StructuredResult> {
    const input = request.input as Record<string, unknown>;
    if (request.task === 'analyse_document') return result(analyse(String(input.content ?? '')));
    if (request.task === 'suggest_filename') return result(filename(input.analysis as AnalysisShape, String(input.extension ?? '')));
    if (request.task === 'suggest_destination') return result(destination(input.analysis as AnalysisShape, input.folders as FolderShape[]));
    throw new Error(`unsupported_task:${request.task}`);
  }
}
interface AnalysisShape { documentType: string | null; dates: string[]; parties: string[]; identifiers: string[]; subject: string | null; topics: string[]; amount?: string | null; signals: string[]; }
interface FolderShape { path: string; name: string; children: FolderShape[]; }
function result(value: unknown): StructuredResult { return { value, provider: 'local', model: 'deterministic' }; }
function analyse(text: string): AnalysisShape & { purpose: string | null } {
  const invoice = /\b(facture|invoice)\b/i.test(text); const contract = /\b(contrat|contract)\b/i.test(text); const receipt = /\b(reçu|receipt|ticket)\b/i.test(text);
  const documentType = invoice ? 'facture' : contract ? 'contrat' : receipt ? 'reçu' : /\b(letter|lettre|courrier)\b/i.test(text) ? 'courrier' : null;
  const rawDate = text.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/); const dates = rawDate ? [`${rawDate[1]}-${rawDate[2].padStart(2, '0')}-${rawDate[3].padStart(2, '0')}`] : [];
  const identifier = text.match(/(?:facture|invoice|contrat|contract|réf(?:érence)?)[ \t:#n°-]*([A-Z0-9][A-Z0-9-]{2,})/i)?.[1];
  const party = text.match(/(?:de|from|émetteur|issuer|fournisseur|supplier)\s*[:-]?\s*([A-ZÀ-Ÿ][\p{L}0-9 &.'-]{2,40})/iu)?.[1]?.trim();
  const amount = text.match(/\b\d+[,.]\d{2}\s*(?:€|EUR)\b/i)?.[0] ?? null;
  const signals = [documentType && 'document_type', dates.length && 'document_date', party && 'issuer', identifier && 'invoice_number', amount && 'amount'].filter(Boolean) as string[];
  return { subject: documentType, documentType, dates, topics: documentType ? [documentType] : [], purpose: documentType, parties: party ? [party] : [], identifiers: identifier ? [identifier] : [], amount, signals };
}
function filename(a: AnalysisShape, extension: string) {
  const pieces = [a.dates[0], a.documentType, a.parties[0], a.identifiers[0]].filter(Boolean);
  return { value: pieces.join('_'), confidence: Math.min(.95, .35 + pieces.length * .15), signals: a.signals, reviewRequired: pieces.length < 2, failureReason: pieces.length < 2 ? 'insufficient_evidence' : null, provider: 'local', model: 'deterministic', extension };
}
function destination(a: AnalysisShape, folders: FolderShape[]) {
  const tokens = [...a.topics, ...a.parties, a.documentType ?? ''].flatMap((value) => value.toLowerCase().split(/\W+/)).filter((value) => value.length > 2);
  const all = flatten(folders); const scored = all.map((folder) => ({ path: folder.path, score: tokens.filter((token) => folder.path.toLowerCase().includes(token)).length })).sort((x, y) => y.score - x.score);
  const best = scored[0]; const ambiguous = best?.score && scored[1]?.score === best.score;
  return { path: best?.score && !ambiguous ? best.path : null, confidence: best?.score && !ambiguous ? Math.min(.9, .45 + best.score * .15) : 0, signals: best?.score && !ambiguous ? ['matched_folder_path'] : [], reviewRequired: !best?.score || Boolean(ambiguous), failureReason: ambiguous ? 'ambiguous_destination' : best?.score ? null : 'no_destination_match', provider: 'local', model: 'deterministic' };
}
function flatten(nodes: FolderShape[]): FolderShape[] { return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]); }
