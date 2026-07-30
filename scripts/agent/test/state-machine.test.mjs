import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  afterVerification,
  assertTransition,
  isLegalTransition,
  labelFor,
  STATES,
} from '../lib/state-machine.mjs';

test('happy path transitions are legal', () => {
  const path = ['needs-spec', 'spec-ready', 'queued', 'running', 'reviewing', 'awaiting-supervisor', 'feedback-received', 'running', 'reviewing', 'awaiting-supervisor', 'ready', 'done'];
  for (let i = 0; i < path.length - 1; i += 1) {
    assert.ok(isLegalTransition(path[i], path[i + 1]), `${path[i]} -> ${path[i + 1]}`);
  }
});

test('illegal transitions throw', () => {
  assert.throws(() => assertTransition('needs-spec', 'running'));
  assert.throws(() => assertTransition('done', 'running'));
  assert.throws(() => assertTransition('queued', 'awaiting-supervisor'));
});

test('verifier PASS -> awaiting-supervisor', () => {
  assert.equal(afterVerification('PASS', 1, 5), 'awaiting-supervisor');
});

test('REQUEST_CHANGES under the cap -> bounded revision cycle', () => {
  assert.equal(afterVerification('REQUEST_CHANGES', 2, 5), 'running');
});

test('REQUEST_CHANGES at the cap -> human-required (cycle exhaustion)', () => {
  assert.equal(afterVerification('REQUEST_CHANGES', 4, 5), 'human-required');
});

test('BLOCKED verdict -> blocked', () => {
  assert.equal(afterVerification('BLOCKED', 0, 5), 'blocked');
});

test('every state has a label and appears in the model', () => {
  for (const state of STATES) assert.equal(labelFor(state), `agent:${state}`);
});
