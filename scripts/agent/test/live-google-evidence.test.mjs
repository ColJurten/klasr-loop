import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { closingIssueReference, pullRequestMatchesIssue, resolveCiPullRequest, resolveLivePullRequest } from '../lib/pull-request.mjs';
import { assertTreeBinding, computeTreeBinding, parseObservedRecord, resolveEvidenceRunDir } from '../../live-google-evidence.mjs';

const root = new URL('../../../', import.meta.url);
const head = readFileSync(new URL('.git/HEAD', root), 'utf8').trim();
const sha = head.startsWith('ref: ') ? readFileSync(new URL(`.git/${head.slice(5)}`, root), 'utf8').trim() : head;
const treeBinding = { schema: 'klasr-tree-v1', mode: 'sha', head: sha, digest: sha };
const observedRecord = { schema: 'klasr-live-observed-v1', stage: 'settings-deleted', selectedModelId: 'claude-safe', modelCount: 2, modelUsed: 'anthropic/claude-safe', tree: treeBinding };
const liveResultKeys = ['anthropic_discovery', 'anthropic_setting_saved', 'anthropic_classification', 'anthropic_setting_removed', 'service_account_auth', 'drive_listing', 'drive_download_ocr', 'proposal_review', 'confirm_mutation', 'correction_mutation', 'reject_mutation', 'terminal_no_reenqueue', 'desktop_browser', 'mobile_390_browser', 'launch_completion', 'fresh_provider_metadata'];

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
  assert.equal(closingIssueReference('## What & why\r\n\r\nCloses #16\r\n\r\n## Type\r\n- [ ] feat  - [ ] fix  - [ ] hotfix  - [ ] chore/docs/ci', repository), 16);
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
  const directory = mkdtempSync(path.join(tmpdir(), 'klasr-live-evidence-'));
  const canonicalFiles = [
    new URL('.tmp/hermes/ux-clarity/evidence/item-3/provider-proof.sanitized.json', root),
    new URL('.tmp/hermes/ux-clarity/evidence/item-4/provider-proof.sanitized.json', root),
  ];
  const before = canonicalFiles.map((file) => existsSync(file) ? readFileSync(file) : null);
  const run = spawnSync(process.execPath, ['scripts/live-google-service-account.mjs', '--evidence-self-check'], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, KLASR_FATAL_CHECK_DIR: directory } });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'live evidence schema check PASS\n');
  assert.deepEqual(canonicalFiles.map((file) => existsSync(file) ? readFileSync(file) : null), before);

  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  const results = functionBody(source, 'sanitizedManifest');
  const schema = functionBody(source, 'assertManifest');
  const markdown = functionBody(source, 'realAcceptanceMarkdown');
  const item4Schema = functionBody(source, 'assertItem4Proof');
  const item3Schema = functionBody(source, 'assertItem3Proof');
  assert.match(markdown, /Task:.*\$\{task\}/s);
  assert.match(markdown, /Attempt:.*\$\{manifest\.attempt\}/s);
  assert.match(item4Schema, /schema.*klasr-item4-provider-proof-v1/s);
  assert.match(item4Schema, /proof\.task.*task/s);
  assert.match(item4Schema, /proof\.attempt.*proofLineage\.attempt/s);
  assert.match(item4Schema, /assertTreeBinding\(tree, proof\.tree\)/);
  assert.match(item3Schema, /schema.*klasr-item3-provider-proof-v1/s);
  assert.match(item3Schema, /proof\.task.*task/s);
  assert.match(item3Schema, /proof\.attempt.*proofLineage\.attempt/s);
  assert.match(item3Schema, /assertTreeBinding\(tree, proof\.tree\)/);
  for (const key of ['anthropic_discovery', 'anthropic_setting_saved', 'anthropic_classification', 'anthropic_setting_removed']) {
    assert.match(results, new RegExp(`${key}:`), `${key} must bind manifest PASS`);
    assert.match(schema, new RegExp(`results\\) === '[^']*${key}`), `${key} must be allowlisted in the exact result schema`);
  }
});

