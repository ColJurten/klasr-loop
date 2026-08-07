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

export const SPEC_MARKER = 'klasr-agent-spec:v2';
export const SPEC_MARKERS = [SPEC_MARKER, 'klasr-agent-spec:v1'];
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
export const EVIDENCE_CLASSES = ['unit', 'integration', 'browser', 'live-provider'];
export const NATURAL_PATH_SHORTCUTS = [
  'seed-expected-results',
  'browser-database-polling',
  'page-reload',
  'direct-decision-api',
  'cached-global-queue-control',
  'stale-runtime-or-evidence',
  'provider-auth-only',
];
const V2_FIELDS = ['user_journeys', 'failure_states', 'forbidden_shortcuts', 'cleanup_plan', 'completion_policy', 'human'];

/** Extract the raw spec YAML from an issue body. Returns null when absent. */
export function extractSpecBlock(body) {
  if (typeof body !== 'string') return null;
  const marker = SPEC_MARKERS.find((candidate) => body.includes(`<!-- ${candidate}`));
  if (!marker) return null;
  const open = `<!-- ${marker}`;
  const start = body.indexOf(open);
  const afterOpen = start + open.length;
  const end = body.indexOf(CLOSE, afterOpen);
  if (end === -1) return null;
  return body.slice(afterOpen, end).trim();
}

/** Parse + validate. Returns { ok, errors: string[], spec|null }. */
export function validateSpec(rawYaml, expectedVersion) {
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
  if (expectedVersion !== undefined && spec.version !== expectedVersion) {
    return { ok: false, errors: [`v${expectedVersion} marker requires version: ${expectedVersion}`], spec };
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in spec)) errors.push(`missing required field: ${field}`);
  }
  if (![1, 2].includes(spec.version)) errors.push('version must be 1 or 2');
  if (spec.version === 2) for (const field of V2_FIELDS) {
    if (!(field in spec)) errors.push(`missing required field: ${field}`);
  }
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
  if (spec.version === 1 && Array.isArray(spec.acceptance_criteria)) {
    spec.acceptance_criteria.forEach((criterion, index) => {
      if (typeof criterion !== 'string' || criterion.trim().length < 8) {
        errors.push(`acceptance_criteria[${index}] must be a verifiable statement`);
      }
    });
  }
  if (spec.version === 2 && Array.isArray(spec.acceptance_criteria)) {
    const ids = new Set();
    spec.acceptance_criteria.forEach((criterion, index) => {
      if (!criterion || typeof criterion !== 'object' || Array.isArray(criterion)) {
        errors.push(`acceptance_criteria[${index}] must be a mapping`);
        return;
      }
      for (const field of ['id', 'behavior', 'evidence_class', 'assertion']) {
        if (typeof criterion[field] !== 'string' || !criterion[field].trim()) {
          errors.push(`acceptance_criteria[${index}] missing ${field}`);
        }
      }
      if (ids.has(criterion.id)) errors.push(`duplicate criterion id: ${criterion.id}`);
      ids.add(criterion.id);
      if (criterion.evidence_class && !EVIDENCE_CLASSES.includes(criterion.evidence_class)) {
        errors.push(`unknown evidence class: ${criterion.evidence_class}`);
      }
    });
    const live = spec.acceptance_criteria.some((criterion) => criterion?.evidence_class === 'live-provider');
    if (live && (!spec.provider_fixture || typeof spec.provider_fixture !== 'object')) {
      errors.push('live-provider criteria require provider_fixture');
    }
    if (live && (spec.provider_fixture?.environment !== 'non-production' || !spec.provider_fixture?.restoration_proof)) {
      errors.push('live-provider criteria require a non-production provider_fixture with reversible restoration proof');
    }
    if (live && (!spec.cleanup_plan?.required || !spec.cleanup_plan?.proof)) {
      errors.push('live-provider criteria require a mandatory cleanup_plan with proof');
    }
    const naturalPath = spec.user_journeys?.some((journey) => journey?.id === 'NATURAL_PATH');
    if (live && naturalPath) for (const shortcut of NATURAL_PATH_SHORTCUTS) {
      if (!spec.forbidden_shortcuts?.includes(shortcut)) errors.push(`NATURAL_PATH missing forbidden shortcut: ${shortcut}`);
    }
    if (spec.completion_policy?.final_state !== 'awaiting-human-verdict') {
      errors.push('completion_policy.final_state must be awaiting-human-verdict');
    }
    if (spec.completion_policy?.current_sha_required !== true) errors.push('completion_policy.current_sha_required must be true');
    if (spec.completion_policy?.reviewer_verdict_required !== true) errors.push('completion_policy.reviewer_verdict_required must be true');
    if (!spec.human?.owner || spec.human?.verdict !== 'pending') errors.push('human owner and pending verdict are required before automation');
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
  const marker = SPEC_MARKERS.find((candidate) => body.includes(`<!-- ${candidate}`));
  return validateSpec(raw, Number(marker.at(-1)));
}
