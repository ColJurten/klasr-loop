import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  afterVerification,
  assertTransition,
  isLegalTransition,
  labelFor,
  STATES,
  assertCurrentAttempt,
} from '../lib/state-machine.mjs';

test('every worker-post source/target transition is executable', () => {
  const runtimeEdges = [
    ['needs-spec', 'needs-spec'], ['needs-spec', 'spec-ready'], ['needs-spec', 'local-validation'],
    ['spec-ready', 'spec-ready'], ['spec-ready', 'local-validation'], ['changes-requested', 'local-validation'],
    ['local-validation', 'local-validation'], ['live-acceptance', 'local-validation'], ['code-review', 'local-validation'],
    ...['live-acceptance', 'changes-requested', 'code-review', 'blocked', 'human-required'].map((to) => ['local-validation', to]),
    ['code-review', 'live-acceptance'], ['code-review', 'human-required'],
    ...['live-acceptance', 'code-review', 'awaiting-human-verdict', 'changes-requested', 'human-required'].map((to) => ['live-acceptance', to]),
    ['human-required', 'local-validation'], ['blocked', 'local-validation'], ['awaiting-human-verdict', 'local-validation'],
    ['human-required', 'human-required'], ['human-required', 'code-review'], ['human-required', 'live-acceptance'], ['human-required', 'awaiting-human-verdict'],
  ];
  for (const [from, to] of runtimeEdges) assert.equal(assertTransition(from, to), to, `${from} -> ${to}`);
});

test('v3 delivery path reaches human verdict without an automated done transition', () => {
  const path = ['needs-spec', 'spec-ready', 'local-validation', 'code-review', 'live-acceptance', 'awaiting-human-verdict'];
  for (let i = 0; i < path.length - 1; i += 1) assert.ok(isLegalTransition(path[i], path[i + 1]), `${path[i]} -> ${path[i + 1]}`);
  assert.equal(isLegalTransition('awaiting-human-verdict', 'done'), false);
});

test('acceptance and review failures route to bounded repair or escalation', () => {
  assert.ok(isLegalTransition('live-acceptance', 'changes-requested'));
  assert.ok(isLegalTransition('changes-requested', 'local-validation'));
  for (const state of ['local-validation', 'live-acceptance', 'code-review']) {
    assert.ok(isLegalTransition(state, 'human-required'));
  }
});

test('an exact-current finalizer PASS can recover live infrastructure escalation only to human verdict', () => {
  assert.ok(isLegalTransition('human-required', 'awaiting-human-verdict'));
  assert.equal(isLegalTransition('human-required', 'done'), false);
});

test('automatic CI and live/security feedback can re-enter local validation', () => {
  for (const state of ['local-validation', 'live-acceptance', 'code-review']) {
    assert.ok(isLegalTransition(state, 'local-validation'), `${state} -> local-validation`);
  }
  assert.equal(isLegalTransition('awaiting-human-verdict', 'live-acceptance'), false);
});

test('stale attempts cannot mutate current state', () => {
  assert.equal(assertCurrentAttempt(4, 4), 4);
  assert.throws(() => assertCurrentAttempt(3, 4), /stale attempt/);
});

test('illegal transitions throw', () => {
  assert.throws(() => assertTransition('needs-spec', 'running'));
  assert.throws(() => assertTransition('done', 'running'));
  assert.throws(() => assertTransition('spec-ready', 'awaiting-supervisor'));
});

test('verifier PASS -> live acceptance wait', () => {
  assert.equal(afterVerification('PASS', 1, 5), 'live-acceptance');
});

test('REQUEST_CHANGES under the cap -> bounded revision cycle', () => {
  assert.equal(afterVerification('REQUEST_CHANGES', 2, 5), 'changes-requested');
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
