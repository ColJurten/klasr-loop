/**
 * Task specification: a versioned YAML block embedded in the canonical issue
 * body between stable markers, clearly separated from free-form discussion.
 *
 *   <!-- klasr-agent-spec:v1
 *   version: 1
 *   ...yaml...
 *   -->
 */
import { parse } from 'yaml';

export const SPEC_MARKER = 'klasr-agent-spec:v1';
const OPEN = `<!-- ${SPEC_MARKER}`;
const CLOSE = '-->';

export const REQUIRED_FIELDS = [
  'version',
  'task_id',
  'title',
  'problem',
  'desired_outcome',
  'acceptance_criteria',
  'constraints',
  'non_goals',
  'affected_areas',
  'risk_level',
  'security_review_required',
  'test_plan',
];

const RISK_LEVELS = ['low', 'medium', 'high'];

/** Extract the raw spec YAML from an issue body. Returns null when absent. */
export function extractSpecBlock(body) {
  if (typeof body !== 'string') return null;
  const start = body.indexOf(OPEN);
  if (start === -1) return null;
  const afterOpen = start + OPEN.length;
  const end = body.indexOf(CLOSE, afterOpen);
  if (end === -1) return null;
  return body.slice(afterOpen, end).trim();
}

/** Parse + validate. Returns { ok, errors: string[], spec|null }. */
export function validateSpec(rawYaml) {
  const errors = [];
  if (!rawYaml || rawYaml.trim() === '') {
    return { ok: false, errors: ['spec block is empty or missing'], spec: null };
  }
  let spec;
  try {
    spec = parse(rawYaml);
  } catch (error) {
    return { ok: false, errors: [`invalid YAML: ${error.message}`], spec: null };
  }
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return { ok: false, errors: ['spec must be a YAML mapping'], spec: null };
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in spec)) errors.push(`missing required field: ${field}`);
  }
  if (spec.version !== 1) errors.push('version must be 1');
  if ('task_id' in spec && !Number.isInteger(spec.task_id)) {
    errors.push('task_id must be an integer (the canonical issue number)');
  }
  for (const listField of ['acceptance_criteria', 'constraints', 'non_goals', 'affected_areas', 'test_plan']) {
    const value = spec[listField];
    if (listField in spec && (!Array.isArray(value) || value.length === 0)) {
      // non_goals may be an explicit empty scope statement, but must exist as a list
      if (!(listField === 'non_goals' && Array.isArray(value))) {
        errors.push(`${listField} must be a non-empty list`);
      }
    }
  }
  if (Array.isArray(spec.acceptance_criteria)) {
    spec.acceptance_criteria.forEach((criterion, index) => {
      if (typeof criterion !== 'string' || criterion.trim().length < 8) {
        errors.push(`acceptance_criteria[${index}] must be a verifiable statement`);
      }
    });
  }
  if ('risk_level' in spec && !RISK_LEVELS.includes(spec.risk_level)) {
    errors.push(`risk_level must be one of: ${RISK_LEVELS.join(', ')}`);
  }
  if ('security_review_required' in spec && typeof spec.security_review_required !== 'boolean') {
    errors.push('security_review_required must be a boolean');
  }
  if (!('dependencies' in spec)) spec && (spec.dependencies = []);
  return { ok: errors.length === 0, errors, spec: errors.length === 0 ? spec : spec ?? null };
}

/** Convenience: extract + validate from a full issue body. */
export function specFromIssueBody(body) {
  const raw = extractSpecBlock(body);
  if (raw === null) return { ok: false, errors: ['no spec marker found in issue body'], spec: null };
  return validateSpec(raw);
}
