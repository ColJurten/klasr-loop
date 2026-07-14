import { applyRules } from './prefilter';
import { PipelineInput, PipelineRule } from './types';

function input(rules: PipelineRule[], overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    organizationId: 'org_1',
    documentId: 'doc_1',
    filename: 'scan_001.pdf',
    mimeType: 'application/pdf',
    text: 'Facture EDF du mois de mars',
    folderPaths: ['/Comptabilité/Électricité'],
    rules,
    ...overrides,
  };
}

function rule(priority: number, conditions: PipelineRule['conditions'], destination: string): PipelineRule {
  return { id: `rule_${priority}`, priority, conditions, destinationPath: destination };
}

describe('applyRules (pre-filter, eco-design stage)', () => {
  it('picks the first matching rule by ascending priority', () => {
    const proposal = applyRules(
      input([
        rule(2, [{ field: 'content', operator: 'contains', value: 'facture' }], '/Générique'),
        rule(
          1,
          [
            { field: 'content', operator: 'contains', value: 'facture' },
            { field: 'content', operator: 'contains', value: 'edf' },
          ],
          '/Comptabilité/Électricité',
        ),
      ]),
    );
    expect(proposal).not.toBeNull();
    expect(proposal?.destinationPath).toBe('/Comptabilité/Électricité');
    expect(proposal?.source).toBe('RULE');
    expect(proposal?.llmCallsUsed).toBe(0); // no LLM call on rule match
  });

  it('ANDs all conditions of a rule', () => {
    const proposal = applyRules(
      input([
        rule(
          1,
          [
            { field: 'content', operator: 'contains', value: 'facture' },
            { field: 'content', operator: 'contains', value: 'engie' },
          ],
          '/Comptabilité/Gaz',
        ),
      ]),
    );
    expect(proposal).toBeNull();
  });

  it('returns null without rules', () => {
    expect(applyRules(input([]))).toBeNull();
  });

  it('matches case-insensitively on the filename', () => {
    const proposal = applyRules(
      input([rule(1, [{ field: 'filename', operator: 'contains', value: 'SCAN' }], '/Scans')]),
    );
    expect(proposal?.destinationPath).toBe('/Scans');
  });
});
