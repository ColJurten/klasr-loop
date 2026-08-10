import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasSuccessfulLiveGoogleStatus } from '../lib/live-google-status.mjs';

const sha = 'a'.repeat(40);
const payload = (overrides = {}) => ({
  sha,
  statuses: [{ context: 'klasr/live-google', state: 'success' }],
  ...overrides,
});

test('accepts a successful live Google status for the exact combined-status SHA', () => {
  assert.equal(hasSuccessfulLiveGoogleStatus(payload(), sha), true);
});

test('rejects missing, stale, pending, and failed live Google statuses', () => {
  assert.equal(hasSuccessfulLiveGoogleStatus({}, sha), false);
  assert.equal(hasSuccessfulLiveGoogleStatus(payload({ sha: 'b'.repeat(40) }), sha), false);
  assert.equal(hasSuccessfulLiveGoogleStatus(payload({ statuses: [{ context: 'klasr/live-google', state: 'pending' }] }), sha), false);
  assert.equal(hasSuccessfulLiveGoogleStatus(payload({ statuses: [{ context: 'klasr/live-google', state: 'failure' }] }), sha), false);
  assert.equal(hasSuccessfulLiveGoogleStatus(payload({ statuses: [] }), sha), false);
});
