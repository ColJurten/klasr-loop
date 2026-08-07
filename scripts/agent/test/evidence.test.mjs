import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finalizeEvidence, liveEvidenceEventKey, validateEvidence } from '../lib/evidence.mjs';

const spec = {
  acceptance_criteria: [
    { id: 'AC1', evidence_class: 'integration' },
    { id: 'AC2', evidence_class: 'live-provider' },
  ],
};
const context = { issue: 13, attempt: 3, sha: 'a'.repeat(40) };
const valid = {
  version: 1,
  issue: 13,
  attempt: 3,
  sha: 'a'.repeat(40),
  status: 'current',
  criteria: [
    { criterion_id: 'AC1', evidence_class: 'browser', passed: true, artifact: 'integration.json' },
    { criterion_id: 'AC2', evidence_class: 'live-provider', passed: true, artifact: 'natural-path.json' },
  ],
  cleanup: { passed: true, proof: 'fixture restored' },
  processes: { active: [], orphaned: [] },
  reviewer: { verdict: 'PASS', sha: 'a'.repeat(40), approved: true, edited_files: false },
};

test('current complete evidence finalizes only to awaiting-human-verdict', () => {
  assert.deepEqual(finalizeEvidence(spec, valid, context), { ok: true, errors: [], state: 'awaiting-human-verdict' });
});

test('live evidence keys distinguish issue, SHA, attempt, and PASS/FAIL', () => {
  const sha = 'a'.repeat(40);
  const fail = liveEvidenceEventKey({ issue: 13, sha, attempt: 2, status: 'FAIL' });
  const pass = liveEvidenceEventKey({ issue: 13, sha, attempt: 2, status: 'PASS' });
  assert.notEqual(fail, pass);
  assert.equal(fail, liveEvidenceEventKey({ issue: 13, sha, attempt: 2, status: 'FAIL' }));
  assert.notEqual(pass, liveEvidenceEventKey({ issue: 14, sha, attempt: 2, status: 'PASS' }));
  assert.notEqual(pass, liveEvidenceEventKey({ issue: 13, sha, attempt: 3, status: 'PASS' }));
});

test('evidence rejects missing, failed, and lower-class criterion rows', () => {
  const result = validateEvidence(spec, {
    ...valid,
    criteria: [{ criterion_id: 'AC2', evidence_class: 'browser', passed: false, artifact: 'browser.json' }],
  }, context);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('missing criterion: AC1')));
  assert.ok(result.errors.some((error) => error.includes('criterion failed: AC2')));
  assert.ok(result.errors.some((error) => error.includes('insufficient evidence class: AC2')));
});

test('evidence rejects wrong lineage and stale or superseded manifests', () => {
  for (const patch of [
    { issue: 12 }, { attempt: 2 }, { sha: 'b'.repeat(40) }, { status: 'stale' }, { status: 'superseded' },
  ]) assert.equal(validateEvidence(spec, { ...valid, ...patch }, context).ok, false, JSON.stringify(patch));
});

test('evidence rejects cleanup/process leaks and absent current reviewer PASS', () => {
  const result = validateEvidence(spec, {
    ...valid,
    cleanup: { passed: false, proof: '' },
    processes: { active: [3000], orphaned: ['worker'] },
    reviewer: { verdict: 'REQUEST_CHANGES', sha: 'b'.repeat(40), approved: false, edited_files: true },
  }, context);
  assert.equal(result.ok, false);
  for (const fragment of ['cleanup', 'active processes', 'orphan processes', 'reviewer verdict', 'reviewer SHA', 'reviewer edited']) {
    assert.ok(result.errors.some((error) => error.includes(fragment)), fragment);
  }
});

test('evidence rejects duplicate and unknown criterion rows and never finalizes done', () => {
  const result = finalizeEvidence(spec, { ...valid, criteria: [...valid.criteria, valid.criteria[0], { criterion_id: 'AC99', evidence_class: 'unit', passed: true, artifact: 'x.json' }] }, context);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('duplicate criterion: AC1')));
  assert.ok(result.errors.some((error) => error.includes('unknown criterion: AC99')));
  assert.notEqual(result.state, 'done');
});
