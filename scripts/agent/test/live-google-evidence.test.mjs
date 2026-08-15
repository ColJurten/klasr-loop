import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { closingIssueReference, pullRequestMatchesIssue, resolveCiPullRequest, resolveLivePullRequest } from '../lib/pull-request.mjs';

const root = new URL('../../../', import.meta.url);
const head = readFileSync(new URL('.git/HEAD', root), 'utf8').trim();
const sha = head.startsWith('ref: ') ? readFileSync(new URL(`.git/${head.slice(5)}`, root), 'utf8').trim() : head;

function functionBody(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{`));
  assert.notEqual(start, -1, `Missing ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`Unclosed ${name}`);
}

test('publisher source contains no literal repository SHA', () => {
  const source = readFileSync(new URL('../../publish-live-google-status.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /[0-9a-f]{40}/);
  assert.match(source, /EXPECTED_BRANCH/);
  assert.match(source, /resolveLivePullRequest/);
});

test('EXPECTED_BRANCH requires exact ref, SHA, and a same-repository closing reference', () => {
  const pr = { state: 'open', head: { ref: 'custom-branch', sha }, body: 'Closes #13' };
  const repository = 'ColJurten/klasr-loop';
  assert.equal(pullRequestMatchesIssue(pr, sha, 13, 'custom-branch', repository), true);
  assert.equal(pullRequestMatchesIssue({ ...pr, body: 'cLoSeS coljurten/KLASR-loop#13' }, sha, 13, 'custom-branch', repository), true);
  assert.equal(pullRequestMatchesIssue({ ...pr, body: 'Closes other/repo#13' }, sha, 13, 'custom-branch', repository), false);
  assert.equal(pullRequestMatchesIssue({ ...pr, body: 'Closes #14' }, sha, 13, 'custom-branch', repository), false);
  assert.equal(pullRequestMatchesIssue(pr, 'b'.repeat(40), 13, 'custom-branch', repository), false);
  assert.equal(pullRequestMatchesIssue(pr, sha, 13, 'other-branch', repository), false);
  assert.equal(pullRequestMatchesIssue({ ...pr, head: { ref: 'feature/13-task', sha }, body: 'Closes #13' }, sha, 13, 'custom-branch', repository), false);
  assert.equal(pullRequestMatchesIssue({ ...pr, head: { ref: 'feature/13-task', sha }, body: '' }, sha, 13, undefined, repository), true);
  assert.equal(pullRequestMatchesIssue({ ...pr, head: { ref: 'feature/13-task', sha }, body: 'Closes other/repo#13' }, sha, 13, undefined, repository), false);
  assert.equal(pullRequestMatchesIssue({ ...pr, head: { ref: 'feature/13-task', sha }, body: 'Closes #14' }, sha, 13, undefined, repository), false);
});

test('live publisher rejects ambiguous matching open PRs', () => {
  const repository = 'owner/repo';
  const pr = { state: 'open', head: { ref: 'feature/13-task', sha }, body: 'Closes #13' };
  assert.equal(resolveLivePullRequest([pr, { ...pr, number: 2 }], sha, 13, undefined, repository), undefined);
  assert.equal(resolveLivePullRequest([pr], sha, 13, undefined, repository), pr);
});

test('closing issue reference accepts only one exact same-repository token', () => {
  const repository = 'ColJurten/klasr-loop';
  assert.equal(closingIssueReference('Closes #13', repository), 13);
  assert.equal(closingIssueReference('cLoSeS coljurten/KLASR-loop#13', repository), 13);
  for (const body of [
    'Closes evil#13',
    'Closes text(#13)',
    'Closes foo#13 bar',
    'Closes #13 extra prose',
    'Closes #13 #14',
    'Closes #13\nFixes #13',
    'Closes other/repo#13',
    'Closes owner//repo#13',
    'Closes /repo#13',
    'Closes owner/#13',
    'Closes #0',
  ]) assert.equal(closingIssueReference(body, repository), undefined, body);
});

test('CI recovery resolves noncanonical PR 14 to its sole same-repository closing issue 13', () => {
  const repository = 'ColJurten/klasr-loop';
  const pr = { number: 14, state: 'open', head: { ref: 'feature/agentic-workflow-v3', sha, repo: { full_name: repository } }, base: { repo: { full_name: repository } }, body: 'Closes #13' };
  assert.deepEqual(resolveCiPullRequest([pr], repository, pr.head.ref, sha), { pr, issue: 13 });
});

test('CI recovery fails closed for hostile PR ambiguity and issue disagreement', () => {
  const repository = 'owner/repo';
  const pr = (body, ref = 'feature/13-task') => ({ number: 14, state: 'open', head: { ref, sha, repo: { full_name: repository } }, base: { repo: { full_name: repository } }, body });
  for (const candidate of [
    pr('Closes #13\nFixes #14'),
    pr('Closes #13, #14'),
    pr('Closes other/repo#13'),
    pr('Closes nope'),
    pr('Closes #14'),
  ]) assert.equal(resolveCiPullRequest([candidate], repository, candidate.head.ref, sha), undefined);
  assert.equal(resolveCiPullRequest([pr('Closes #13'), { ...pr('Closes #13'), number: 15 }], repository, 'feature/13-task', sha), undefined);
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

test('live runner proves quota-safe fixture restoration and chooses decisions from UI evidence', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /files\.create|uploadType=multipart|multipart\/related|function uploadFile/);
  assert.doesNotMatch(source, /\/upload\/drive\/v3\/files\?/);
  assert.match(source, /function createFolder/);
  assert.match(source, /parents: \[inputFolder\.id\]/);
  assert.match(source, /chooseBrowserItem\(page, runName, "Lancer l'organisation"/);
  assert.match(source, /itemExternalId: inputFolder\.id/);
  assert.match(source, /uploadType=media/);
  assert.match(source, /fixtureSnapshots\.length === 2/);
  assert.match(source, /downloadBytes\(snapshot\.id\)/);
  assert.match(source, /replaceBytes\(manualFixture\.id, manualBytes\)/);
  const run = spawnSync(process.execPath, ['scripts/live-google-service-account.mjs', '--decision-selection-check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'live runner fixture restoration and decision selection check PASS\n');
});

test('live runner keeps crash recovery inside Drive revisions without local byte backups', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  const startupRecovery = source.indexOf('await recoverMarkedFixtures();');
  assert(startupRecovery !== -1 && startupRecovery < source.indexOf('await listChildren(sharedRootId)', startupRecovery) && startupRecovery < source.indexOf('selectFixtures(rootItems)', startupRecovery));
  const discovery = functionBody(source, 'recoveryCandidates');
  assert.match(discovery, /appProperties has \{ key='klasrRecoveryScope' and value='/);
  for (const candidate of [discovery, functionBody(source, 'markedCandidates')]) {
    for (const value of ["corpora: 'drive'", "corpora: 'allDrives'", 'driveId', "supportsAllDrives: 'true'", "includeItemsFromAllDrives: 'true'"]) assert.match(candidate, new RegExp(value));
    assert.doesNotMatch(candidate, /q: [^,]*(?:parents|name|trashed)/);
  }
  assert.doesNotMatch(discovery, /q: `[^`]*(?:parents|name|trashed)/);
  const recover = functionBody(source, 'recoverMarkedFixtures');
  assert.match(recover, /accessToken = await serviceAccountToken\(\)/);
  assert.doesNotMatch(recover, /assert\(driveId/);
  assert.match(recover, /assert\(candidates\.length <= 1/);
  assert.match(recover, /Malformed or unexpected Drive recovery marker/);
  assert.match(recover, /candidates\.length === expected\.length[\s\S]*Recovery marker discovery is inconsistent/);
  assert.match(recover, /assert\(revisionId, 'Exact Drive recovery marker is missing'\)/);
  assert.match(recover, /parents: \[sharedRootId\], trashed: false/);
  assert.match(recover, /await restoreFromRevision\(item, revisionId, \{ name: fixtureNames\[index\]/);
  assert.match(source, /await pinOriginalRevision\(invoiceFixture\)[\s\S]*await markRecovery\(invoiceFixture\.id,[\s\S]*await replaceBytes\(invoiceFixture\.id/);
  assert.match(source, /await pinOriginalRevision\(manualFixture\)[\s\S]*await markRecovery\(manualFixture\.id,[\s\S]*await replaceBytes\(manualFixture\.id/);
  assert.match(source, /revisions\/[\s\S]*alt=media/);
  assert.match(source, /appProperties/);
  assert.doesNotMatch(source, /backup(?:Path|File)|writeFileSync\([^)]*(?:bytes|content|snapshot)/i);
  assert.match(functionBody(source, 'restoreFixtures'), /if \(!revisionId\) \{ assert\(await fixtureMatches\(snapshot\)/);
  const restore = functionBody(source, 'restoreFromRevision');
  assert.match(restore, /const originalBytes = await downloadRevision\(item\.id, revisionId\)/);
  assert.doesNotMatch(restore, /const originalBytes = await downloadBytes\(item\.id\)/);
  const readback = restore.indexOf("'Drive revision restoration readback failed'");
  assert(readback !== -1 && readback < restore.indexOf('finishRecovery('));
  assert.match(restore.slice(0, readback), /sameBytes\(originalBytes, target\.bytes\)/);
  const finish = functionBody(source, 'finishRecovery');
  const clearReadback = "assert(!recoveryMarker(await metadata(id), scope), 'Drive recovery marker clear readback failed')";
  assert(finish.indexOf('klasrRecoveryRevision: null') < finish.indexOf(clearReadback) && finish.indexOf(clearReadback) < finish.indexOf('keepForever: false'));
  assert.match(functionBody(source, 'pinOriginalRevision'), /body: JSON\.stringify\(\{ keepForever: true \}\)[\s\S]*assert\(revision\.id === current\.headRevisionId && revision\.keepForever === true/);
  assert.match(functionBody(source, 'markRecovery'), /await drive\([\s\S]*assert\(recoveryMarker\(await metadata\(id\), scope\) === revisionId/);
  const midRunRestore = source.indexOf('await restoreFixtures(false);');
  assert(midRunRestore !== -1 && midRunRestore < source.indexOf('const correctionFixture'));
});

test('live runner routes signals and fatal errors through bounded single-flight recovery with fresh tokens', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  for (const event of ['SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException', 'unhandledRejection']) assert.match(source, new RegExp(`process\\.on\\('${event}'`));
  assert.match(source, /let emergencyCleanupFlight/);
  assert.match(source, /let restorationFlight/);
  const emergency = functionBody(source, 'emergencyExit');
  assert.match(emergency, /Promise\.allSettled\(\[restoreFixtures\(\)\]\)/);
  assert.match(emergency, /createdIds/);
  assert.match(emergency, /Promise\.race/);
  assert.match(emergency, /delay\(90_000, 'timeout'\)/);
  assert.match(emergency, /process\.stderr\.write/);
  assert.match(emergency, /process\.exit\(outcome === 'restored' \? code : 1\)/);
  assert.match(emergency, /assert\(restoration\[0\]\.status === 'fulfilled'/);
  assert.doesNotMatch(emergency, /fixtureSnapshots|observedReplacements|downloadBytes|originalBytes/);
  const fatal = functionBody(source, 'fatalExit');
  assert.match(fatal, /if \(normalCleanupDone\) \{ process\.exitCode = 1; return; \}/);
  assert.match(fatal, /root failure:/);
  assert.doesNotMatch(fatal, /fixtureSnapshots|observedReplacements|downloadBytes|originalBytes|JSON\.stringify/);
  const restore = functionBody(source, 'restoreFixtures');
  assert.match(restore, /if \(restorationFlight\) return restorationFlight/);
  assert.match(restore, /await restoreFromRevision\(snapshot, revisionId/);
  assert.match(restore, /finally \{ restorationFlight = undefined; \}/);
  assert.match(restore, /assert\(results\.every\(\(\{ status \}\) => status === 'fulfilled'\)/);
  assert.match(restore, /assert\(restorationVerified\(fixtureSnapshots, restored/);
  assert.match(restore, /accessToken = await serviceAccountToken\(\)/);
  const cleanupVerified = functionBody(source, 'cleanupVerified');
  assert.match(cleanupVerified, /if \(!fixtureSnapshots\.length\) return false/);
  assert.match(cleanupVerified, /accessToken = await serviceAccountToken\(\)/);
  assert.match(cleanupVerified, /recoveryMarker\(current, /);
  assert.match(functionBody(source, 'recoverMarkedFixtures'), /accessToken = await serviceAccountToken\(\)/);
  assert.match(functionBody(source, 'restorationVerified'), /replacement\.bytes === undefined \|\| !sameBytes\(snapshot\.bytes, replacement\.bytes\)/);
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

test('publisher derives the FAIL event key from recomputed completeness', () => {
  const manifest = {
    version: 1, identity: 'Google service account non-production acceptance', sha, issue: 13, attempt: 2, status: 'PASS',
    results: Object.fromEntries(['service_account_auth', 'drive_listing', 'drive_download_ocr', 'proposal_review', 'confirm_mutation', 'correction_mutation', 'reject_mutation', 'terminal_no_reenqueue', 'desktop_browser', 'mobile_390_browser', 'launch_completion', 'fresh_provider_metadata'].map((key) => [key, key !== 'service_account_auth'])),
    cleanup: { fixture_restored: true, created_items_removed: true, tenant_cleaned: true }, processes: { apps_stopped: true, no_orphans: true },
  };
  const run = spawnSync(process.execPath, ['scripts/publish-live-google-status.mjs', '--dry-run', '-'], { cwd: root, input: JSON.stringify(manifest), encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_REPOSITORY: 'owner/repo', DRY_RUN_CURRENT_HEAD_SHA: sha } });
  assert.notEqual(run.status, 0);
  assert.match(JSON.parse(run.stdout).failure_dispatch.client_payload.event_key, /:FAIL$/);
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
