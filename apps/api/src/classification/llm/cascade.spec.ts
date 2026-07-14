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

  it('falls through and counts external calls', async () => {
    const result = await classifyWithCascade(
      [new StubProvider('local', null), new StubProvider('anthropic', hit)],
      params,
    );
    expect(result?.modelUsed).toBe('anthropic');
    expect(result?.llmCallsUsed).toBe(1);
  });

  it('returns null when every stage declines (document goes to the manual queue)', async () => {
    const result = await classifyWithCascade([new StubProvider('local', null)], params);
    expect(result).toBeNull();
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

  it('declines when nothing matches', async () => {
    const result = await new LocalHeuristicProvider().classify({
      documentText: 'zzzz qqqq',
      filename: 'x.bin',
      folderPaths: ['/Comptabilité/Factures'],
    });
    expect(result).toBeNull();
  });
});
