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

  it('uses an uncounted deterministic fallback when no external key configured', async () => {
    const result = await classifyWithCascade([new StubProvider('local', null)], { ...params, folderPaths: ['/Zeta', '/Alpha'] });
    expect(result).toEqual(expect.objectContaining({ destinationPath: '/Alpha', modelUsed: 'local-fallback', llmCallsUsed: 0 }));
  });

  it('keeps a weak-positive path instead of choosing alphabetically', async () => {
    const result = await classifyWithCascade([new StubProvider('local', null)], {
      documentText: 'facture', filename: 'document.pdf', folderPaths: ['/Alpha', '/Comptabilité/Factures/Archives'],
    });
    expect(result?.destinationPath).toBe('/Comptabilité/Factures/Archives');
  });

  it('returns null without a destination folder', async () => {
    await expect(classifyWithCascade([], { ...params, folderPaths: [] })).resolves.toBeNull();
  });
});

describe('LocalHeuristicProvider', () => {
  it('matches folder keywords, accent- and plural-insensitive', async () => {
    const result = await new LocalHeuristicProvider().classify({
      documentText: 'Relevé bancaire - Banque Populaire, mars 2026',
      filename: 'releve_mars.pdf',
      folderPaths: ['/Banque/Relevés', '/RH/Paie'],
    });
    expect(result?.destinationPath).toBe('/Banque/Relevés');
  });

  it('declines low confidence so later providers remain reachable', async () => {
    const result = await new LocalHeuristicProvider().classify({
      documentText: 'zzzz qqqq',
      filename: 'document-original.pdf',
      folderPaths: ['/Zeta', '/Alpha'],
    });
    expect(result).toBeNull();
  });
});
