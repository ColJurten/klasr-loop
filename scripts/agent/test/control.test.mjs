import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emptyControl,
  hasProcessed,
  MAX_TRACKED_EVENTS,
  parseControl,
  recordEvent,
  renderControlComment,
  shapeWorkerPatch,
} from '../lib/control.mjs';

test('render/parse round-trip', () => {
  const control = recordEvent(emptyControl(42), 'issue-comment:9001', {
    status: 'reviewing',
    branch: 'feature/42-counter-refresh',
    pull_request: 45,
    cycle: 2,
  });
  const parsed = parseControl(renderControlComment(control));
  assert.deepEqual(parsed, control);
});

test('worker patch preserves fresh and established SHA lineage by role', () => {
  const base = { task_id: 13, status: 'spec-ready', attempt: 1 };
  const shaA = 'a'.repeat(40);
  const shaB = 'b'.repeat(40);
  assert.deepEqual(shapeWorkerPatch('spec-writer', base, shaA, null, 1), base);
  assert.deepEqual(shapeWorkerPatch('implementer', base, shaA, null, 1), { ...base, start_attempt: 1, sha: shaA });
  assert.deepEqual(shapeWorkerPatch('verifier', base, shaA, shaA, 1), { ...base, sha: shaA });
  assert.deepEqual(shapeWorkerPatch('implementer', base, shaB, shaA, 2), { ...base, start_attempt: 2, sha: shaB });
  assert.deepEqual(shapeWorkerPatch('verifier', base, shaB, shaA, 1), base);
  assert.deepEqual(shapeWorkerPatch('verifier', base, shaA, shaB, 1), base);
});

test('duplicate detection via processed_events', () => {
  const control = recordEvent(emptyControl(42), 'review:77001');
  assert.ok(hasProcessed(control, 'review:77001'));
  assert.ok(!hasProcessed(control, 'review:77002'));
});

test('processed events are capped so the record cannot grow indefinitely', () => {
  let control = emptyControl(1);
  for (let i = 0; i < MAX_TRACKED_EVENTS + 10; i += 1) {
    control = recordEvent(control, `issue-comment:${i}`);
  }
  assert.equal(control.processed_events.length, MAX_TRACKED_EVENTS);
  assert.ok(!hasProcessed(control, 'issue-comment:0'));
  assert.ok(hasProcessed(control, `issue-comment:${MAX_TRACKED_EVENTS + 9}`));
});

test('corrupt or missing record parses to null (fresh control, fail-open to dedupe miss only)', () => {
  assert.equal(parseControl('random comment'), null);
  assert.equal(parseControl('<!-- klasr-agent-state\nnot json\n-->'), null);
});

test('update-in-place is a pure merge, no comment-per-transition', () => {
  const first = recordEvent(emptyControl(42), 'a', { status: 'running' });
  const second = recordEvent(first, 'b', { status: 'reviewing' });
  assert.equal(second.status, 'reviewing');
  assert.deepEqual(second.processed_events, ['a', 'b']);
});

test('control records lifecycle and current evidence lineage', () => {
  const control = emptyControl(13);
  assert.deepEqual(control.lifecycle, { attempt: 1, supersedes: null, superseded_by: null });
  assert.deepEqual(control.evidence, { sha: null, manifest: null, status: 'missing' });
  assert.equal(control.human_verdict, 'pending');
});

test('starting a new attempt supersedes prior evidence', () => {
  const started = recordEvent(emptyControl(13), 'start:a', { start_attempt: 1, sha: 'a' });
  const first = recordEvent(started, 'evidence:a', { evidence: { sha: 'a', manifest: 'evidence-a.json', status: 'current' } });
  const second = recordEvent(first, 'push:b', { start_attempt: 2, sha: 'b' });
  assert.equal(second.lifecycle.attempt, 2);
  assert.equal(second.lifecycle.supersedes, 1);
  assert.deepEqual(second.evidence, { sha: 'b', manifest: null, status: 'missing' });
});

test('shared control mutation rejects a stale attempt', () => {
  const current = recordEvent(emptyControl(13), 'attempt:2', { start_attempt: 2, sha: 'b' });
  assert.throws(() => recordEvent(current, 'late:1', { attempt: 1, status: 'done' }), /stale attempt/);
});

test('recordEvent never silently discards or changes SHA lineage', () => {
  const current = recordEvent(emptyControl(13), 'attempt:1', { start_attempt: 1, sha: 'a' });
  assert.equal(recordEvent(current, 'same:a', { attempt: 1, sha: 'a' }).evidence.sha, 'a');
  assert.equal(recordEvent(current, 'nested-same:a', { attempt: 1, evidence: { sha: 'a', status: 'current' } }).evidence.sha, 'a');
  assert.throws(() => recordEvent(current, 'different:b', { attempt: 1, sha: 'b' }), /sha may only change/);
  assert.throws(() => recordEvent(current, 'nested-different:b', { attempt: 1, evidence: { sha: 'b', status: 'current' } }), /sha may only change/);
});

test('human PR head advancement starts exactly one new attempt and binds later acceptance', () => {
  const oldSha = 'a'.repeat(40);
  const newSha = 'b'.repeat(40);
  const firstImplementer = recordEvent(emptyControl(13), 'implementer:1', shapeWorkerPatch('implementer', { status: 'local-validation', attempt: 1 }, oldSha, null, 1));
  assert.equal(firstImplementer.lifecycle.attempt, 1);
  const ciVerifier = recordEvent(firstImplementer, 'verify:1', shapeWorkerPatch('verifier', { status: 'live-acceptance', attempt: 1 }, oldSha, oldSha, 1));
  assert.equal(ciVerifier.lifecycle.attempt, 1);
  const humanHead = recordEvent(ciVerifier, 'trusted-head:2', { status: 'local-validation', attempt: 1, start_attempt: 2, sha: newSha });
  assert.equal(humanHead.lifecycle.attempt, 2);
  assert.deepEqual(humanHead.evidence, { sha: newSha, manifest: null, status: 'missing' });
  const acceptance = recordEvent(humanHead, 'acceptance:2', { status: 'live-acceptance', attempt: 2, sha: newSha });
  assert.equal(acceptance.lifecycle.attempt, 2);
  assert.equal(acceptance.evidence.sha, newSha);
  assert.throws(() => recordEvent(humanHead, 'stale:1', { status: 'live-acceptance', attempt: 1, sha: oldSha }), /stale attempt/);
  assert.throws(() => recordEvent(humanHead, 'wrong-head', { status: 'live-acceptance', attempt: 2, sha: oldSha }), /sha may only change/);
});

test('final evidence persists only sanitized current lineage metadata', () => {
  const sha = 'c'.repeat(40);
  const current = recordEvent(emptyControl(13), 'attempt', { start_attempt: 1, sha });
  const final = recordEvent(current, 'final', {
    attempt: 1,
    sha,
    status: 'awaiting-human-verdict',
    evidence: { sha, manifest: `klasr-live-evidence:${sha}`, status: 'current' },
    human_verdict: 'pending',
  });
  assert.deepEqual(final.evidence, { sha, manifest: `klasr-live-evidence:${sha}`, status: 'current' });
  assert.equal(final.human_verdict, 'pending');
});