test('Item 5 evidence paths are issue-attempt-task-run scoped and distinct', () => {
  const repo = path.resolve(new URL('../../../', import.meta.url).pathname);
  const lineage = { issue: 5, attempt: 5 };
  const first = resolveEvidenceRunDir(repo, lineage, 't_a5e1271c', 'run-a');
  const second = resolveEvidenceRunDir(repo, lineage, 't_a5e1271c', 'run-b');
  assert.notEqual(first, second);
  for (const resolved of [first, second]) {
    assert.match(resolved, /evidence\/item-5\/attempt-5\/runs\/t_a5e1271c-run-[ab]$/);
    assert.doesNotMatch(resolved, /evidence\/item-[34](?:\/|$)/);
  }
});

test('Item 5 runner retains borrowed bytes and gates Anthropic no_destination_match', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  const branch = source.slice(source.indexOf('if (lineage.issue === 5) {'), source.indexOf('} else {', source.indexOf('if (lineage.issue === 5) {')));
  assert.doesNotMatch(branch, /replaceBytes\(/);
  assert.match(branch, /originalBytesRetained/);
  assert.match(branch, /modelUsed.*anthropic/);
  assert.match(branch, /reviewReason === 'no_destination_match'/);
  assert.match(branch, /reviewReason !== 'extraction_failed'/);
  assert.match(branch, /live-google-sa-item-5-post-validation-1280\.png/);
});

test('service-account proof gets scope from tokeninfo and identity from Drive about', () => {
  const run = spawnSync(process.execPath, ['scripts/live-google-service-account.mjs', '--provider-identity-self-check'], {
    cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, KLASR_EVIDENCE_TASK: 't_selfcheck', KLASR_EVIDENCE_SHA: sha, KLASR_EVIDENCE_ISSUE: '3', KLASR_EVIDENCE_ATTEMPT: '21' },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'provider identity read-back check PASS\n');

  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(functionBody(source, 'providerTokenInfo'), /\.email|emailAddress|client_email/);
  assert.match(functionBody(source, 'providerDriveIdentity'), /\/drive\/v3\/about\?fields=user%28emailAddress%29/);
});

test('live runner contracts real tenant Anthropic BYOK before Google mutation', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  const preflight = source.indexOf('await assertNoPriorTenantSetting(organizationId)');
  const driveMutation = source.indexOf('await createFolder(runName, sharedRootId)');
  assert(preflight !== -1 && driveMutation !== -1 && preflight < driveMutation, 'Tenant preflight must precede Drive mutation');
  assert.match(source, /required\('KLASR_LIVE_ANTHROPIC_API_KEY'\)/);
  assert.match(source, /await configureAnthropicServerSide\(/);
  assert.doesNotMatch(source, /configureAnthropicInBrowser/);
  for (const sink of ['fill', 'type', 'evaluate', 'screenshot', 'tracing']) assert.doesNotMatch(source, new RegExp(`\\.${sink}\\([^)]*(?:anthropicKey|secret|apiKey)`, 'i'));
  assert.doesNotMatch(source, /process\.argv[\s\S]{0,200}(?:anthropicKey|secret|apiKey)|console\.[^(]+\([^)]*(?:anthropicKey|secret|apiKey)|writeFileSync\([^)]*(?:anthropicKey|secret|apiKey)/i);
  const setup = functionBody(source, 'configureAnthropicServerSide');
  assert.match(setup, /context\.cookies\(webBase\)/);
  assert.match(setup, /fetch\(`\$\{webBase\}\/api\/llm-settings`/);
  assert.doesNotMatch(setup, /prisma\.llmSetting\.(?:create|update|upsert)/);
  assert.match(functionBody(source, 'selectEligibleAnthropicModel'), /filter[\s\S]*sort[\s\S]*at\(-1\)/);
  assert.match(source, /modelUsed: \{ contains: `anthropic\/\$\{selectedAnthropicModel\}` \}/);
  assert.match(source, /await page\.getByRole\('button', \{ name: 'Supprimer la configuration' \}\)\.click\(\)/);
  assert.match(source, /evidence\.anthropicSettingRemoved = 'PASS'/);
  assert.match(source, /tenant_setting_absent/);
});

test('exact tree binding is stable, sensitive, excludes evidence and rejects mismatch', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'klasr-tree-'));
  writeFileSync(path.join(directory, 'tracked.txt'), 'one');
  const options = { head: 'a'.repeat(40), tracked: ['tracked.txt'], untracked: [] };
  const first = computeTreeBinding(directory, options);
  assert.deepEqual(computeTreeBinding(directory, options), first);
  writeFileSync(path.join(directory, 'tracked.txt'), 'two');
  const changed = computeTreeBinding(directory, options); assert.notEqual(changed.digest, first.digest);
  writeFileSync(path.join(directory, 'new.bin'), Buffer.from([0, 255, 1]));
  assert.notEqual(computeTreeBinding(directory, { ...options, untracked: ['new.bin'] }).digest, changed.digest);
  writeFileSync(path.join(directory, '.env'), 'credential'); writeFileSync(path.join(directory, '.env.example'), 'example credential'); writeFileSync(path.join(directory, 'run.log'), 'generated');
  assert.deepEqual(computeTreeBinding(directory, { ...options, tracked: [...options.tracked, '.env.example'], untracked: ['.env', 'run.log'] }), changed);
  assert.throws(() => assertTreeBinding(first, changed), /tree_binding_mismatch/);
});

