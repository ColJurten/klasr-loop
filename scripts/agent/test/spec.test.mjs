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
