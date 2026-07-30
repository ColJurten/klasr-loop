import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractFingerprint, fingerprint, fingerprintMarker, normalizeSignature } from '../lib/fingerprint.mjs';

test('fingerprint is stable across volatile noise', () => {
  const base = { category: 'ci-failure', workflow: 'ci', job: 'api', path: 'apps/api' };
  const a = fingerprint({ ...base, signature: 'FAIL tests at 2026-07-14T10:00:00Z commit abc1234 line src/x.ts:42:7 took 3.2s' });
  const b = fingerprint({ ...base, signature: 'FAIL tests at 2026-07-15T09:30:11Z commit def5678 line src/x.ts:57:2 took 1.1s' });
  assert.equal(a, b);
});

test('different failures produce different fingerprints', () => {
  const a = fingerprint({ category: 'ci-failure', workflow: 'ci', job: 'api', path: 'x', signature: 'TypeError' });
  const b = fingerprint({ category: 'ci-failure', workflow: 'ci', job: 'web', path: 'x', signature: 'TypeError' });
  assert.notEqual(a, b);
});

test('marker embeds and extracts', () => {
  const fp = fingerprint({ category: 'c', workflow: 'w', job: 'j', path: 'p', signature: 's' });
  assert.equal(extractFingerprint(`intro\n${fingerprintMarker(fp)}\nrest`), fp);
});

test('normalizeSignature strips timestamps, shas, line numbers, durations', () => {
  const out = normalizeSignature('2026-07-14T10:00:00Z abc1234def src/x.ts:42:7 3.2s');
  assert.ok(!out.includes('2026'));
  assert.ok(!out.includes('abc1234def'));
  assert.ok(!out.includes(':42'));
});
