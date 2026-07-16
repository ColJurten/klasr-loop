import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emptyControl,
  hasProcessed,
  MAX_TRACKED_EVENTS,
  parseControl,
  recordEvent,
  renderControlComment,
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
