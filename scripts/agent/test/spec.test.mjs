import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractSpecBlock, specFromIssueBody, validateSpec } from '../lib/spec.mjs';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/02-ready-label.json', import.meta.url)),
);
const validBody = fixture.issue.body;

test('valid spec extracted and validated from issue body', () => {
  const result = specFromIssueBody(validBody);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.spec.task_id, 42);
  assert.equal(result.spec.acceptance_criteria.length, 2);
});

test('spec is separated from untrusted free-form discussion', () => {
  const raw = extractSpecBlock(validBody);
  assert.ok(!raw.includes('Libre discussion'));
});

test('missing required fields are each reported', () => {
  const result = validateSpec('version: 1\ntitle: x');
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('problem')));
  assert.ok(result.errors.some((e) => e.includes('test_plan')));
});

test('vague acceptance criteria are rejected', () => {
  const raw = validBody
    .replace('Confirming a proposal decrements the pending counter without reload', 'works')
    .replace('<!-- klasr-agent-spec:v1', '<!-- klasr-agent-spec:v1');
  const result = specFromIssueBody(raw);
  assert.equal(result.ok, false);
});

test('invalid YAML and bad risk levels are rejected', () => {
  assert.equal(validateSpec('::not yaml::').ok, false);
  const bad = extract(validBody).replace('risk_level: low', 'risk_level: extreme');
  assert.equal(validateSpec(bad).ok, false);
  function extract(b) {
    return b.split('<!-- klasr-agent-spec:v1')[1].split('-->')[0];
  }
});

test('no marker -> refinement state, never implementation', () => {
  const result = specFromIssueBody('just words');
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /no spec marker/);
});

test('idempotently editable: re-validating the same block is stable', () => {
  const first = specFromIssueBody(validBody);
  const second = specFromIssueBody(validBody);
  assert.deepEqual(first.spec, second.spec);
});

const v2 = `<!-- klasr-agent-spec:v2
version: 2
task_id: 13
title: Prove the natural path
problem: Completion can use stale evidence
desired_outcome: Current evidence gates human review
acceptance_criteria:
  - id: AC1
    behavior: A user launches classification from the visible dashboard
    evidence_class: live-provider
    assertion: Provider metadata reflects the visible decision
constraints: [Keep product invariants]
non_goals: [No product redesign]
affected_areas: [scripts/agent]
risk_level: high
security_review_required: true
test_plan: [Run deterministic validation]
dependencies: []
user_journeys:
  - id: NATURAL_PATH
    steps: [Open dashboard, Click launch, Observe progress, Review proposal, Confirm visibly]
failure_states: [provider-unavailable, cleanup-failed]
provider_fixture:
  kind: google-drive
  environment: non-production
  restoration_proof: Fixture metadata restored after the run
cleanup_plan:
  required: true
  proof: Provider fixture restored and processes stopped
forbidden_shortcuts:
  - seed-expected-results
  - browser-database-polling
  - page-reload
  - direct-decision-api
  - cached-global-queue-control
  - stale-runtime-or-evidence
  - provider-auth-only
completion_policy:
  final_state: awaiting-human-verdict
  current_sha_required: true
  reviewer_verdict_required: true
human:
  owner: ColJurten
  verdict: pending
-->`;

test('v2 accepts evidence-qualified natural-path criteria', () => {
  const result = specFromIssueBody(v2);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.spec.acceptance_criteria[0].id, 'AC1');
});

test('v2 rejects duplicate criterion ids and unknown evidence classes', () => {
  const raw = extractSpecBlock(v2).replace(
    'constraints: [Keep product invariants]',
    `  - id: AC1\n    behavior: Duplicate criterion remains observable\n    evidence_class: screenshot\n    assertion: Duplicate is rejected\nconstraints: [Keep product invariants]`,
  );
  const result = validateSpec(raw, 2);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('duplicate criterion id: AC1')));
  assert.ok(result.errors.some((error) => error.includes('unknown evidence class: screenshot')));
});

test('v2 live natural path requires fixture, cleanup, and every forbidden shortcut', () => {
  const result = specFromIssueBody(v2
    .replace(/provider_fixture:[\s\S]*?cleanup_plan:/, 'cleanup_plan:')
    .replace('  - page-reload\n', ''));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('provider_fixture')));
  assert.ok(result.errors.some((error) => error.includes('page-reload')));
});

test('v2 requires current SHA, reviewer verdict, and an initially pending human verdict', () => {
  for (const changed of [
    v2.replace('current_sha_required: true', 'current_sha_required: false'),
    v2.replace('reviewer_verdict_required: true', 'reviewer_verdict_required: false'),
    v2.replace('verdict: pending', 'verdict: approved'),
  ]) assert.equal(specFromIssueBody(changed).ok, false);
});

test('v2 live fixtures are non-production and declare reversible restoration proof', () => {
  for (const changed of [
    v2.replace('environment: non-production', 'environment: production'),
    v2.replace('  environment: non-production\n', ''),
    v2.replace('  restoration_proof: Fixture metadata restored after the run\n', ''),
  ]) {
    const result = specFromIssueBody(changed);
    assert.equal(result.ok, false, result.errors.join('; '));
  }
});
