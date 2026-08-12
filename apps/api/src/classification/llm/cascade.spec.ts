import { classifyWithCascade } from './cascade';
import { LocalHeuristicProvider } from './local-heuristic.provider';
import { LlmClassification, LlmProvider } from './provider';

class StubProvider implements LlmProvider {
  calls = 0;
  constructor(
    readonly name: string,
    private readonly result: LlmClassification | null,
  ) {}
  async classify(): Promise<LlmClassification | null> {
    this.calls += 1;
    return this.result;
  }
}

const hit: LlmClassification = { proposedName: 'a.pdf', destinationPath: '/A', confidence: 0.9 };
const params = { documentText: 'x', filename: 'a.pdf', folderPaths: ['/A'] };

describe('classifyWithCascade (cheapest capable model first)', () => {
  it('stops at the first confident provider — local stage is free', async () => {
    const second = new StubProvider('anthropic', hit);
    const result = await classifyWithCascade([new StubProvider('local', hit), second], params);
    expect(result?.modelUsed).toBe('local');
    expect(result?.llmCallsUsed).toBe(0);
    expect(second.calls).toBe(0);
  });

  it('preserves provider order, reaches Anthropic, and counts its call', async () => {
    const local = new StubProvider('local', null);
    const anthropic = new StubProvider('anthropic', hit);
    const result = await classifyWithCascade(
      [local, anthropic],
      params,
    );
    expect(result?.modelUsed).toBe('anthropic');
    expect(result?.llmCallsUsed).toBe(1);
    expect(local.calls).toBe(1);
    expect(anthropic.calls).toBe(1);
  });

  it('does not choose alphabetically when there is no destination evidence', async () => {
    const result = await classifyWithCascade([new StubProvider('local', null)], { ...params, folderPaths: ['/Zeta', '/Alpha'] });
    expect(result).toBeNull();
  });

  it('keeps a weak-positive path instead of choosing alphabetically when unambiguous', async () => {
    const result = await classifyWithCascade([new StubProvider('local', null)], {
      documentText: 'facture', filename: 'document.pdf', folderPaths: ['/Alpha', '/Comptabilité/Factures/Archives'],
    });
    expect(result?.destinationPath).toBe('/Comptabilité/Factures/Archives');
    expect(result?.reviewRequired).toBe(true);
  });

  it('returns null for ambiguous sibling destinations', async () => {
    const result = await classifyWithCascade([new StubProvider('local', null)], {
      documentText: 'facture assurance',
      filename: 'document.pdf',
      folderPaths: ['/Cabinet/Assurance Auto', '/Cabinet/Assurance Habitation'],
    });
    expect(result).toBeNull();
  });

  it('prefers a credible nested destination over its matching ancestor', async () => {
    const result = await classifyWithCascade([new StubProvider('local', null)], {
      documentText: 'Facture comptabilité électricité 2026',
      filename: 'scan-facture-electricite.pdf',
      folderPaths: ['/Comptabilité', '/Comptabilité/Électricité'],
    });
    expect(result?.destinationPath).toBe('/Comptabilité/Électricité');
  });

  it('returns null without a destination folder', async () => {
    await expect(classifyWithCascade([], { ...params, folderPaths: [] })).resolves.toBeNull();
  });
});

describe('LocalHeuristicProvider', () => {
  it('matches folder keywords, accent- and plural-insensitive', async () => {
    const result = await new LocalHeuristicProvider().classify({
      documentText: 'Relevé bancaire - Banque Populaire, mars 2026',
      filename: 'scan_001.pdf',
      folderPaths: ['/Banque/Relevés', '/RH/Paie'],
    });
    expect(result?.destinationPath).toBe('/Banque/Relevés');
    expect(result?.proposedName).toBe('scan_001.pdf');
  });

  it('does not count a sanitized original filename as document-derived filename evidence', async () => {
    const result = await new LocalHeuristicProvider().classify({
      documentText: 'facture',
      filename: 'notes perso.pdf',
      folderPaths: ['/Factures'],
    });
    expect(result?.proposedName).toBe('notes_perso.pdf');
    expect(result?.filenameConfidence).toBe(0.35);
    expect(result?.reviewRequired).toBe(true);
    expect(result?.reviewReason).toBe('Nom à vérifier: signaux documentaires insuffisants');
  });

  it('declines low confidence so later providers remain reachable', async () => {
    const result = await new LocalHeuristicProvider().classify({
      documentText: 'zzzz qqqq',
      filename: 'document-original.pdf',
      folderPaths: ['/Zeta', '/Alpha'],
    });
    expect(result).toBeNull();
  });

  it('does not treat an ancestor and matching child as ambiguous siblings', async () => {
    const result = await new LocalHeuristicProvider().classify({
      documentText: 'Facture société KLASR comptabilité électricité 2026-03-31',
      filename: 'scan.pdf',
      folderPaths: ['/Comptabilité', '/Comptabilité/Électricité'],
    });
    expect(result?.destinationPath).toBe('/Comptabilité/Électricité');
  });

  it('still returns null for truly ambiguous sibling destinations', async () => {
    const result = await new LocalHeuristicProvider().classify({
      documentText: 'Assurance cabinet',
      filename: 'scan.pdf',
      folderPaths: ['/Cabinet/Assurance Auto', '/Cabinet/Assurance Habitation'],
    });
    expect(result).toBeNull();
  });

  it('does not let an ancestor hide a close sibling ambiguity', async () => {
    const result = await new LocalHeuristicProvider().classify({
      documentText: 'Cabinet assurance auto habitation',
      filename: 'scan.pdf',
      folderPaths: ['/Cabinet', '/Cabinet/Assurance Auto', '/Cabinet/Assurance Habitation'],
    });
    expect(result).toBeNull();
  });
});