test('observed live record has an exact metadata-only schema and binds model plus tree', () => {
  const tree = { schema: 'klasr-tree-v1', mode: 'worktree', head: 'a'.repeat(40), digest: 'b'.repeat(64) };
  const valid = { schema: 'klasr-live-observed-v1', stage: 'settings-deleted', selectedModelId: 'claude-safe', modelCount: 3, modelUsed: 'anthropic/claude-safe', tree };
  assert.deepEqual(parseObservedRecord(JSON.stringify(valid), tree), valid);
  for (const bad of [{}, { ...valid, modelCount: 0 }, { ...valid, modelUsed: 'anthropic/other' }, { ...valid, apiKey: 'secret' }, { ...valid, organizationId: 'org' }, { ...valid, tree: { ...tree, digest: 'c'.repeat(64) } }]) assert.throws(() => parseObservedRecord(JSON.stringify(bad), tree));
  assert.throws(() => parseObservedRecord('{', tree));
});

test('live runner visibly returns from BYOK settings before Drive browser selection', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  const afterByok = source.slice(source.indexOf('await configureAnthropicServerSide(context, anthropicKey)'), source.indexOf("await chooseBrowserItem(page, 'stg_tree'"));
  assert.match(afterByok, /getByText\(`Anthropic · \$\{selectedAnthropicModel\}`\)/);
  assert.match(afterByok, /getByLabel\('Clé API'\)\)\.toHaveValue\(''\)/);
  assert.match(afterByok, /getByRole\('link', \{ name: 'Tableau de bord' \}\)\.click\(\)/);
  assert.match(afterByok, /waitForURL\(\/\\\/dashboard\$\//);
  assert.match(afterByok, /getByText\('Validation staging · identité de service Google'\)\.waitFor\(\)/);
  assert.match(afterByok, /getByRole\('button', \{ name: 'Choisir ce dossier' \}\)\.waitFor\(\)/);
  assert.doesNotMatch(afterByok, /page\.(?:goto|reload)\(/);
});

test('live BYOK decisions are deterministic and reject missing prerequisites without credentials', () => {
  const decisions = spawnSync(process.execPath, ['scripts/live-google-service-account.mjs', '--byok-acceptance-self-check'], { cwd: root, encoding: 'utf8' });
  assert.equal(decisions.status, 0, decisions.stderr);
  assert.equal(decisions.stdout, 'live BYOK acceptance decisions check PASS\n');
  const directory = mkdtempSync(path.join(tmpdir(), 'klasr-live-preflight-'));
  const missing = spawnSync(process.execPath, ['scripts/live-google-service-account.mjs', '--preflight-lifecycle-check'], {
    cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, KLASR_FATAL_CHECK_DIR: directory, KLASR_EVIDENCE_TASK: 't_selfcheck', KLASR_EVIDENCE_SHA: sha, KLASR_EVIDENCE_ISSUE: '1', KLASR_EVIDENCE_ATTEMPT: '93' },
  });
  assert.notEqual(missing.status, 0);
  assert.equal(missing.stderr, 'root failure: stage=preflight\n');
  assert.equal(JSON.parse(readFileSync(path.join(directory, 'manifest.sanitized.json'), 'utf8')).status, 'FAIL');
  assert.doesNotMatch(missing.stdout, /PASS/);
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
  assert.match(source, /replaceBytes\(reviewFixture\.id, reviewBytes\)/);
  const run = spawnSync(process.execPath, ['scripts/live-google-service-account.mjs', '--decision-selection-check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, 'live runner fixture restoration and decision selection check PASS\n');
});

test('live runner keeps crash recovery inside Drive revisions without local byte backups', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  const startupRecovery = source.indexOf('await recoverMarkedFixtures();');
  assert(startupRecovery !== -1 && startupRecovery < source.indexOf('await listChildren(sharedRootId)', startupRecovery) && startupRecovery < source.indexOf('selectFixturePlan(rootItems)', startupRecovery));
  const discovery = functionBody(source, 'recoveryCandidates');
  assert.match(discovery, /appProperties has \{ key='klasrRecoveryScope' and value='/);
  assert.doesNotMatch(source, /function markedCandidates|markedCandidates\(/);
  assert.doesNotMatch(source, /appProperties has \{ key='klasrRecoveryRevision' \}/);
  for (const value of ["corpora: 'drive'", "corpora: 'allDrives'", 'driveId', "supportsAllDrives: 'true'", "includeItemsFromAllDrives: 'true'"]) assert.match(discovery, new RegExp(value));
  assert.doesNotMatch(discovery, /q: [^,]*(?:parents|name|trashed)/);
  assert.doesNotMatch(discovery, /q: `[^`]*(?:parents|name|trashed)/);
  const recover = functionBody(source, 'recoverMarkedFixtures');
  assert.match(recover, /accessToken = await serviceAccountToken\(\)/);
  assert.doesNotMatch(recover, /assert\(driveId/);
  assert.match(recover, /\['invoice', 'manual'\][\s\S]*recoveryCandidates\(scope, driveId\)/);
  assert.match(recover, /assert\(candidates\.length <= 1, 'Ambiguous Drive recovery marker'\)/);
  assert.match(recover, /const revisionId = recoveryMarker\(item, scope\)[\s\S]*assert\(revisionId, 'Exact Drive recovery marker is missing'\)[\s\S]*await restoreFromRevision\(item, revisionId/);
  assert.match(recover, /parents: \[sharedRootId\], trashed: false/);
  assert.match(recover, /await restoreFromRevision\(item, revisionId, \{ name: fixtureNames\[index\]/);
  assert.match(source, /await pinOriginalRevision\(invoiceFixture, invoiceSnapshot\.bytes\)[\s\S]*await markRecovery\(invoiceFixture\.id,[\s\S]*await replaceBytes\(invoiceFixture\.id/);
  assert.match(source, /await pinOriginalRevision\(reviewFixture, manualSnapshot\.bytes\)[\s\S]*await markRecovery\(reviewFixture\.id,[\s\S]*await replaceBytes\(reviewFixture\.id/);
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
  assert.doesNotMatch(source, /keepForever:\s*false/);
  assert.doesNotMatch(source, /revisions[^\n]*method:\s*'DELETE'/);
  assert(finish.indexOf('klasrRecoveryRevision: null') < finish.indexOf(clearReadback));
  const pin = functionBody(source, 'pinOriginalRevision');
  assert.match(pin, /listRevisions\(item\.id\)/);
  const revisionList = functionBody(source, 'listRevisions');
  assert.match(revisionList, /files\/\$\{encodeURIComponent\(id\)\}\/revisions\?\$\{query\}/);
  assert.match(revisionList, /fields: 'nextPageToken,revisions\(id,keepForever\)'/);
  assert.match(pin, /filter\(\(revision\) => revision\.keepForever === true\)/);
  assert.match(pin, /for \(const candidate of pinned\)[\s\S]*downloadRevision\(item\.id, candidate\.id\)[\s\S]*sameBytes\(candidateBytes, snapshotBytes\)[\s\S]*selectMatchingPinnedRevision\(candidates\)[\s\S]*return reusable\.id/);
  assert.match(functionBody(source, 'selectMatchingPinnedRevision'), /filter\(\(\{ matchesSnapshot \}\) => matchesSnapshot\)[\s\S]*sort\(\(left, right\) => left\.id\.localeCompare\(right\.id\)\)\[0\]/);
  const fallback = pin.indexOf('body: JSON.stringify({ keepForever: true })');
  assert(pin.indexOf('return reusable.id') < fallback);
  assert.match(pin.slice(fallback), /assert\(revision\.id === current\.headRevisionId && revision\.keepForever === true[\s\S]*drive\([\s\S]*assert\(verified\.id === revision\.id && verified\.keepForever === true/);
  assert.match(source, /pinOriginalRevision\(invoiceFixture, invoiceSnapshot\.bytes\)/);
  assert.match(source, /pinOriginalRevision\(reviewFixture, manualSnapshot\.bytes\)/);
  assert.match(functionBody(source, 'markRecovery'), /await drive\([\s\S]*assert\(recoveryMarker\(await metadata\(id\), scope\) === revisionId/);
  const midRunRestore = source.indexOf('await restoreFixtures(false);');
  assert(midRunRestore !== -1 && midRunRestore < source.indexOf('const correctionFixture'));
});

test('live runner quarantines a legacy holding folder outside ignore measurement and restores it exactly', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  assert.match(source, /const removedFolderName = '[^']+';/);
  assert.doesNotMatch(source.match(/const removedFolderName = .*;/)?.[0] ?? '', /`|\$\{/);
  const quarantine = functionBody(source, 'quarantineLegacyFolder');
  assert.match(quarantine, /assert\(matches\.length === 1, 'Expected exactly one legacy holding folder in the reference fixture'\)/);
  assert.match(quarantine, /legacyFolderSnapshot = await metadata\(folder\.id\)/);
  assert.match(quarantine, /assertLegacyFolderSnapshot\(legacyFolderSnapshot, parentId\)/);
  assert(quarantine.indexOf('await markLegacyFolderRecovery(folder.id, parentId)') < quarantine.indexOf('await restoreMetadata(folder.id,'));
  assert.match(quarantine, /parents: \[sharedRootId\]/);
  assert.match(quarantine, /assert\(legacyFolderMatches\(legacyFolderSnapshot, await metadata\(folder\.id\), false\)/);
  const setup = source.indexOf('await quarantineLegacyFolder(reference.id)');
  const measurement = source.indexOf('ignoreMutationCount = 0');
  const click = source.indexOf('await ignoreButton.click()');
  const assertion = source.indexOf("assert(ignoreMutationCount === 0, 'Ignore issued a Drive files.update or move mutation')");
  assert(setup !== -1 && setup < measurement && measurement < click && click < assertion);
  assert.match(source.slice(measurement, assertion), /finally \{\s*ignoreWindowOpen = false;/);
  const restore = functionBody(source, 'restoreLegacyFolder');
  assert.match(restore, /await restoreMetadata\(legacyFolderSnapshot\.id, legacyFolderSnapshot\)/);
  assert.match(restore, /await clearLegacyFolderRecovery\(legacyFolderSnapshot\.id\)/);
  assert.match(restore, /const restored = await metadata\(legacyFolderSnapshot\.id\)/);
  assert.match(restore, /assert\(legacyFolderMatches\(legacyFolderSnapshot, restored, true\)/);
  assert.match(restore, /assert\(!ignoreWindowOpen/);
  assert.match(functionBody(source, 'legacyFolderMatches'), /sameParents\(current\.parents, restored \? snapshot\.parents : \[sharedRootId\]\)/);
  assert.match(functionBody(source, 'finalize'), /cleanup\.legacyFolderRestored = await restoreLegacyFolder\(\)/);
  assert.match(functionBody(source, 'cleanupVerified'), /cleanup\.legacyFolderRestored/);
});

test('live runner binds a sanitized FAIL manifest to exit code 1 before finalization ends', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  const finalization = functionBody(source, 'finalize');
  const manifest = finalization.indexOf('const manifest = sanitizedManifest(');
  const exitBinding = finalization.indexOf("if (manifest.status !== 'PASS' || !cleanup.appsStopped) process.exitCode = 1;");
  assert(manifest !== -1 && manifest < exitBinding && exitBinding < finalization.length);
  assert.match(source.slice(source.indexOf('} finally {')), /await finalize\(\)/);
});

test('live runner preserves a sanitized async analysis failure before tenant cleanup', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  const diagnostic = functionBody(source, 'failedAnalysisDiagnostic');
  assert.match(diagnostic, /SELECT 1 FROM pgboss\.job/);
  assert.match(diagnostic, /name = 'analysis' AND state = 'failed'/);
  assert.match(diagnostic, /data->>'organizationId' = \$\{organizationId\}/);
  assert.match(diagnostic, /created_on >= \$\{runStartedAt\}/);
  assert.match(diagnostic, /'stage=analysis reason=job_failed'/);
  assert.doesNotMatch(diagnostic, /output|response|content|text|prompt|bytes|externalId|documentId/);
  const finalize = functionBody(source, 'finalize');
  assert(finalize.indexOf('failedAnalysisDiagnostic()') < finalize.indexOf('cleanup.tenantCleaned ='));
  assert.match(source, /const failureOverrides = \['stage=analysis reason=job_failed'/);
  assert.match(functionBody(source, 'fatalExit'), /failureOverrides\.includes\(failureDiagnostic\)/);
  assert.match(functionBody(source, 'fatalExit'), /failureDiagnostic \?\? `stage=\$\{failureStageAtFailure \?\? failureStage\}`/);
});

test('live runner reports only allowlisted Item 4 provider assertion reasons', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  assert.match(source, /failureDiagnostic \?\?= safeFailureReason\(error\)/);
  const reason = functionBody(source, 'safeFailureReason');
  assert.match(reason, /ignore_metadata_changed/);
  assert.match(reason, /legacy_folder_present/);
  assert.doesNotMatch(reason, /error\.stack/);
});

test('live runner exposes only exact allowlisted failure stages', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  const stages = ['preflight', 'auth', 'recovery', 'listing', 'app-start', 'browser-launch', 'login-navigation', 'acceptance-login-session', 'dashboard-identity', 'tenant-lookup', 'drive-connection-readback', 'tenant-reset', 'anthropic-server-setup', 'settings-verification', 'dashboard-resume', 'drive-fixture-prepare', 'browser-source-selection', 'browser-input-enqueue', 'proposal-card-wait', 'launch-completion-ui', 'anthropic-provenance-db', 'ui-decisions-provider-metadata', 'correction-relaunch', 'settings-delete', 'cleanup-finalization'];
  assert.match(source, new RegExp(`const failureStages = \\[${stages.map((stage) => `'${stage}'`).join(', ')}\\]`));
  for (const stage of stages.slice(5)) assert.match(source, new RegExp(`failureStage = '${stage}'`));
  const browserBoundaries = [
    ['browser-launch', 'browser = await chromium.launch'],
    ['login-navigation', 'await page.goto'],
    ['acceptance-login-session', "await page.getByRole('button', { name: 'Validation Google staging' }).click()"],
    ['dashboard-identity', "await page.getByText('Validation staging · identité de service Google').waitFor()"],
    ['tenant-lookup', 'organizationId = await tenantId()'],
    ['drive-connection-readback', 'const connectionBeforeSync = await prisma.driveConnection.findFirst'],
    ['tenant-reset', 'await assertNoPriorTenantSetting(organizationId)'],
    ['anthropic-server-setup', '({ model: selectedAnthropicModel'],
    ['settings-verification', "await page.getByRole('link', { name: 'Paramètres IA' }).click()"],
    ['dashboard-resume', "await page.getByRole('link', { name: 'Tableau de bord' }).click()"],
  ];
  for (const [stage, operation] of browserBoundaries) assert(source.includes(`failureStage = '${stage}';\n  ${operation}`), `Missing immediate boundary: ${stage}`);
  assert.doesNotMatch(source, /drive-classification/);
  const fatal = functionBody(source, 'fatalExit');
  assert.match(fatal, /failureStages\.includes\(failureStage\)/);
  assert.match(fatal, /failureDiagnostic \?\? `stage=\$\{failureStageAtFailure \?\? failureStage\}`/);
  assert.doesNotMatch(fatal, /error|message|stack|JSON\.stringify/i);
});

test('live runner reports ordered proposal launch boundaries immediately before each operation block', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  const transitions = [
    ["failureStage = 'browser-input-enqueue';", 'await chooseBrowserItem(page, runName, "Lancer l\'organisation", true);'],
    ["failureStage = 'proposal-card-wait';", 'await waitForProposalCards(page, 2);'],
    ["failureStage = 'launch-completion-ui';", "await expect(page.getByText('Analyse en cours', { exact: true })).toHaveCount(0);"],
    ["failureStage = 'anthropic-provenance-db';", 'const anthropicProof = await prisma.classificationProposal.findFirst('],
  ];
  let previous = -1;
  for (const [stage, operation] of transitions) {
    const boundary = `${stage}\n  ${operation}`;
    const index = source.indexOf(boundary);
    assert(index > previous, `Missing or unordered immediate boundary: ${stage}`);
    previous = index;
  }
});

test('live runner routes signals and fatal errors through bounded single-flight recovery with fresh tokens', () => {
  const source = readFileSync(new URL('../../live-google-service-account.mjs', import.meta.url), 'utf8');
  for (const event of ['SIGINT', 'SIGTERM', 'SIGHUP', 'uncaughtException', 'unhandledRejection']) assert.match(source, new RegExp(`process\\.once\\('${event}'`));
  assert.match(source, /let fatalExitStarted = false/);
  assert.match(source, /let finalizationFlight/);
  assert.match(source, /let restorationFlight/);
  const emergency = functionBody(source, 'emergencyExit');
  assert.match(emergency, /finalize\(\)/);
  assert.match(emergency, /Promise\.race/);
  assert.match(emergency, /delay\(90_000, 'timeout'\)/);
  assert.match(emergency, /stage=cleanup-finalization/);
  assert.match(emergency, /process\.exit\(outcome === 'finalized' \? code : 1\)/);
  assert.doesNotMatch(emergency, /fixtureSnapshots|observedReplacements|downloadBytes|originalBytes/);
  const fatal = functionBody(source, 'fatalExit');
  assert.match(fatal, /if \(normalCleanupDone\) \{ process\.exitCode = 1; return; \}/);
  assert.match(fatal, /root failure:/);
  assert.doesNotMatch(fatal, /fixtureSnapshots|observedReplacements|downloadBytes|originalBytes|JSON\.stringify/);
  const finalize = functionBody(source, 'finalize');
  assert.match(finalize, /return finalizationFlight \?\?=/);
  assert.match(finalize, /writeFileSync\(manifestPath/);
  assert.match(finalize, /writeFileSync\(realAcceptancePath/);
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

test('live runner fatal rejection replaces stale evidence with current sanitized FAIL evidence', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'klasr-live-fatal-'));
  const manifest = path.join(directory, 'manifest.sanitized.json');
  const canonicalItem3 = [
    new URL('.tmp/hermes/ux-clarity/evidence/item-3/provider-proof.sanitized.json', root),
    new URL('.tmp/hermes/ux-clarity/evidence/item-3/screenshots/linked-service-account-final-1280.png', root),
  ];
  const before = canonicalItem3.map((file) => existsSync(file) ? readFileSync(file) : null);
  writeFileSync(manifest, '{"attempt":94,"status":"PASS"}\n');
  const run = spawnSync(process.execPath, ['scripts/live-google-service-account.mjs', '--fatal-lifecycle-check'], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { PATH: process.env.PATH, KLASR_FATAL_CHECK_DIR: directory, KLASR_EVIDENCE_TASK: 't_selfcheck', KLASR_EVIDENCE_SHA: sha, KLASR_EVIDENCE_ISSUE: '17', KLASR_EVIDENCE_ATTEMPT: '95' },
  });
  assert.equal(run.status, 1, run.stderr);
  assert.equal(run.stderr, 'root failure: stage=preflight\n');
  assert.deepEqual(JSON.parse(readFileSync(manifest, 'utf8')), {
    ...JSON.parse(readFileSync(manifest, 'utf8')), issue: 17, attempt: 95, sha, status: 'FAIL',
  });
  assert.deepEqual(canonicalItem3.map((file) => existsSync(file) ? readFileSync(file) : null), before);
  assert.doesNotMatch(`${run.stdout}${run.stderr}`, /fatal-probe-secret|Error|stack/i);
});

test('publisher dry-run emits only a sanitized success status and performs no network', () => {
  const manifest = JSON.stringify({
    version: 1, identity: 'Google service account non-production acceptance', sha, issue: 13, attempt: 2, tree: treeBinding, observed: observedRecord,
    status: 'PASS',
    results: {
      anthropic_discovery: true, anthropic_setting_saved: true, anthropic_classification: true, anthropic_setting_removed: true,
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
    version: 1, identity: 'Google service account non-production acceptance', sha, issue: 13, attempt: 2, status: 'FAIL', tree: treeBinding, observed: observedRecord,
    results: Object.fromEntries(liveResultKeys.map((key) => [key, false])),
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
    version: 1, identity: 'Google service account non-production acceptance', sha, issue: 13, attempt: 2, status: 'PASS', tree: treeBinding, observed: observedRecord,
    results: Object.fromEntries(liveResultKeys.map((key) => [key, key !== 'service_account_auth'])),
    cleanup: { fixture_restored: true, created_items_removed: true, tenant_cleaned: true }, processes: { apps_stopped: true, no_orphans: true },
  };
  const run = spawnSync(process.execPath, ['scripts/publish-live-google-status.mjs', '--dry-run', '-'], { cwd: root, input: JSON.stringify(manifest), encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_REPOSITORY: 'owner/repo', DRY_RUN_CURRENT_HEAD_SHA: sha } });
  assert.notEqual(run.status, 0);
  assert.match(JSON.parse(run.stdout).failure_dispatch.client_payload.event_key, /:FAIL$/);
});

test('publisher dry-run fails closed for a stale current head or no matching failed CI run', () => {
  const manifest = {
    version: 1, identity: 'Google service account non-production acceptance', sha, issue: 13, attempt: 2, status: 'PASS', tree: treeBinding, observed: observedRecord,
    results: Object.fromEntries(liveResultKeys.map((key) => [key, true])),
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
    version: 1, identity: 'Google service account non-production acceptance', sha, issue: 13, attempt: 2, status: 'PASS', tree: treeBinding, observed: observedRecord,
    results: Object.fromEntries(liveResultKeys.map((key) => [key, true])),
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
    version: 1, identity: 'Google service account non-production acceptance', sha: 'not-a-sha', issue: 1, attempt: 1, status: 'PASS', tree: treeBinding, observed: observedRecord,
    results: Object.fromEntries(liveResultKeys.map((key) => [key, true])),
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
  const task = spawnSync(process.execPath, ['scripts/live-google-service-account.mjs'], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, KLASR_EVIDENCE_TASK: 'stale/task', KLASR_EVIDENCE_SHA: sha, KLASR_EVIDENCE_ISSUE: '1', KLASR_EVIDENCE_ATTEMPT: '1' } });
  assert.notEqual(task.status, 0);
  assert.match(task.stderr, /evidence task/i);
  assert.doesNotMatch(task.stderr, /KLASR_GOOGLE_SERVICE_ACCOUNT_FILE/);
});
