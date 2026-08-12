import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reviewVerdictPasses } from '../lib/review-verdict.mjs';

const sha = 'a'.repeat(40);
const valid = {
  verdict: 'PASS', approved: true, reviewerEditedFiles: false, sha,
  findings: [{ severity: 'MINOR', current: false }],
};

test('review clearance requires an exact approved, read-only PASS at both expected SHAs', () => {
  assert.equal(reviewVerdictPasses('security-reviewer', valid, sha, sha), true);
  assert.equal(reviewVerdictPasses('verifier', valid, sha, sha), true);

  for (const mutation of [
    { verdict: 'REQUEST_CHANGES' },
    { verdict: 'BLOCKED' },
    { approved: false },
    { approved: undefined },
    { reviewerEditedFiles: true },
    { reviewerEditedFiles: undefined },
    { sha: 'b'.repeat(40) },
    { sha: undefined },
  ]) assert.equal(reviewVerdictPasses('security-reviewer', { ...valid, ...mutation }, sha, sha), false);

  assert.equal(reviewVerdictPasses('security-reviewer', valid, 'b'.repeat(40), sha), false);
  assert.equal(reviewVerdictPasses('security-reviewer', valid, sha, 'b'.repeat(40)), false);
});

test('every review clearance rejects current major/blocker and malformed findings fail closed', () => {
  for (const findings of [
    [{ severity: 'BLOCKER', current: true }],
    [{ severity: 'MAJOR', current: true }],
    null,
    [{}],
    [{ severity: 'UNKNOWN', current: false }],
    [{ severity: 'MINOR' }],
    [{ severity: 'MINOR', current: 'false' }],
  ]) for (const role of ['verifier', 'security-reviewer']) {
    assert.equal(reviewVerdictPasses(role, { ...valid, findings }, sha, sha), false, `${role}: ${JSON.stringify(findings)}`);
  }
});
