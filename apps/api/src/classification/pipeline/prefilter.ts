/**
 * Rule-based pre-filter: applies user rules sequentially by ascending priority.
 * Eco-design commitment: a confident rule match means the LLM is never called.
 */
import { PipelineInput, PipelineProposal, PipelineRule, PipelineRuleCondition } from './types';

const RULE_CONFIDENCE = 0.95;
const WEAK_RULE_CONFIDENCE = 0.6;

function conditionMatches(input: PipelineInput, condition: PipelineRuleCondition): boolean {
  const haystacks: Record<PipelineRuleCondition['field'], string> = {
    content: input.text,
    filename: input.filename,
    mimeType: input.mimeType,
  };
  const target = haystacks[condition.field].toLocaleLowerCase();
  const needle = condition.value.toLocaleLowerCase();
  return condition.operator === 'contains' ? target.includes(needle) : target === needle;
}

function ruleMatches(input: PipelineInput, rule: PipelineRule): boolean {
  // Conditions of a rule are ANDed together, matching the UI rule builder.
  return (
    rule.conditions.length > 0 &&
    rule.conditions.every((condition) => conditionMatches(input, condition))
  );
}

/** Returns a proposal from the first matching rule, or null (fall through to LLM). */
export function applyRules(input: PipelineInput): PipelineProposal | null {
  const ordered = [...input.rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    if (ruleMatches(input, rule)) {
      if (!input.folderPaths.includes(rule.destinationPath)) continue;
      const strongContentRule = rule.conditions.some((condition) => condition.field === 'content');
      return {
        documentId: input.documentId,
        proposedName: rule.suggestedNameTemplate ?? input.filename,
        destinationPath: rule.destinationPath,
        confidence: strongContentRule ? RULE_CONFIDENCE : WEAK_RULE_CONFIDENCE,
        filenameConfidence: rule.suggestedNameTemplate ? 0.9 : 0.35,
        destinationConfidence: strongContentRule ? RULE_CONFIDENCE : WEAK_RULE_CONFIDENCE,
        reviewRequired: !strongContentRule || !rule.suggestedNameTemplate,
        reviewReason: strongContentRule ? undefined : 'Règle basée sur le nom ou le format: vérifier avant validation',
        source: 'RULE',
        llmCallsUsed: 0,
      };
    }
  }
  return null;
}
