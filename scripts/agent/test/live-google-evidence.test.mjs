import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../../', import.meta.url);
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

test('publisher source contains no literal repository SHA', () => {
  const source = readFileSync(new URL('../../publish-live-google-status.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /[0-9a-f]{40}/);
  assert.match(source, /EXPECTED_BRANCH/);
  assert.match(source, /item\.head\?\.sha === sha/);
});

test('live runner evidence self-check enforces the sanitized manifest allowlist', () => {
  const run = spawnSync(process.execPath, ['scripts/live-google-service-account.mjs', '--evidence-self-check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'live evidence schema check PASS\n');
});

test('live runner lifecycle check closes owned process groups and ports', () => {
  const run = spawnSync(process.execPath, ['scripts/live-google-service-account.mjs', '--lifecycle-check'], { cwd: root, encoding: 'utf8', timeout: 15_000 });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'live runner lifecycle check PASS\n');
});

test('publisher dry-run emits only a sanitized success status and performs no network', () => {
  const manifest = JSON.stringify({
    version: 1, identity: 'Google service account non-production acceptance', sha, issue: 13, attempt: 2,
    status: 'PASS',
    results: {
      service_account_auth: true, drive_listing: true, drive_download_ocr: true,
      proposal_review: true, confirm_mutation: true, correction_mutation: true,
      reject_mutation: true, terminal_no_reenqueue: true, desktop_browser: true,
      mobile_390_browser: true, launch_completion: true, fresh_provider_metadata: true,
    },
    cleanup: { fixture_restored: true, created_items_removed: true, tenant_cleaned: true },
    processes: { apps_stopped: true, no_orphans: true },
  });
  const run = spawnSync(process.execPath, ['scripts/publish-live-google-status.mjs', '--dry-run', '-'], {
    cwd: root, input: manifest, encoding: 'utf8', env: {
      PATH: process.env.PATH, GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'must-not-be-read-in-dry-run',
      DRY_RUN_CURRENT_HEAD_SHA: sha,
      DRY_RUN_WORKFLOW_RUNS: JSON.stringify({ workflow_runs: [{ id: 91, head_sha: sha, conclusion: 'failure', live_evidence_pending: true, created_at: '2026-08-07T00:00:00Z' }] }),
    },
  });
  assert.equal(run.status, 0, run.stderr);
  const actions = JSON.parse(run.stdout);
  assert.deepEqual(actions.status, { state: 'success', context: 'klasr/live-google', description: 'Sanitized live Google evidence passed' });
  assert.deepEqual(actions.rerun, { workflow_run_id: 91, endpoint: '/repos/owner/repo/actions/runs/91/rerun-failed-jobs' });
  assert.equal(actions.failure_dispatch, undefined);
  assert.equal(actions.success_dispatch, undefined);
  assert.match(actions.comment.marker, new RegExp(sha));
  assert.doesNotMatch(`${run.stdout}${run.stderr}`, /must-not-be-read|provider.?id|filename|ocr.?text|credential|\.png|\/tmp\//i);
});

test('publisher fails closed for wrong SHA or failed required proof', () => {
  const base = {
    version: 1, identity: 'Google service account non-production acceptance', sha, issue: 13, attempt: 2, status: 'FAIL',
    results: Object.fromEntries(['service_account_auth', 'drive_listing', 'drive_download_ocr', 'proposal_review', 'confirm_mutation', 'correction_mutation', 'reject_mutation', 'terminal_no_reenqueue', 'desktop_browser', 'mobile_390_browser', 'launch_completion', 'fresh_provider_metadata'].map((key) => [key, false])),
    cleanup: { fixture_restored: false, created_items_removed: false, tenant_cleaned: false },
    processes: { apps_stopped: false, no_orphans: false },
  };
  const wrongSha = spawnSync(process.execPath, ['scripts/publish-live-google-status.mjs', '--dry-run', '-'], { cwd: root, input: JSON.stringify({ ...base, sha: 'a'.repeat(40) }), encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_REPOSITORY: 'owner/repo' } });
  assert.notEqual(wrongSha.status, 0);
  assert.equal(wrongSha.stdout, '');
  const failed = spawnSync(process.execPath, ['scripts/publish-live-google-status.mjs', '--dry-run', '-'], { cwd: root, input: JSON.stringify(base), encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_REPOSITORY: 'owner/repo', DRY_RUN_CURRENT_HEAD_SHA: sha } });
  assert.notEqual(failed.status, 0);
  const actions = JSON.parse(failed.stdout);
  assert.deepEqual(actions.status, { state: 'failure', context: 'klasr/live-google', description: 'Sanitized live Google evidence failed' });
  assert.equal(actions.failure_dispatch.event_type, 'agent.acceptance');
  assert.equal(actions.failure_dispatch.client_payload.event_key, `live-evidence:13:${sha}:2:FAIL`);
  assert.equal(actions.rerun, undefined);
});

test('publisher dry-run fails closed for a stale current head or no matching failed CI run', () => {
  const manifest = {
    version: 1, identity: 'Google service account non-production acceptance', sha, issue: 13, attempt: 2, status: 'PASS',
    results: Object.fromEntries(['service_account_auth', 'drive_listing', 'drive_download_ocr', 'proposal_review', 'confirm_mutation', 'correction_mutation', 'reject_mutation', 'terminal_no_reenqueue', 'desktop_browser', 'mobile_390_browser', 'launch_completion', 'fresh_provider_metadata'].map((key) => [key, true])),
    cleanup: { fixture_restored: true, created_items_removed: true, tenant_cleaned: true },
    processes: { apps_stopped: true, no_orphans: true },
  };
  for (const env of [
    { DRY_RUN_CURRENT_HEAD_SHA: 'b'.repeat(40), DRY_RUN_WORKFLOW_RUNS: '[]' },
    { DRY_RUN_CURRENT_HEAD_SHA: sha, DRY_RUN_WORKFLOW_RUNS: JSON.stringify([{ id: 1, head_sha: 'b'.repeat(40), conclusion: 'failure', created_at: '2026-08-07T00:00:00Z' }]) },
  ]) {
    const run = spawnSync(process.execPath, ['scripts/publish-live-google-status.mjs', '--dry-run', '-'], { cwd: root, input: JSON.stringify(manifest), encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_REPOSITORY: 'owner/repo', ...env } });
    assert.notEqual(run.status, 0);
    assert.equal(run.stdout, '');
  }
});

test('publisher dispatches acceptance directly when exact-SHA CI already succeeded', () => {
  const manifest = {
    version: 1, identity: 'Google service account non-production acceptance', sha, issue: 13, attempt: 2, status: 'PASS',
    results: Object.fromEntries(['service_account_auth', 'drive_listing', 'drive_download_ocr', 'proposal_review', 'confirm_mutation', 'correction_mutation', 'reject_mutation', 'terminal_no_reenqueue', 'desktop_browser', 'mobile_390_browser', 'launch_completion', 'fresh_provider_metadata'].map((key) => [key, true])),
    cleanup: { fixture_restored: true, created_items_removed: true, tenant_cleaned: true }, processes: { apps_stopped: true, no_orphans: true },
  };
  const run = spawnSync(process.execPath, ['scripts/publish-live-google-status.mjs', '--dry-run', '-'], { cwd: root, input: JSON.stringify(manifest), encoding: 'utf8', env: {
    PATH: process.env.PATH, GITHUB_REPOSITORY: 'owner/repo', DRY_RUN_CURRENT_HEAD_SHA: sha,
    DRY_RUN_WORKFLOW_RUNS: JSON.stringify([{ id: 92, head_sha: sha, conclusion: 'success', created_at: '2026-08-07T01:00:00Z' }]),
  } });
  assert.equal(run.status, 0, run.stderr);
  const actions = JSON.parse(run.stdout);
  assert.equal(actions.success_dispatch.event_type, 'agent.acceptance');
  assert.equal(actions.success_dispatch.client_payload.event_key, `live-evidence:13:${sha}:2:PASS`);
  assert.equal(actions.rerun, undefined);
});

test('publisher rejects malformed expected and manifest SHAs', () => {
  const manifest = {
    version: 1, identity: 'Google service account non-production acceptance', sha: 'not-a-sha', issue: 1, attempt: 1, status: 'PASS',
    results: Object.fromEntries(['service_account_auth', 'drive_listing', 'drive_download_ocr', 'proposal_review', 'confirm_mutation', 'correction_mutation', 'reject_mutation', 'terminal_no_reenqueue', 'desktop_browser', 'mobile_390_browser', 'launch_completion', 'fresh_provider_metadata'].map((key) => [key, true])),
    cleanup: { fixture_restored: true, created_items_removed: true, tenant_cleaned: true }, processes: { apps_stopped: true, no_orphans: true },
  };
  for (const env of [{ PATH: process.env.PATH }, { PATH: process.env.PATH, EXPECTED_SHA: 'A'.repeat(40) }]) {
    const run = spawnSync(process.execPath, ['scripts/publish-live-google-status.mjs', '--dry-run', '-'], { cwd: root, input: JSON.stringify(manifest), encoding: 'utf8', env });
    assert.notEqual(run.status, 0);
    assert.equal(run.stdout, '');
  }
});

test('live runner rejects invalid lineage before credential access', () => {
  for (const lineage of [
    { KLASR_EVIDENCE_SHA: 'bad', KLASR_EVIDENCE_ISSUE: '1', KLASR_EVIDENCE_ATTEMPT: '1' },
    { KLASR_EVIDENCE_SHA: sha, KLASR_EVIDENCE_ISSUE: '0', KLASR_EVIDENCE_ATTEMPT: '1' },
    { KLASR_EVIDENCE_SHA: sha, KLASR_EVIDENCE_ISSUE: '1', KLASR_EVIDENCE_ATTEMPT: '1.5' },
  ]) {
    const run = spawnSync(process.execPath, ['scripts/live-google-service-account.mjs'], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, ...lineage } });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /evidence lineage/i);
    assert.doesNotMatch(run.stderr, /KLASR_GOOGLE_SERVICE_ACCOUNT_FILE/);
  }
});
