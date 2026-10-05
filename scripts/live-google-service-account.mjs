import { spawn, spawnSync } from 'node:child_process';
import { createHash, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { assertTreeBinding, currentTreeBinding, parseObservedRecord, resolveEvidenceRunDir } from './live-google-evidence.mjs';

const fixtureNames = ['doc3.pdf', 'CDA_Oct25_18mois_Calendrier.pdf'];
const removedFolderName = 'À traiter manuellement';
const recoveryVersion = '1';
const failureStages = ['preflight', 'auth', 'recovery', 'listing', 'app-start', 'browser-launch', 'login-navigation', 'acceptance-login-session', 'google-consent', 'dashboard-identity', 'tenant-lookup', 'drive-connection-readback', 'tenant-reset', 'settings-verification', 'dashboard-resume', 'drive-fixture-prepare', 'browser-source-selection', 'browser-input-enqueue', 'proposal-card-wait', 'launch-completion-ui', 'anthropic-provenance-db', 'ui-decisions-provider-metadata', 'correction-relaunch', 'cleanup-finalization'];
const failureOverrides = ['stage=analysis reason=job_failed', 'stage=ui-decisions-provider-metadata reason=ignore_metadata_changed', 'stage=ui-decisions-provider-metadata reason=legacy_folder_present'];

if (process.argv.includes('--llm-setup-contract-check')) {
  assertLlmSetupSequence(['reset', 'configure', 'launch', 'reset', 'configure', 'launch']);
  assertThrows(() => assertLlmSetupSequence(['reset', 'launch']), 'Launch after reset without LLM setup must fail');
  process.stdout.write('live runner LLM setup sequence check PASS\n');
  process.exit(0);
}

if (process.argv.includes('--auth-mode-check')) {
  assert(authMode({}) === 'sa', 'Auth mode must default to sa');
  assert(authMode({ KLASR_AUTH_MODE: 'user' }) === 'user', 'User auth mode must be accepted');
  assertThrows(() => authMode({ KLASR_AUTH_MODE: 'invalid' }), 'Invalid auth mode must fail closed');
  assert(manualConsent({}, 'sa') === false, 'Manual consent must default to false');
  assert(manualConsent({ KLASR_MANUAL_CONSENT: 'true' }, 'user') === true, 'Manual consent must be accepted for user mode');
  assertThrows(() => manualConsent({ KLASR_MANUAL_CONSENT: 'invalid' }, 'user'), 'Invalid manual consent must fail closed');
  assertThrows(() => manualConsent({ KLASR_MANUAL_CONSENT: 'true' }, 'sa'), 'Manual consent must reject service-account mode');
  process.stdout.write('live runner auth mode check PASS\n');
  process.exit(0);
}

if (process.argv.includes('--lifecycle-check')) {
  await lifecycleCheck();
  process.stdout.write('live runner lifecycle check PASS\n');
  process.exit(0);
}

if (process.argv.includes('--decision-selection-check')) {
  const items = fixtureNames.map((name, index) => ({ id: String(index), name, mimeType: 'application/pdf' }));
  const supplied = selectFixtures(items);
  const fixtureSnapshots = supplied.map((item, index) => ({ ...item, parents: ['root'], trashed: false, bytes: Buffer.from(`%PDF-${index}\n%%EOF`) }));
  const replacements = [{ id: supplied[0].id, bytes: syntheticInvoicePdf('self-check') }, { id: supplied[1].id, bytes: reviewRequiredPdf() }];
  const restored = fixtureSnapshots.map((snapshot) => ({ ...snapshot, parents: [...snapshot.parents], bytes: Buffer.from(snapshot.bytes) }));
  assert(supplied.length === 2 && fixtureSnapshots.length === 2, 'Exactly two existing fixtures must be snapshotted');
  assert(replacements.every(({ bytes }) => isPdf(bytes)), 'Generated replacements must be PDF-marked');
  assert(!sameBytes(replacements[0].bytes, replacements[1].bytes), 'Invoice and manual replacements must be distinct');
  assert(restorationVerified(fixtureSnapshots, restored, replacements), 'Exact byte restoration design must be non-vacuous');
  assert(restorationVerified(fixtureSnapshots, restored, [replacements[0], { id: supplied[1].id, bytes: undefined }]), 'Missing observed replacement must not invalidate a successful restoration');
  for (const [index, replacement] of replacements.entries()) {
    assertThrows(() => assert(restorationVerified(fixtureSnapshots, restored.map((snapshot, snapshotIndex) => snapshotIndex === index ? { ...snapshot, bytes: replacement.bytes } : snapshot), replacements), 'Mismatched restored bytes'), 'Mismatched restored bytes must fail verification');
    assertThrows(() => assert(restorationVerified(fixtureSnapshots, restored.map((snapshot, snapshotIndex) => snapshotIndex === index ? { ...snapshot, parents: ['elsewhere'] } : snapshot), replacements), 'Mismatched restored metadata'), 'Mismatched restored metadata must fail verification');
  }
  assert(existingFixturePdf(Buffer.from('%PDF-1.4\r\n%%EOF\r\n')) && existingFixturePdf(Buffer.from('%PDF-1.4\n%%EOF\n\n')), 'Existing PDF fixtures must accept common trailers');
  assert(!existingFixturePdf(new Uint8Array([1])) && !existingFixturePdf(Buffer.alloc(0)) && !existingFixturePdf(Buffer.from('x%PDF-')), 'Existing PDF fixtures must fail closed');
  assertThrows(() => selectFixtures(items.slice(0, 1)), 'Missing fixtures must fail');
  assertThrows(() => selectFixtures([...items, { ...items[0], id: 'duplicate' }]), 'Ambiguous fixtures must fail');
  assertThrows(() => selectFixtures([{ ...items[0], mimeType: 'image/png' }, items[1]]), 'Non-PDF fixtures must fail');
  const absentPlan = selectFixturePlan(items.slice(0, 1));
  assert(absentPlan.invoice.id === '0' && absentPlan.review === undefined && absentPlan.reviewOriginallyAbsent, 'Zero exact manual PDF must permit provisioning');
  const existingPlan = selectFixturePlan(items);
  assert(existingPlan.review.id === '1' && !existingPlan.reviewOriginallyAbsent, 'One exact manual PDF must be reused');
  assertThrows(() => selectFixturePlan([...items, { ...items[1], id: 'duplicate' }]), 'Duplicate exact manual PDFs must fail before mutation');
  assertThrows(() => selectFixturePlan([...items.slice(0, 1), { id: 'non-pdf', name: fixtureNames[1], mimeType: 'text/plain' }]), 'Exact-name non-PDF candidates must fail closed');
  assertThrows(() => restorationVerified([], [], replacements), 'Empty restoration proof must fail');
  assert(sanitizeFailure(new Error('failed with secret-value'), ['secret-value']) === 'failed with [REDACTED]', 'Failure details must redact secrets');
  assertThrows(() => restorationVerified(fixtureSnapshots, fixtureSnapshots.slice(0, 1), replacements), 'Partial restoration proof must fail');
  for (const index of [0, 1]) assertThrows(() => restorationVerified(fixtureSnapshots, restored, replacements.map((replacement, replacementIndex) => replacementIndex === index ? { ...replacement, bytes: fixtureSnapshots[index].bytes } : replacement)), 'Unchanged replacement proof must fail');
  const marker = { appProperties: { klasrRecoveryRevision: 'revision_1', klasrRecoveryVersion: recoveryVersion, klasrRecoveryScope: 'invoice' } };
  assert(recoveryMarker(marker, 'invoice') === 'revision_1' && recoveryMarker({}, 'invoice') === undefined, 'Recovery marker validation failed');
  assertThrows(() => recoveryMarker({ appProperties: { klasrRecoveryRevision: 'revision_1' } }, 'invoice'), 'Partial recovery markers must fail closed');
  assertThrows(() => recoveryMarker(marker, 'manual'), 'Fixture recovery scope mismatch must fail closed');
  assert(selectMatchingPinnedRevision([{ id: 'z', matchesSnapshot: true }, { id: 'a', matchesSnapshot: true }]).id === 'a', 'Multiple matching pins must reuse the stable lowest ID');
  assert(selectMatchingPinnedRevision([{ id: 'a', matchesSnapshot: false }]) === undefined, 'A nonmatching pin must fall through to head pinning');
  const selected = chooseDecisionFixtures([
    { id: 'manual', reviewRequired: true, confirmEnabled: false, destination: '' },
    { id: 'wrong', reviewRequired: false, confirmEnabled: true, destination: '/quotes' },
    { id: 'valid', reviewRequired: false, confirmEnabled: true, destination: '/invoices' },
  ]);
  assert(selected.confirm.id === 'valid' && selected.ignore.id === 'manual', 'Decision fixture selection is not provider-agnostic');
  assert(genuineManualReview({ reviewRequired: true, destinationPath: '', reviewReason: 'low_confidence' }), 'Configured-LLM manual review must be accepted');
  for (const proposal of [{ reviewRequired: false, destinationPath: '', reviewReason: 'low_confidence' }, { reviewRequired: true, destinationPath: '/invoices', reviewReason: 'low_confidence' }, { reviewRequired: true, destinationPath: '', reviewReason: 'extraction_failed' }, { reviewRequired: true, destinationPath: '', reviewReason: ' ' }]) assert(!genuineManualReview(proposal), 'Degenerate manual review must be rejected');
  process.stdout.write('live runner fixture restoration and decision selection check PASS\n');
  process.exit(0);
}

if (process.argv.includes('--borrowed-carrier-check')) {
  const carrier = { id: 'invoice', name: fixtureNames[0], mimeType: 'application/pdf', parents: ['authorized-root'], trashed: false };
  assertThrows(() => selectBorrowedCarrier([], 'authorized-root'), 'Zero eligible carriers must fail closed');
  assert(selectBorrowedCarrier([carrier], 'authorized-root').id === carrier.id, 'One eligible carrier must be selected');
  assertThrows(() => selectBorrowedCarrier([carrier, { ...carrier, id: 'duplicate' }], 'authorized-root'), 'Many eligible carriers must fail closed');
  assertThrows(() => selectBorrowedCarrier([{ ...carrier, mimeType: 'text/plain' }], 'authorized-root'), 'A non-PDF carrier must fail closed');
  assertThrows(() => selectBorrowedCarrier([{ ...carrier, parents: ['elsewhere'] }], 'authorized-root'), 'A carrier outside the authorized root must fail closed');
  const bytes = Buffer.from('%PDF-original\n%%EOF\n');
  const snapshot = { ...carrier, bytes, recoveryScope: 'invoice' };
  const restored = [{ ...snapshot, parents: [...snapshot.parents], bytes: Buffer.from(bytes) }];
  assert(sameBytes(bytes, restored[0].bytes), 'Borrowed carrier bytes must remain unchanged');
  assert(restorationVerified([snapshot], restored, [{ id: carrier.id, bytes: undefined }]), 'Borrowed carrier restoration must be byte- and metadata-exact');
  assertThrows(() => assert(restorationVerified([snapshot], [{ ...restored[0], name: fixtureNames[1] }], [{ id: carrier.id, bytes: undefined }]), 'Borrowed carrier name mismatch'), 'Borrowed carrier name mismatch must fail restoration');
  const marker = { appProperties: { klasrRecoveryRevision: 'revision_1', klasrRecoveryVersion: recoveryVersion, klasrRecoveryScope: 'invoice' } };
  assert(recoveryMarker(marker, 'invoice') === 'revision_1', 'Borrowed carrier marker must be verifiable');
  assert(!recoveryMarker({ appProperties: {} }, 'invoice'), 'Borrowed carrier marker cleanup must be verifiable');
  process.stdout.write('borrowed carrier zero/one/many and exact recovery check PASS\n');
  process.exit(0);
}

if (process.argv.includes('--quota-safe-mode-check')) {
  const issue = Number(process.env.KLASR_EVIDENCE_ISSUE);
  assert(/^\d+$/.test(process.env.KLASR_EVIDENCE_ISSUE ?? '') && issue > 0, 'Evidence issue is invalid');
  const mode = fixtureMode(process.env);
  if (mode === 'borrowed-carrier') assertThrows(() => assertProviderMutationAllowed(mode, '/drive/v3/files', { method: 'POST' }), 'Borrowed mode must reject provider creates');
  else assertProviderMutationAllowed(mode, '/drive/v3/files', { method: 'POST' });
  process.stdout.write(`${mode}\n`);
  process.exit(0);
}

if (process.argv.includes('--byok-acceptance-self-check')) {
  assert(selectEligibleAnthropicModel(['claude-z', 'not-eligible', 'claude-a']) === 'claude-z', 'Eligible model selection is not deterministic');
  assertThrows(() => selectEligibleAnthropicModel(['not-eligible']), 'Missing eligible models must fail');
  assertNoPriorTenantSettingCount(0);
  assertThrows(() => assertNoPriorTenantSettingCount(1), 'Prior tenant settings must fail closed');
  process.stdout.write('live BYOK acceptance decisions check PASS\n');
  process.exit(0);
}

const syntheticLineage = { sha: '0'.repeat(40), issue: 1, attempt: 1 };
const lineage = process.argv.includes('--evidence-self-check') ? syntheticLineage : parseLineage(process.env);
const evidenceTask = process.argv.includes('--evidence-self-check') ? 't_selfcheck' : parseEvidenceTask(process.env);
const quotaSafeMode = fixtureMode(process.env) === 'borrowed-carrier';
const authenticationMode = authMode(process.env);
const manualConsentMode = manualConsent(process.env, authenticationMode);
const manualConsentTimeout = manualConsentMode ? manualConsentTimeoutMs(process.env) : undefined;
const stagingAccountEmail = authenticationMode === 'user' ? required('KLASR_STAGING_ACCOUNT_EMAIL') : undefined;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fatalLifecycleCheck = process.argv.includes('--fatal-lifecycle-check');
const isolatedLifecycleCheck = fatalLifecycleCheck || process.argv.includes('--preflight-lifecycle-check') || process.argv.includes('--evidence-self-check');
const evidenceRunId = process.env.KLASR_EVIDENCE_RUN_ID ?? `run-${Date.now()}`;
const evidenceDir = isolatedLifecycleCheck ? required('KLASR_FATAL_CHECK_DIR') : quotaSafeMode
  ? resolveEvidenceRunDir(root, lineage, evidenceTask, evidenceRunId)
  : path.join(root, '.tmp/hermes/drive-reference-organization-flow');
const screenshotDir = path.join(evidenceDir, 'screenshots');
const manifestPath = path.join(evidenceDir, 'manifest.sanitized.json');
const realAcceptancePath = isolatedLifecycleCheck ? path.join(evidenceDir, 'REAL_ACCEPTANCE.md') : path.join(root, '.tmp/hermes/BYOK-20260816/REAL_ACCEPTANCE.md');
const observedPath = path.join(evidenceDir, 'observed.sanitized.json');
const ignoreMutationLogPath = path.join(evidenceDir, 'ignore-drive-mutations.log');
const item4ProofPath = path.join(evidenceDir, 'item4-provider-proof.sanitized.json');
const item3EvidenceDir = isolatedLifecycleCheck ? path.join(evidenceDir, 'item-3') : path.join(root, '.tmp/hermes/ux-clarity/evidence/item-3');
const item3ProofPath = path.join(item3EvidenceDir, 'provider-proof.sanitized.json');
const item3ScreenshotPath = path.join(item3EvidenceDir, 'screenshots/linked-service-account-final-1280.png');
const item5ProofPath = quotaSafeMode ? path.join(evidenceDir, 'provider-proof.sanitized.json') : path.join(root, '.tmp/hermes/ux-clarity/evidence/item-5/provider-proof.sanitized.json');
mkdirSync(screenshotDir, { recursive: true });
mkdirSync(path.dirname(item3ScreenshotPath), { recursive: true });
mkdirSync(path.dirname(item5ProofPath), { recursive: true });

if (process.argv.includes('--evidence-self-check')) {
  const tree = { schema: 'klasr-tree-v1', mode: 'worktree', head: lineage.sha, digest: 'b'.repeat(64) };
  const observed = { schema: 'klasr-live-observed-v1', stage: 'env-llm-verified', selectedModelId: 'claude-safe', modelUsed: 'anthropic/claude-safe', tree };
  const raw = {
    serviceAccountAuth: 'PASS', realDriveListing: 'PASS', realDriveDownloadOcr: 'PASS', realProposalReview: 'PASS',
    realDriveConfirmMutation: 'PASS', realDriveCorrectMutation: 'PASS', realDriveIgnoreNoMutation: 'PASS', terminalNoReenqueue: 'PASS',
    desktopBrowser: 'PASS', mobile390Browser: 'PASS', launchCompletion: 'PASS', freshProviderMetadata: 'PASS',
    llmClassification: 'PASS',
  };
  const proof = { fixtureRestored: true, createdItemsRemoved: true, tenantCleaned: true, appsStopped: true, noOrphans: true };
  const complete = sanitizedManifest(raw, proof, lineage, tree, observed, true);
  const incomplete = sanitizedManifest(raw, proof, lineage, tree, observed, false);
  assertManifest(complete);
  assertManifest(incomplete);
  const item4Assertions = { oneLegacyFolderQuarantined: true, quarantinedOutsideReference: true, absentDuringAcceptance: true, ignoredNameIdentical: true, ignoredParentsIdentical: true, ignoreFilesUpdateOrMoveCount: 0, setupOutsideIgnoreWindow: true, restorationOutsideIgnoreWindow: true, restoredNameExact: true, restoredParentsExact: true, freshRestorationReadback: true };
  const item4 = sanitizedItem4Proof(item4Assertions, evidenceTask, lineage, tree);
  assertItem4Proof(item4, evidenceTask, lineage, tree, true);
  for (const bad of [{ ...item4, task: 't_wrong' }, { ...item4, attempt: 2 }, { ...item4, tree: { ...tree, digest: 'c'.repeat(64) } }]) {
    assertThrows(() => assertItem4Proof(bad, evidenceTask, lineage, tree), 'Item 4 proof lineage mismatch must fail closed');
  }
  const item3 = sanitizedItem3Proof({ serviceAccountIdentityVerified: true, grantedScopes: ['https://www.googleapis.com/auth/drive'], driveConnectionPresent: true, lastSyncAt: '2026-08-30T00:00:00.000Z', realSyncObserved: true, fileBrowserVisible: true }, evidenceTask, lineage, tree);
  assertItem3Proof(item3, evidenceTask, lineage, tree, true);
  for (const bad of [{ ...item3, task: 't_wrong' }, { ...item3, attempt: 2 }, { ...item3, sha: '1'.repeat(40) }, { ...item3, tree: { ...tree, digest: 'c'.repeat(64) } }, { ...item3, assertions: { ...item3.assertions, lastSyncAt: null } }]) assertThrows(() => assertItem3Proof(bad, evidenceTask, lineage, tree, true), 'Item 3 proof mismatch must fail closed');
  assert(complete.status === 'PASS' && incomplete.status === 'FAIL', 'Evidence self-check must fail incomplete runs');
  const markdown = realAcceptanceMarkdown(complete, evidenceTask, undefined);
  assert(markdown.includes(`Task: \`${evidenceTask}\``) && markdown.includes(`Attempt: \`${lineage.attempt}\``) && markdown.includes(`SHA: \`${lineage.sha}\``), 'REAL_ACCEPTANCE lineage must use current runner inputs');
  assert(sanitizedManifest({ ...raw, llmClassification: 'FAIL' }, proof, lineage, tree, observed, true).status === 'FAIL', 'LLM classification must bind manifest PASS');
  const borrowedProof = Object.fromEntries(Object.keys(item5ProofTemplate()).map((key) => [key, !['originalExactNameCount', 'originalPdfCount', 'createdRunnerOwned', 'createdInAuthorizedRoot', 'finalExactNameCount', 'finalPdfCount'].includes(key)]));
  for (const key of ['originalExactNameCount', 'originalPdfCount', 'finalExactNameCount', 'finalPdfCount']) borrowedProof[key] = 0;
  const issue21 = { ...lineage, issue: 21 };
  const borrowedItem5 = sanitizedItem5Proof(borrowedProof, evidenceTask, issue21, tree);
  assertItem5Proof(borrowedItem5, evidenceTask, issue21, tree, true, true);
  for (const key of Object.keys(borrowedProof)) {
    const value = borrowedProof[key];
    const assertions = { ...borrowedProof, [key]: typeof value === 'boolean' ? !value : 1 };
    assertThrows(() => assertItem5Proof(sanitizedItem5Proof(assertions, evidenceTask, issue21, tree), evidenceTask, issue21, tree, true, true), `Borrowed Item 5 ${key} must fail closed`);
  }
  for (const malformed of [null, { ...borrowedItem5, assertions: null }, { ...borrowedItem5, assertions: {} }]) assertThrows(() => assertItem5Proof(malformed, evidenceTask, issue21, tree, true, true), 'Malformed borrowed Item 5 proof must fail closed');
  const runnerProof = item5ProofTemplate();
  for (const key of ['originalExactNameCount', 'originalPdfCount', 'finalExactNameCount', 'finalPdfCount']) runnerProof[key] = 0;
  const runnerItem5 = sanitizedItem5Proof(runnerProof, evidenceTask, lineage, tree);
  assertItem5Proof(runnerItem5, evidenceTask, lineage, tree, true, false);
  assertItem5Proof(sanitizedItem5Proof({ ...runnerProof, originalExactNameCount: 1, originalPdfCount: 1, finalExactNameCount: 1, finalPdfCount: 1 }, evidenceTask, lineage, tree), evidenceTask, lineage, tree, true, false);
  assertThrows(() => assertItem5Proof(sanitizedItem5Proof({ ...runnerProof, originalExactNameCount: 1 }, evidenceTask, lineage, tree), evidenceTask, lineage, tree, true, false), 'Runner-owned Item 5 counts must be restored');
  assert(sanitizedManifest(raw, proof, issue21, tree, observed, true, borrowedProof, true).status === 'PASS', 'Complete borrowed mode must claim full-path PASS');
  assert(sanitizedManifest(raw, proof, issue21, tree, undefined, true, borrowedProof, true).status === 'FAIL', 'Borrowed manifest must require observed truth');
  assert(sanitizedManifest({ ...raw, realDriveListing: 'FAIL' }, proof, issue21, tree, observed, true, borrowedProof, true).status === 'FAIL', 'Borrowed manifest must require every result');
  process.stdout.write('live evidence schema check PASS\n');
  process.exit(0);
}

if (process.argv.includes('--provider-identity-self-check')) {
  const requested = [];
  const fetcher = async (url) => {
    requested.push(url);
    return { ok: true, json: async () => url.includes('tokeninfo') ? { scope: 'openid https://www.googleapis.com/auth/drive' } : { user: { emailAddress: 'service@example.test' } } };
  };
  assert((await providerTokenInfo(fetcher, 'token')).includes('https://www.googleapis.com/auth/drive'), 'Drive scope was not read from tokeninfo');
  assert(await providerDriveIdentity(fetcher, 'token') === 'service@example.test', 'Identity was not read from Drive about');
  assert(requested.length === 2, 'Provider proof must perform two independent reads');
  process.stdout.write('provider identity read-back check PASS\n');
  process.exit(0);
}

const requireWeb = createRequire(path.join(root, 'apps/web/package.json'));
const { chromium, expect } = requireWeb('@playwright/test');

let credentialPath;
let sharedRootId;
const apiPort = Number(process.env.KLASR_LIVE_API_PORT ?? 3201);
const webPort = Number(process.env.KLASR_LIVE_WEB_PORT ?? 4201);
const apiBase = loopback(process.env.KLASR_LIVE_API_URL ?? `http://127.0.0.1:${apiPort}/api/v1`);
const webBase = loopback(process.env.KLASR_LIVE_WEB_URL ?? `http://127.0.0.1:${webPort}`);
const databaseUrl = process.env.KLASR_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/klasr';
const mongoUrl = process.env.KLASR_MONGO_URL ?? process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017';
const internalSecret = process.env.KLASR_LIVE_INTERNAL_SECRET ?? 'google-sa-live-internal';
const nextAuthSecret = process.env.KLASR_LIVE_NEXTAUTH_SECRET ?? 'google-sa-live-nextauth';
const tokenKey = process.env.TOKEN_ENCRYPTION_KEY ?? 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const runName = `klasr-sa-${Date.now()}`;
const runStartedAt = new Date();
const initialTreeBinding = currentTreeBinding(root);
assert(initialTreeBinding.head === lineage.sha, 'Evidence lineage does not match current HEAD');
const createdIds = [];
const fixtureSnapshots = [];
const observedReplacements = new Map();
const children = [];
const evidence = {
  identity: authenticationMode === 'user' ? `Google user OAuth consent (${stagingAccountEmail})` : 'Google service account non-production acceptance',
  serviceAccountAuth: 'FAIL', realDriveListing: 'FAIL', realDriveDownloadOcr: 'FAIL',
  realProposalReview: 'FAIL', realDriveConfirmMutation: 'FAIL', realDriveCorrectMutation: 'FAIL',
  realDriveIgnoreNoMutation: 'FAIL', terminalNoReenqueue: 'FAIL', desktopBrowser: 'FAIL',
  mobile390Browser: 'FAIL', launchCompletion: 'FAIL', freshProviderMetadata: 'FAIL',
  llmClassification: 'FAIL', cleanup: 'FAIL',
};
let llmProvider;
let selectedLlmModel;
let observedModelUsed;
let accessToken;
let browser;
let organizationId;
const llmSetupEvents = [];
let runCompleted = false;
const replacementAttempted = new Set();
const replacementVerified = new Set();
const cleanup = { fixtureRestored: false, legacyFolderRestored: false, createdItemsRemoved: false, tenantCleaned: false, appsStopped: false, noOrphans: false };
let legacyFolderSnapshot;
let ignoreMutationCount;
let ignoreWindowOpen = false;
const item4Proof = { oneLegacyFolderQuarantined: false, quarantinedOutsideReference: false, absentDuringAcceptance: false, ignoredNameIdentical: false, ignoredParentsIdentical: false, ignoreFilesUpdateOrMoveCount: null, setupOutsideIgnoreWindow: false, restorationOutsideIgnoreWindow: false, restoredNameExact: false, restoredParentsExact: false, freshRestorationReadback: false };
const item3Proof = { serviceAccountIdentityVerified: false, grantedScopes: [], driveConnectionPresent: false, lastSyncAt: null, realSyncObserved: false, fileBrowserVisible: false };
const item5Proof = item5ProofTemplate();
let syncBaseline;
let restorationFlight;
let finalizationFlight;
let normalCleanupDone = false;
let failureStage = 'preflight';
let failureStageAtFailure;
let failureDiagnostic;
let failureDetail;
let acceptanceBlocked = false;
let fatalExitStarted = false;

async function emergencyExit(code) {
  const outcome = await Promise.race([
    finalize().then(() => 'finalized', () => 'rejected'),
    delay(90_000, 'timeout'),
  ]);
  if (outcome !== 'finalized') process.stderr.write('root failure: stage=cleanup-finalization\n');
  process.exit(outcome === 'finalized' ? code : 1);
}
async function fatalExit(code = 1) {
  if (fatalExitStarted) return;
  fatalExitStarted = true;
  assert(failureStages.includes(failureStage), 'Invalid failure stage');
  assert(failureStageAtFailure === undefined || failureStages.includes(failureStageAtFailure), 'Invalid captured failure stage');
  failureDiagnostic ??= await failedAnalysisDiagnostic().catch(() => undefined);
  assert(failureDiagnostic === undefined || failureOverrides.includes(failureDiagnostic), 'Invalid failure diagnostic');
  process.stderr.write(`root failure: ${failureDiagnostic ?? `stage=${failureStageAtFailure ?? failureStage}`}\n`);
  if (normalCleanupDone) { process.exitCode = 1; return; }
  await emergencyExit(code);
}
const guardedFatalExit = (code) => { void fatalExit(code).catch(() => process.exit(1)); };
process.once('SIGINT', () => guardedFatalExit(130));
process.once('SIGTERM', () => guardedFatalExit(143));
process.once('SIGHUP', () => guardedFatalExit(129));
process.once('uncaughtException', () => guardedFatalExit());
process.once('unhandledRejection', () => guardedFatalExit());

try {
  if (fatalLifecycleCheck) {
    setImmediate(() => void Promise.reject(new Error('fatal-probe-secret')));
    await new Promise(() => undefined);
  }
  assertPythonRuntime();
  const missing = ['KLASR_LLM_PROVIDER', 'KLASR_LLM_MODEL', 'KLASR_LLM_API_KEY', 'KLASR_GOOGLE_SERVICE_ACCOUNT_FILE', 'KLASR_GOOGLE_DRIVE_ROOT_ID', ...(authenticationMode === 'user' && !manualConsentMode ? ['KLASR_STAGING_ACCOUNT_PASSWORD'] : [])].filter((name) => !process.env[name]);
  if (missing.length) { acceptanceBlocked = true; throw new Error(`Missing ${missing.join(', ')}`); }
  llmProvider = required('KLASR_LLM_PROVIDER');
  assert(llmProvider === 'anthropic', `Live UI LLM setup supports provider anthropic, received ${llmProvider}`);
  selectedLlmModel = required('KLASR_LLM_MODEL');
  credentialPath = required('KLASR_GOOGLE_SERVICE_ACCOUNT_FILE');
  sharedRootId = required('KLASR_GOOGLE_DRIVE_ROOT_ID');
  failureStage = 'auth';
  accessToken = await serviceAccountToken();
  item3Proof.grantedScopes = await providerTokenInfo();
  item3Proof.serviceAccountIdentityVerified = Boolean(await providerDriveIdentity());
  evidence.serviceAccountAuth = 'PASS';
  failureStage = 'recovery';
  await recoverMarkedFixtures();
  await recoverLegacyFolder();
  failureStage = 'listing';
  const rootItems = await listChildren(sharedRootId);
  const supplied = selectFixtures(rootItems);
  item5Proof.originalExactNameCount = rootItems.filter(({ name }) => name === fixtureNames[1]).length;
  item5Proof.originalPdfCount = rootItems.filter(({ name, mimeType }) => name === fixtureNames[1] && mimeType === 'application/pdf').length;
  const reference = exact(rootItems, 'stg_tree', 'application/vnd.google-apps.folder');
  const destinations = Object.fromEntries(await Promise.all(['invoices', 'meetings', 'quotes'].map(async (name) => {
    const item = exact(await listChildren(reference.id), name, 'application/vnd.google-apps.folder');
    return [name, item];
  })));
  const [invoiceFixture, reviewFixture] = supplied;
  await quarantineLegacyFolder(reference.id);
  evidence.realDriveListing = 'PASS';

  // fixtureNames order is contractual: invoice drives OCR/confirm; review drives manual review/ignore/correct.
  failureStage = 'app-start';
  await ensureApps();
  failureStage = 'browser-launch';
  browser = await chromium.launch({ headless: false });
  item5Proof.headedBrowser = true;
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage();
  failureStage = 'login-navigation';
  await page.goto(`${webBase}/login`);
  failureStage = 'acceptance-login-session';
  if (authenticationMode === 'user') await loginWithGoogleUser(page, stagingAccountEmail, manualConsentMode ? undefined : required('KLASR_STAGING_ACCOUNT_PASSWORD'), manualConsentTimeout);
  else {
    await page.getByRole('button', { name: 'Validation Google staging' }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  }
  failureStage = 'dashboard-identity';
  await page.getByText(authenticationMode === 'user' ? stagingAccountEmail : 'Validation staging · identité de service Google', { exact: true }).waitFor();
  failureStage = 'tenant-lookup';
  const tenant = await tenantRecord();
  organizationId = tenant.organizationId;
  failureStage = 'drive-connection-readback';
  const connectionBeforeSync = await db('connection', organizationId);
  assert(connectionBeforeSync.present, 'Acceptance user DriveConnection read-back is missing');
  item3Proof.driveConnectionPresent = true;
  syncBaseline = connectionBeforeSync.lastSyncAt && new Date(connectionBeforeSync.lastSyncAt);
  failureStage = 'tenant-reset';
  assert(await db('count', organizationId, 'settings') === 0, 'Acceptance tenant must have zero LLM settings');
  await resetTenantData(organizationId);
  assert(await db('count', organizationId, 'rules') === 0, 'Acceptance tenant must have zero rules');
  failureStage = 'settings-verification';
  await configureLlmThroughUi(page);
  failureStage = 'dashboard-resume';
  await page.goto(`${webBase}/dashboard`);
  await page.getByRole('button', { name: 'Choisir ce dossier' }).waitFor();
  await expect(page.locator('#llm-launch-help')).toHaveCount(0);

  failureStage = 'drive-fixture-prepare';
  for (const [index, item] of supplied.entries()) {
    fixtureSnapshots.push({ ...await metadata(item.id), bytes: await downloadBytes(item.id), recoveryScope: index === 0 ? 'invoice' : 'manual' });
  }
  assert(fixtureSnapshots.length >= 1 && fixtureSnapshots.length <= 2 && fixtureSnapshots.every(({ bytes }) => existingFixturePdf(bytes)), 'Existing PDF fixtures must be snapshotted');
  const replacementBytes = syntheticInvoicePdf(runName);
  const reviewBytes = reviewRequiredPdf();
  assert(isPdf(replacementBytes) && isPdf(reviewBytes), 'Generated replacements must be PDF-marked');
  const invoiceSnapshot = fixtureSnapshots.find(({ id }) => id === invoiceFixture.id);
  const invoiceRevision = await pinOriginalRevision(invoiceFixture, invoiceSnapshot.bytes);
  await markRecovery(invoiceFixture.id, invoiceRevision, 'invoice');
  item5Proof.borrowedCarrierSnapshotted = fixtureSnapshots.every((snapshot) => sameParents(snapshot.parents, [sharedRootId]));
  item5Proof.originalBytesRetained = fixtureSnapshots.every((snapshot) => existingFixturePdf(snapshot.bytes));
  await restoreMetadata(invoiceFixture.id, { ...invoiceSnapshot, parents: [sharedRootId] });
  replacementAttempted.add(invoiceFixture.id);
  await replaceBytes(invoiceFixture.id, replacementBytes);
  observedReplacements.set(invoiceFixture.id, await downloadBytes(invoiceFixture.id));
  assert(!sameBytes(invoiceSnapshot.bytes, observedReplacements.get(invoiceFixture.id)), 'Temporary fixture replacement did not change provider bytes');
  replacementVerified.add(invoiceFixture.id);
  const manualSnapshot = fixtureSnapshots.find(({ id }) => id === reviewFixture.id);
  const manualRevision = await pinOriginalRevision(reviewFixture, manualSnapshot.bytes);
  await markRecovery(reviewFixture.id, manualRevision, 'manual');
  await restoreMetadata(reviewFixture.id, { ...manualSnapshot, parents: [sharedRootId] });
  replacementAttempted.add(reviewFixture.id);
  await replaceBytes(reviewFixture.id, reviewBytes);
  observedReplacements.set(reviewFixture.id, await downloadBytes(reviewFixture.id));
  assert(!sameBytes(manualSnapshot.bytes, observedReplacements.get(reviewFixture.id)), 'Temporary manual fixture replacement did not change provider bytes');
  replacementVerified.add(reviewFixture.id);
  item5Proof.borrowedCarrierIdStable = supplied.every((fixture) => fixtureSnapshots.some((snapshot) => snapshot.id === fixture.id));
  item5Proof.recoveryMarkerVerified = recoveryMarker(await metadata(invoiceFixture.id), 'invoice') === invoiceRevision
    && recoveryMarker(await metadata(reviewFixture.id), 'manual') === manualRevision;

  failureStage = 'browser-source-selection';
  await chooseBrowserItem(page, 'stg_tree', 'Choisir ce dossier');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  for (const name of ['invoices', 'meetings', 'quotes']) await page.getByText(new RegExp(`/${name}$`)).waitFor();
  item3Proof.fileBrowserVisible = true;
  const connectionAfterSync = await db('connection', organizationId);
  const lastSyncAt = connectionAfterSync.lastSyncAt && new Date(connectionAfterSync.lastSyncAt);
  assert(lastSyncAt && lastSyncAt >= runStartedAt && (!syncBaseline || lastSyncAt > syncBaseline), 'DriveConnection lastSyncAt was not caused by this real sync');
  item3Proof.lastSyncAt = lastSyncAt.toISOString();
  item3Proof.realSyncObserved = true;
  await expect(page.getByText(/Dernière synchronisation :/)).toBeVisible();
  await expect(page.getByAltText('Google Drive')).toBeVisible();
  await page.screenshot({ path: item3ScreenshotPath, fullPage: true });
  failureStage = 'browser-input-enqueue';
  await chooseBrowserItem(page, invoiceFixture.name, "Lancer l'organisation", true);
  await expect(page.getByText('Analyse en cours', { exact: true })).toHaveCount(0, { timeout: 180_000 });
  await chooseBrowserItem(page, reviewFixture.name, "Lancer l'organisation", true);
  failureStage = 'proposal-card-wait';
  await waitForProposalCards(page, 2);
  failureStage = 'launch-completion-ui';
  await expect(page.getByText('Analyse en cours', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: "Lancer l'organisation" })).toBeEnabled();
  evidence.launchCompletion = 'PASS';
  failureStage = 'anthropic-provenance-db';
  const anthropicProof = await db('proposal', organizationId, invoiceFixture.id);
  assert(anthropicProof?.modelUsed === `${llmProvider}/${selectedLlmModel}`, 'LLM provider/model provenance is missing');
  item5Proof.anthropicProvenance = true;
  observedModelUsed = anthropicProof.modelUsed;
  evidence.llmClassification = 'PASS';
  failureStage = 'ui-decisions-provider-metadata';
  const proposals = [];
  for (const fixture of supplied) {
    const card = proposalCardFor(page, fixture.name);
    await expectConfidenceBadge(card);
    await expect(card).toContainText(fixture.name);
    const proposedName = await displayedProposedName(card);
    const destination = await displayedDestination(card);
    const confirmButton = card.getByRole('button', { name: /(?:Valider le classement|Corriger avant validation)/ });
    proposals.push({
      fixture, card, proposedName, destination,
      reviewRequired: await card.getByText('à vérifier', { exact: true }).isVisible()
        && await card.getByText(/exclue de Tout valider/).isVisible(),
      confirmEnabled: await confirmButton.isEnabled(),
    });
  }
  const { confirm: confirmed, ignore: ignored } = chooseDecisionFixtures(proposals);
  assert(confirmed.fixture.id === invoiceFixture.id && ignored.fixture.id === reviewFixture.id, 'Decision fixtures did not preserve confirm and review-required ignore roles');
  const confirmedCard = confirmed.card;
  const ignoredCard = ignored.card;
  await expectReviewRequiredProposal(proposals.find(({ reviewRequired }) => reviewRequired).card);
  const reviewProof = await db('proposal', organizationId, reviewFixture.id);
  item5Proof.genuineManualReview = genuineManualReview(reviewProof);
  item5Proof.notExtractionFailed = reviewProof?.reviewReason !== 'extraction_failed';
  assert(item5Proof.genuineManualReview && item5Proof.notExtractionFailed, 'Review fixture did not produce a genuine destination-less manual review');
  evidence.realDriveDownloadOcr = 'PASS';
  evidence.realProposalReview = 'PASS';
  await page.screenshot({ path: path.join(screenshotDir, 'live-google-sa-desktop-review.png'), fullPage: true });
  evidence.desktopBrowser = 'PASS';

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await copyCookies(context, mobile);
  await mobilePage.goto(`${webBase}/dashboard`);
  await mobilePage.getByText(authenticationMode === 'user' ? stagingAccountEmail : 'Validation staging · identité de service Google', { exact: true }).waitFor();
  await mobilePage.screenshot({ path: path.join(screenshotDir, 'live-google-sa-mobile-390.png'), fullPage: true });
  evidence.mobile390Browser = 'PASS';
  await mobile.close();

  const confirmPath = confirmed.destination;
  const ignoredBefore = await metadata(ignored.fixture.id);
  await confirmedCard.getByRole('button', { name: /Valider le classement/ }).click();
  await expect(confirmedCard).toHaveCount(0);
  const ignoreButton = ignoredCard.getByRole('button', { name: 'Ignorer' });
  await expect(ignoreButton).toHaveAttribute('title', 'Ignorer cette proposition — le fichier reste à sa place');
  writeFileSync(ignoreMutationLogPath, '', { mode: 0o600 });
  ignoreMutationCount = 0;
  ignoreWindowOpen = true;
  try {
    await ignoreButton.click();
    await expect(ignoredCard).toHaveCount(0);
    ignoreMutationCount = readFileSync(ignoreMutationLogPath, 'utf8').split('\n').filter(Boolean).length;
  } finally {
    ignoreWindowOpen = false;
  }
  item4Proof.ignoreFilesUpdateOrMoveCount = ignoreMutationCount;
  assert(ignoreMutationCount === 0, 'Ignore issued a Drive files.update or move mutation');
  await expect(page.getByRole('region', { name: 'Historique' })).toBeVisible();

  const confirmedMeta = await metadata(confirmed.fixture.id);
  const confirmDestination = Object.values(destinations).find((item) => `/${item.name}` === confirmPath);
  assert(
    confirmDestination && confirmedMeta.name === confirmed.proposedName && sameParents(confirmedMeta.parents, [confirmDestination.id]),
    'Confirm provider metadata mismatch',
  );
  evidence.realDriveConfirmMutation = 'PASS';
  const ignoredMeta = await metadata(ignored.fixture.id);
  item4Proof.ignoredNameIdentical = ignoredMeta.name === ignoredBefore.name;
  item4Proof.ignoredParentsIdentical = sameParents(ignoredMeta.parents, ignoredBefore.parents);
  assert(
    ignoredMeta.name === ignoredBefore.name && sameParents(ignoredMeta.parents, ignoredBefore.parents),
    'Ignore changed provider name or parents',
  );
  assert(!(await listChildren(reference.id)).some((item) => item.name === removedFolderName), 'Removed routing folder exists after ignore');
  item4Proof.absentDuringAcceptance = true;
  evidence.realDriveIgnoreNoMutation = 'PASS';
  evidence.freshProviderMetadata = 'PASS';
  assert(await db('count', organizationId, 'documents', 'CLASSIFIED,IGNORED') === 2, 'UI decisions did not persist terminal document states');

  await page.screenshot({ path: path.join(screenshotDir, 'live-google-sa-desktop-final.png'), fullPage: true });
  const finalMobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const finalMobilePage = await finalMobile.newPage();
  await copyCookies(context, finalMobile);
  await finalMobilePage.goto(`${webBase}/dashboard`);
  await finalMobilePage.getByRole('region', { name: 'Historique' }).waitFor();
  await finalMobilePage.screenshot({ path: path.join(screenshotDir, 'live-google-sa-mobile-390-final.png'), fullPage: true });
  await finalMobile.close();

  const relaunch = await api(`/organizations/${organizationId}/drive/launch`, {
    method: 'POST', body: JSON.stringify({ itemExternalId: invoiceFixture.id }),
  });
  assert(relaunch.enqueued === 0, 'terminal documents were re-enqueued');


  failureStage = 'correction-relaunch';
  await restoreFixtures(false);
  await restoreMetadata(reviewFixture.id, { ...reviewFixture, name: fixtureNames[1], parents: [sharedRootId], trashed: false });
  await replaceBytes(reviewFixture.id, reviewBytes);
  await resetTenantData(organizationId);
  assert(await db('count', organizationId, 'rules') === 0, 'Correction run must have zero rules');
  await configureLlmThroughUi(page);
  await page.goto(`${webBase}/dashboard`);
  await page.getByRole('button', { name: 'Choisir ce dossier' }).waitFor();
  await expect(page.locator('#llm-launch-help')).toHaveCount(0);
  await chooseBrowserItem(page, 'stg_tree', 'Choisir ce dossier');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await chooseBrowserItem(page, reviewFixture.name, "Lancer l'organisation", true);
  await waitForProposalCards(page, 1);
  const correctionFixture = reviewFixture;
  const directCard = proposalCardFor(page, correctionFixture.name);
  await directCard.getByRole('button', { name: 'Corriger', exact: true }).click();
  const correctionDialog = page.getByRole('dialog', { name: 'Éditer la proposition' });
  await expect(correctionDialog).toBeVisible();
  item5Proof.overlayVisible = true;
  const correctionProof = await db('proposal', organizationId, correctionFixture.id);
  assert(genuineManualReview(correctionProof), 'Correction fixture did not produce a genuine destination-less manual review');
  await expect(correctionDialog).toContainText(correctionProof.reviewReason);
  item5Proof.overlayReasonVisible = true;
  await page.screenshot({ path: path.join(screenshotDir, 'live-google-sa-item-5-overlay-1280.png'), fullPage: true });
  const correctedName = `Document_Corrige${path.extname(correctionFixture.name)}`;
  await correctionDialog.getByLabel('Nom du fichier proposé').fill(correctedName);
  item5Proof.overlayNameEdited = await correctionDialog.getByLabel('Nom du fichier proposé').inputValue() === correctedName;
  await correctionDialog.getByLabel('Dossier de destination').selectOption(destinations.meetings.id);
  item5Proof.overlayDestinationEdited = await correctionDialog.getByLabel('Dossier de destination').inputValue() === destinations.meetings.id;
  const beforeValidation = await metadata(correctionFixture.id);
  item5Proof.noMutationBeforeValidation = beforeValidation.name === fixtureNames[1]
    && sameParents(beforeValidation.parents, [sharedRootId])
    && sameBytes(await downloadBytes(correctionFixture.id), reviewBytes);
  assert(item5Proof.noMutationBeforeValidation, 'Provider changed before explicit validation');
  await correctionDialog.getByRole('button', { name: 'Valider', exact: true }).click();
  item5Proof.explicitValidateClicked = true;
  await expect(directCard).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Historique' })).toBeVisible();
  const correctedMeta = await metadata(correctionFixture.id);
  assert(correctedMeta.name === correctedName && sameParents(correctedMeta.parents, [destinations.meetings.id]), 'direct correction metadata mismatch');
  item5Proof.correctedNameExact = correctedMeta.name === correctedName;
  item5Proof.correctedParentExact = sameParents(correctedMeta.parents, [destinations.meetings.id]);
  evidence.realDriveCorrectMutation = 'PASS';
  assert(await db('count', organizationId, 'documents', 'CLASSIFIED') === 1, 'UI correction did not persist classified state');
  await expect(page.getByText('Classés', { exact: true }).locator('..').getByText('1', { exact: true })).toBeVisible();
  item5Proof.browserKpiUpdated = true;
  await page.screenshot({ path: path.join(screenshotDir, 'live-google-sa-item-5-post-validation-1280.png'), fullPage: true });
  item5Proof.postValidationScreenshot = true;
  const directRelaunch = await api(`/organizations/${organizationId}/drive/launch`, { method: 'POST', body: JSON.stringify({ itemExternalId: correctionFixture.id }) });
  assert(directRelaunch.enqueued === 0, 'terminal direct file was re-enqueued');
  evidence.terminalNoReenqueue = 'PASS';
  writeFileSync(observedPath, `${JSON.stringify({ schema: 'klasr-live-observed-v1', stage: 'env-llm-verified', selectedModelId: selectedLlmModel, modelUsed: observedModelUsed, tree: initialTreeBinding })}\n`, { mode: 0o600 });
  runCompleted = true;
} catch (error) {
  failureStageAtFailure = failureStage;
  failureDetail = error?.launchFailureDetail ?? sanitizeFailure(error);
  failureDiagnostic = await failedAnalysisDiagnostic().catch(() => undefined);
  failureDiagnostic ??= safeFailureReason(error);
  process.exitCode = 1;
} finally {
  await finalize().catch((error) => {
    failureStageAtFailure ??= 'cleanup-finalization';
    failureDetail ??= sanitizeFailure(error);
    failureDiagnostic ??= 'stage=cleanup-finalization';
    process.exitCode = 1;
  });
  if (failureStageAtFailure) process.stderr.write(`root failure: ${failureDiagnostic ?? `stage=${failureStageAtFailure}`} detail=${failureDetail}\n`);
}

if (Object.entries(evidence).some(([key, value]) => key !== 'identity' && typeof value === 'string' && value !== 'PASS')) process.exitCode = 1;

function required(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
function safeFailureReason(error) {
  if (failureStage === 'listing') {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'stage=listing reason=provider_timeout';
    const provider = /^Google Drive request failed \((\d{3}), ([a-zA-Z0-9_-]+)\)$/.exec(error?.message ?? '');
    if (provider) return `stage=listing reason=provider_${provider[1]}_${provider[2]}`;
  }
  if (failureStage !== 'ui-decisions-provider-metadata') return undefined;
  if (error?.message === 'Ignore changed provider name or parents') return 'stage=ui-decisions-provider-metadata reason=ignore_metadata_changed';
  if (error?.message === 'Removed routing folder exists after ignore') return 'stage=ui-decisions-provider-metadata reason=legacy_folder_present';
}
function sanitizeFailure(error, secrets = [process.env.KLASR_LLM_API_KEY, process.env.KLASR_STAGING_ACCOUNT_PASSWORD, accessToken, internalSecret, nextAuthSecret, tokenKey]) {
  return redact(error?.message ?? error ?? 'Unknown error', secrets)
    .split(/\r?\n/).filter((line) => !/^\s*Received\b/.test(line)).slice(0, 3).join(' ')
    .replace(/\s+/g, ' ').trim().slice(0, 500);
}
function redact(value, secrets = [process.env.KLASR_LLM_API_KEY, accessToken, internalSecret, nextAuthSecret, tokenKey]) {
  let redacted = String(value);
  for (const secret of secrets.filter(Boolean)) redacted = redacted.replaceAll(secret, '[REDACTED]');
  return redacted.replace(/(?:sk-ant-|sk-proj-|sk-)[A-Za-z0-9_-]+|ya29\.[\w.-]+/g, '[REDACTED]');
}
function assertLlmSetupSequence(events) {
  let configured = false;
  for (const event of events) {
    if (event === 'reset') configured = false;
    else if (event === 'configure') configured = true;
    else if (event === 'launch') assert(configured, 'LLM setup must follow every tenant reset before launch');
  }
}
function finalize() {
  return finalizationFlight ??= (async () => {
    failureDiagnostic ??= await failedAnalysisDiagnostic().catch(() => undefined);
    failureStage = 'cleanup-finalization';
    if (browser) await browser.close().catch(() => undefined);
    cleanup.fixtureRestored = await restoreFixtures().then(() => true, () => false);
    if (quotaSafeMode && fixtureSnapshots.length === 2) {
      const restoredCarriers = await Promise.all(fixtureSnapshots.map((snapshot) => metadata(snapshot.id).catch(() => undefined)));
      item5Proof.exactRestorationVerified = restoredCarriers.every(Boolean)
        && (await Promise.all(fixtureSnapshots.map((snapshot) => fixtureMatches(snapshot)))).every(Boolean);
      item5Proof.recoveryMarkerCleared = restoredCarriers.every((carrier, index) => !recoveryMarker(carrier, fixtureSnapshots[index].recoveryScope));
    }
    cleanup.legacyFolderRestored = await restoreLegacyFolder();
    cleanup.fixtureRestored &&= cleanup.legacyFolderRestored;
    for (const id of [...createdIds].reverse()) await trash(id).catch(() => undefined);
    cleanup.createdItemsRemoved = await createdGone().catch(() => false);
    if (accessToken && sharedRootId) {
      const finalRootItems = await listChildren(sharedRootId).catch(() => []);
      item5Proof.createdFixtureTrashed = createdIds.length === 0;
      item5Proof.finalExactNameCount = finalRootItems.filter(({ name }) => name === fixtureNames[1]).length;
      item5Proof.finalPdfCount = finalRootItems.filter(({ name, mimeType }) => name === fixtureNames[1] && mimeType === 'application/pdf').length;
    }
    cleanup.tenantCleaned = organizationId ? await cleanupTenant(organizationId).then(() => true, () => false) : true;
    evidence.cleanup = await cleanupVerified().catch(() => false) ? 'PASS' : 'FAIL';
    cleanup.appsStopped = await stopApps(children).then(() => true, () => false);
    cleanup.noOrphans = children.every(({ child }) => !groupAlive(child.pid))
      && !(await Promise.all([reachable(`${apiBase}/health`), reachable(webBase)])).some(Boolean);
    accessToken = undefined;
    const finalTreeBinding = currentTreeBinding(root);
    assertTreeBinding(initialTreeBinding, finalTreeBinding);
    const sanitizedItem4 = sanitizedItem4Proof(item4Proof, evidenceTask, lineage, finalTreeBinding);
    assertItem4Proof(sanitizedItem4, evidenceTask, lineage, finalTreeBinding, runCompleted);
    writeFileSync(item4ProofPath, `${JSON.stringify(sanitizedItem4, null, 2)}\n`, { mode: 0o600 });
    const sanitizedItem3 = sanitizedItem3Proof(item3Proof, evidenceTask, lineage, finalTreeBinding);
    assertItem3Proof(sanitizedItem3, evidenceTask, lineage, finalTreeBinding, runCompleted);
    writeFileSync(item3ProofPath, `${JSON.stringify(sanitizedItem3, null, 2)}\n`, { mode: 0o600 });
    const sanitizedItem5 = sanitizedItem5Proof(item5Proof, evidenceTask, lineage, finalTreeBinding);
    assertItem5Proof(sanitizedItem5, evidenceTask, lineage, finalTreeBinding, runCompleted, quotaSafeMode);
    writeFileSync(item5ProofPath, `${JSON.stringify(sanitizedItem5, null, 2)}\n`, { mode: 0o600 });
    const observed = runCompleted ? parseObservedRecord(readFileSync(observedPath, 'utf8'), finalTreeBinding) : undefined;
    const manifest = sanitizedManifest(evidence, cleanup, lineage, finalTreeBinding, observed, runCompleted, item5Proof, quotaSafeMode, failureDetail);
    assertManifest(manifest);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(realAcceptancePath, realAcceptanceMarkdown(manifest, evidenceTask, selectedLlmModel, llmProvider), { mode: 0o600 });
    normalCleanupDone = true;
    if (manifest.status !== 'PASS' || !cleanup.appsStopped) process.exitCode = 1;
  })();
}
function realAcceptanceMarkdown(manifest, task, model, provider = 'llm') {
  const live = manifest.status === 'PASS' ? 'PASS' : acceptanceBlocked ? 'BLOCKED' : 'FAIL';
  return `# Real LLM + Google acceptance\n\n- Task: \`${task}\`\n- Attempt: \`${manifest.attempt}\`\n- SHA: \`${manifest.sha}\`\n- Fake/browser fixture evidence: separate deterministic acceptance; never promoted to live-provider PASS.\n- Genuine LLM + Google browser: **${live}**\n- Provider metadata: \`${model ? `${provider}/${model}` : 'not-recorded'}\`\n- Cleanup: **${manifest.cleanup.fixture_restored && manifest.cleanup.created_items_removed && manifest.cleanup.tenant_cleaned && manifest.processes.apps_stopped && manifest.processes.no_orphans ? 'PASS' : 'FAIL'}**\n`;
}
function sanitizedManifest(raw, proof, manifestLineage, tree, observed, completed, item5Assertions, borrowedMode = false, detail) {
  const results = {
    llm_classification: raw.llmClassification === 'PASS',
    service_account_auth: raw.serviceAccountAuth === 'PASS', drive_listing: raw.realDriveListing === 'PASS',
    drive_download_ocr: raw.realDriveDownloadOcr === 'PASS', proposal_review: raw.realProposalReview === 'PASS',
    confirm_mutation: raw.realDriveConfirmMutation === 'PASS', correction_mutation: raw.realDriveCorrectMutation === 'PASS',
    reject_mutation: raw.realDriveIgnoreNoMutation === 'PASS', terminal_no_reenqueue: raw.terminalNoReenqueue === 'PASS',
    desktop_browser: raw.desktopBrowser === 'PASS', mobile_390_browser: raw.mobile390Browser === 'PASS',
    launch_completion: raw.launchCompletion === 'PASS', fresh_provider_metadata: raw.freshProviderMetadata === 'PASS',
  };
  const cleanupResult = { fixture_restored: proof.fixtureRestored, created_items_removed: proof.createdItemsRemoved, tenant_cleaned: proof.tenantCleaned };
  const processes = { apps_stopped: proof.appsStopped, no_orphans: proof.noOrphans };
  const passed = completed && observed
    && [...Object.values(results), ...Object.values(cleanupResult), ...Object.values(processes)].every((value) => value === true);
  return {
    version: 1,
    identity: raw.identity ?? 'Google service account non-production acceptance',
    ...manifestLineage,
    status: passed ? 'PASS' : 'FAIL', failureDetail: detail ?? null, tree, observed: observed ?? null, results, cleanup: cleanupResult, processes,
  };
}
function parseLineage(env) {
  const value = { sha: env.KLASR_EVIDENCE_SHA, issue: Number(env.KLASR_EVIDENCE_ISSUE), attempt: Number(env.KLASR_EVIDENCE_ATTEMPT) };
  assert(/^[0-9a-f]{40}$/.test(value.sha ?? '') && /^\d+$/.test(env.KLASR_EVIDENCE_ISSUE ?? '') && value.issue > 0 && /^\d+$/.test(env.KLASR_EVIDENCE_ATTEMPT ?? '') && value.attempt > 0, 'Evidence lineage is invalid');
  return value;
}
function fixtureMode(env) {
  if (Object.hasOwn(env, 'KLASR_LIVE_FIXTURE_MODE')) assert(['runner-owned', 'borrowed-carrier'].includes(env.KLASR_LIVE_FIXTURE_MODE), 'Live fixture mode is invalid');
  return env.KLASR_LIVE_FIXTURE_MODE ?? 'borrowed-carrier';
}
function authMode(env) {
  const mode = env.KLASR_AUTH_MODE ?? 'sa';
  assert(['sa', 'user'].includes(mode), 'KLASR_AUTH_MODE must be sa or user');
  return mode;
}
function manualConsent(env, mode) {
  const value = env.KLASR_MANUAL_CONSENT ?? 'false';
  assert(['true', 'false'].includes(value), 'KLASR_MANUAL_CONSENT must be true or false');
  assert(value !== 'true' || mode === 'user', 'KLASR_MANUAL_CONSENT=true requires KLASR_AUTH_MODE=user');
  return value === 'true';
}
function manualConsentTimeoutMs(env) {
  const value = env.KLASR_MANUAL_CONSENT_TIMEOUT ?? '2400000';
  assert(/^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0, 'KLASR_MANUAL_CONSENT_TIMEOUT must be a positive integer');
  return Number(value);
}
function assertProviderMutationAllowed(mode, route, init) {
  assert(!(mode === 'borrowed-carrier' && init.method === 'POST' && /^\/(?:upload\/)?drive\/v3\/files(?:[/?]|$)/.test(route)), 'Borrowed carrier mode forbids provider file creates');
}
function parseEvidenceTask(env) { assert(/^t_[a-z0-9]+$/.test(env.KLASR_EVIDENCE_TASK ?? ''), 'Evidence task is invalid'); return env.KLASR_EVIDENCE_TASK; }
function assertManifest(manifest) {
  const keys = (value) => Object.keys(value).sort().join(',');
  assert(keys(manifest) === 'attempt,cleanup,failureDetail,identity,issue,observed,processes,results,sha,status,tree,version', 'Sanitized manifest top-level schema mismatch');
  assert(manifest.failureDetail === null || typeof manifest.failureDetail === 'string', 'Sanitized manifest failure detail is invalid');
  assert(keys(manifest.results) === 'confirm_mutation,correction_mutation,desktop_browser,drive_download_ocr,drive_listing,fresh_provider_metadata,launch_completion,llm_classification,mobile_390_browser,proposal_review,reject_mutation,service_account_auth,terminal_no_reenqueue', 'Sanitized manifest result schema mismatch');
  assert(keys(manifest.cleanup) === 'created_items_removed,fixture_restored,tenant_cleaned', 'Sanitized manifest cleanup schema mismatch');
  assert(keys(manifest.processes) === 'apps_stopped,no_orphans', 'Sanitized manifest process schema mismatch');
  assert(/^[0-9a-f]{40}$/.test(manifest.sha) && Number.isInteger(manifest.issue) && manifest.issue > 0 && Number.isInteger(manifest.attempt) && manifest.attempt > 0, 'Sanitized manifest lineage is invalid');
}
function sanitizedItem4Proof(assertions, task, proofLineage, tree) {
  return { schema: 'klasr-item4-provider-proof-v1', task, attempt: proofLineage.attempt, sha: proofLineage.sha, tree, assertions };
}
function assertItem4Proof(proof, task, proofLineage, tree, requireComplete = false) {
  const keys = (value) => Object.keys(value).sort().join(',');
  assert(keys(proof) === 'assertions,attempt,schema,sha,task,tree' && proof.schema === 'klasr-item4-provider-proof-v1', 'Item 4 proof schema mismatch');
  assert(proof.task === task && proof.attempt === proofLineage.attempt && proof.sha === proofLineage.sha, 'Item 4 proof lineage mismatch');
  assert(keys(proof.assertions) === 'absentDuringAcceptance,freshRestorationReadback,ignoreFilesUpdateOrMoveCount,ignoredNameIdentical,ignoredParentsIdentical,oneLegacyFolderQuarantined,quarantinedOutsideReference,restorationOutsideIgnoreWindow,restoredNameExact,restoredParentsExact,setupOutsideIgnoreWindow', 'Item 4 proof assertion schema mismatch');
  assert(Object.entries(proof.assertions).every(([key, value]) => key === 'ignoreFilesUpdateOrMoveCount' ? value === null || Number.isInteger(value) : typeof value === 'boolean'), 'Item 4 proof assertion value invalid');
  if (requireComplete) assert(Object.entries(proof.assertions).every(([key, value]) => key === 'ignoreFilesUpdateOrMoveCount' ? value === 0 : value === true), 'Item 4 proof assertions incomplete');
  assertTreeBinding(tree, proof.tree);
}
function sanitizedItem3Proof(assertions, task, proofLineage, tree) {
  return { schema: 'klasr-item3-provider-proof-v1', task, issue: proofLineage.issue, attempt: proofLineage.attempt, sha: proofLineage.sha, tree, assertions };
}
function assertItem3Proof(proof, task, proofLineage, tree, requireComplete = false) {
  const keys = (value) => Object.keys(value).sort().join(',');
  assert(keys(proof) === 'assertions,attempt,issue,schema,sha,task,tree' && proof.schema === 'klasr-item3-provider-proof-v1', 'Item 3 proof schema mismatch');
  assert(proof.task === task && proof.issue === proofLineage.issue && proof.attempt === proofLineage.attempt && proof.sha === proofLineage.sha, 'Item 3 proof lineage mismatch');
  assert(keys(proof.assertions) === 'driveConnectionPresent,fileBrowserVisible,grantedScopes,lastSyncAt,realSyncObserved,serviceAccountIdentityVerified', 'Item 3 proof assertion schema mismatch');
  assert(typeof proof.assertions.serviceAccountIdentityVerified === 'boolean', 'Item 3 identity read-back invalid');
  assert(Array.isArray(proof.assertions.grantedScopes) && proof.assertions.grantedScopes.every((scope) => typeof scope === 'string'), 'Item 3 granted-scope read-back invalid');
  assert(proof.assertions.lastSyncAt === null || !Number.isNaN(Date.parse(proof.assertions.lastSyncAt)), 'Item 3 lastSyncAt invalid');
  assert(typeof proof.assertions.driveConnectionPresent === 'boolean' && typeof proof.assertions.realSyncObserved === 'boolean' && typeof proof.assertions.fileBrowserVisible === 'boolean', 'Item 3 boolean assertion invalid');
  if (requireComplete) assert(proof.assertions.serviceAccountIdentityVerified && proof.assertions.grantedScopes.includes('https://www.googleapis.com/auth/drive') && proof.assertions.driveConnectionPresent && proof.assertions.lastSyncAt && proof.assertions.realSyncObserved && proof.assertions.fileBrowserVisible, 'Item 3 proof assertions incomplete');
  assertTreeBinding(tree, proof.tree);
}
function sanitizedItem5Proof(assertions, task, proofLineage, tree) {
  return { schema: 'klasr-item5-provider-proof-v1', task, issue: proofLineage.issue, attempt: proofLineage.attempt, sha: proofLineage.sha, tree, assertions };
}
function item5ProofTemplate() { return { originalExactNameCount: null, originalPdfCount: null, borrowedCarrierIdStable: false, borrowedCarrierSnapshotted: false, recoveryMarkerVerified: false, originalBytesRetained: false, anthropicProvenance: false, genuineManualReview: false, notExtractionFailed: false, overlayReasonVisible: false, overlayNameEdited: false, overlayDestinationEdited: false, noMutationBeforeValidation: false, createdRunnerOwned: false, createdInAuthorizedRoot: false, headedBrowser: false, overlayVisible: false, explicitValidateClicked: false, correctedNameExact: false, correctedParentExact: false, browserKpiUpdated: false, postValidationScreenshot: false, exactRestorationVerified: false, recoveryMarkerCleared: false, createdFixtureTrashed: false, finalExactNameCount: null, finalPdfCount: null }; }
function assertItem5Proof(proof, task, proofLineage, tree, requireComplete = false, borrowedMode = false) {
  const keys = (value) => Object.keys(value).sort().join(',');
  assert(keys(proof) === 'assertions,attempt,issue,schema,sha,task,tree' && proof.schema === 'klasr-item5-provider-proof-v1', 'Item 5 proof schema mismatch');
  assert(proof.task === task && proof.issue === proofLineage.issue && proof.attempt === proofLineage.attempt && proof.sha === proofLineage.sha, 'Item 5 proof lineage mismatch');
  assert(keys(proof.assertions) === 'anthropicProvenance,borrowedCarrierIdStable,borrowedCarrierSnapshotted,browserKpiUpdated,correctedNameExact,correctedParentExact,createdFixtureTrashed,createdInAuthorizedRoot,createdRunnerOwned,exactRestorationVerified,explicitValidateClicked,finalExactNameCount,finalPdfCount,genuineManualReview,headedBrowser,noMutationBeforeValidation,notExtractionFailed,originalBytesRetained,originalExactNameCount,originalPdfCount,overlayDestinationEdited,overlayNameEdited,overlayReasonVisible,overlayVisible,postValidationScreenshot,recoveryMarkerCleared,recoveryMarkerVerified', 'Item 5 proof assertion schema mismatch');
  const counts = ['originalExactNameCount', 'originalPdfCount', 'finalExactNameCount', 'finalPdfCount'];
  assert(Object.entries(proof.assertions).every(([key, value]) => counts.includes(key) ? value === null || Number.isInteger(value) : typeof value === 'boolean'), 'Item 5 proof assertion value invalid');
  if (requireComplete && borrowedMode) {
    const requiredTrue = ['anthropicProvenance', 'borrowedCarrierIdStable', 'borrowedCarrierSnapshotted', 'browserKpiUpdated', 'correctedNameExact', 'correctedParentExact', 'createdFixtureTrashed', 'exactRestorationVerified', 'explicitValidateClicked', 'genuineManualReview', 'headedBrowser', 'noMutationBeforeValidation', 'notExtractionFailed', 'originalBytesRetained', 'overlayDestinationEdited', 'overlayNameEdited', 'overlayReasonVisible', 'overlayVisible', 'postValidationScreenshot', 'recoveryMarkerCleared', 'recoveryMarkerVerified'];
    assert(proof.assertions.originalExactNameCount === proof.assertions.finalExactNameCount
      && proof.assertions.originalPdfCount === proof.assertions.finalPdfCount
      && proof.assertions.createdRunnerOwned === false && proof.assertions.createdInAuthorizedRoot === false
      && requiredTrue.every((key) => proof.assertions[key] === true), 'Item 5 borrowed-carrier proof assertions incomplete');
  } else if (requireComplete) assert(proof.assertions.finalExactNameCount === proof.assertions.originalExactNameCount && proof.assertions.finalPdfCount === proof.assertions.originalPdfCount, 'Item 5 proof assertions incomplete');
  assertTreeBinding(tree, proof.tree);
}
function loopback(value) { const url = new URL(value); if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('Live app URLs must use loopback'); return value.replace(/\/$/, ''); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function assertThrows(action, message) { try { action(); } catch { return; } throw new Error(message); }
function genuineManualReview(proposal) { return proposal?.reviewRequired === true && !proposal.destinationPath && typeof proposal.reviewReason === 'string' && proposal.reviewReason.trim().length > 0 && proposal.reviewReason !== 'extraction_failed'; }
function exact(items, name, mimeType) { const matches = items.filter((item) => item.name === name && item.mimeType === mimeType); assert(matches.length === 1, `Expected exactly one provider item named ${name}`); return matches[0]; }

async function serviceAccountToken() {
  const credential = JSON.parse(readFileSync(credentialPath, 'utf8'));
  assert(credential.type === 'service_account' && credential.client_email && credential.private_key && credential.token_uri, 'Invalid service-account credential');
  const now = Math.floor(Date.now() / 1000);
  const enc = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: credential.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: credential.token_uri, iat: now, exp: now + 3600 })}`;
  const assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), credential.private_key).toString('base64url')}`;
  const response = await fetch(credential.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  assert(response.ok, `Service-account token exchange failed (${response.status})`);
  const payload = await response.json();
  assert(payload.access_token, 'Service-account token response omitted access token');
  return payload.access_token;
}
async function providerTokenInfo(fetcher = fetch, token = accessToken) {
  const response = await fetcher(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  assert(response.ok, `Service-account granted-scope read-back failed (${response.status})`);
  const payload = await response.json();
  const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean).sort() : [];
  assert(scopes.includes('https://www.googleapis.com/auth/drive'), 'Service-account Drive scope read-back incomplete');
  return scopes;
}
async function providerDriveIdentity(fetcher = fetch, token = accessToken) {
  const response = await fetcher('https://www.googleapis.com/drive/v3/about?fields=user%28emailAddress%29', { headers: { Authorization: `Bearer ${token}` } });
  assert(response.ok, `Service-account Drive identity read-back failed (${response.status})`);
  const emailAddress = (await response.json())?.user?.emailAddress;
  assert(/^[^\s@]+@[^\s@]+$/.test(emailAddress ?? ''), 'Service-account Drive identity read-back incomplete');
  return emailAddress;
}

async function drive(url, init = {}) { assertProviderMutationAllowed(quotaSafeMode ? 'borrowed-carrier' : 'runner-owned', url, init); const response = await fetch(`https://www.googleapis.com${url}`, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) } }); if (!response.ok) { let reason = 'unknown'; try { const payload = await response.json(); reason = payload?.error?.errors?.[0]?.reason ?? 'unknown'; } catch { /* status remains sufficient */ } throw new Error(`Google Drive request failed (${response.status}, ${reason})`); } return response.status === 204 ? null : response.json(); }
async function listChildren(parentId) { const q = new URLSearchParams({ q: `'${parentId.replaceAll("'", "\\'")}' in parents and trashed=false`, pageSize: '1000', fields: 'files(id,name,mimeType,parents)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }); return (await drive(`/drive/v3/files?${q}`)).files ?? []; }
async function metadata(id) { return drive(`/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,parents,trashed,headRevisionId,appProperties,driveId&supportsAllDrives=true`); }
async function downloadBytes(id) { const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${accessToken}` } }); assert(response.ok, `Google Drive media request failed (${response.status})`); return Buffer.from(await response.arrayBuffer()); }
async function downloadRevision(id, revisionId) { const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } }); assert(response.ok, `Google Drive revision media request failed (${response.status})`); return Buffer.from(await response.arrayBuffer()); }
async function listRevisions(id) { const revisions = []; let pageToken; do { const query = new URLSearchParams({ pageSize: '1000', fields: 'nextPageToken,revisions(id,keepForever)', ...(pageToken ? { pageToken } : {}) }); const page = await drive(`/drive/v3/files/${encodeURIComponent(id)}/revisions?${query}`); revisions.push(...(page.revisions ?? [])); pageToken = page.nextPageToken; } while (pageToken); return revisions; }
async function replaceBytes(id, bytes) { return drive(`/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true&fields=id,name,mimeType,parents`, { method: 'PATCH', headers: { 'content-type': 'application/pdf' }, body: bytes }); }
async function trash(id) { await drive(`/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); }
async function createdGone() { if (!accessToken) return createdIds.length === 0; for (const id of createdIds) { try { const item = await metadata(id); if (!item.trashed) return false; } catch { /* deleted is clean */ } } return true; }
async function restoreMetadata(id, target) { const current = await metadata(id); const query = new URLSearchParams({ supportsAllDrives: 'true', fields: 'id,name,mimeType,parents,trashed' }); const add = target.parents.filter((parent) => !current.parents.includes(parent)); const remove = current.parents.filter((parent) => !target.parents.includes(parent)); if (add.length) query.set('addParents', add.join(',')); if (remove.length) query.set('removeParents', remove.join(',')); return drive(`/drive/v3/files/${encodeURIComponent(id)}?${query}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: target.name, trashed: target.trashed }) }); }
async function markLegacyFolderRecovery(id, parentId) { await drive(`/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,appProperties`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appProperties: { klasrLegacyFolderRecovery: recoveryVersion, klasrLegacyFolderParent: parentId } }) }); }
async function clearLegacyFolderRecovery(id) { await drive(`/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,appProperties`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appProperties: { klasrLegacyFolderRecovery: null, klasrLegacyFolderParent: null } }) }); }
async function legacyFolderCandidates() { const q = new URLSearchParams({ q: `appProperties has { key='klasrLegacyFolderRecovery' and value='${recoveryVersion}' }`, corpora: 'allDrives', pageSize: '1000', fields: 'files(id,name,mimeType,parents,trashed,appProperties)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }); return (await drive(`/drive/v3/files?${q}`)).files ?? []; }
async function recoverLegacyFolder() { const candidates = await legacyFolderCandidates(); assert(candidates.length <= 1, 'Ambiguous legacy folder recovery marker'); if (!candidates.length) return; const folder = candidates[0]; const parentId = folder.appProperties?.klasrLegacyFolderParent; assert(typeof parentId === 'string' && parentId, 'Legacy folder recovery metadata is incomplete'); const reference = await metadata(parentId); assert(reference.name === 'stg_tree' && sameParents(reference.parents, [sharedRootId]), 'Legacy folder recovery candidate is outside the fixture scope'); const snapshot = { ...folder, name: removedFolderName, parents: [parentId], appProperties: withoutLegacyMarker(folder.appProperties) }; await restoreMetadata(folder.id, snapshot); await clearLegacyFolderRecovery(folder.id); assert(legacyFolderMatches(snapshot, await metadata(folder.id), true), 'Legacy folder crash recovery failed'); }
async function quarantineLegacyFolder(parentId) { assert(!ignoreWindowOpen, 'Legacy folder setup entered the Ignore mutation window'); const matches = (await listChildren(parentId)).filter((item) => item.name === removedFolderName && item.mimeType === 'application/vnd.google-apps.folder'); assert(matches.length === 1, 'Expected exactly one legacy holding folder in the reference fixture'); const folder = matches[0]; legacyFolderSnapshot = await metadata(folder.id); legacyFolderSnapshot.appProperties ??= {}; assertLegacyFolderSnapshot(legacyFolderSnapshot, parentId); await markLegacyFolderRecovery(folder.id, parentId); await restoreMetadata(folder.id, { ...legacyFolderSnapshot, name: `${removedFolderName}.__klasr_quarantine__`, parents: [sharedRootId] }); assert(legacyFolderMatches(legacyFolderSnapshot, await metadata(folder.id), false), 'Legacy holding folder quarantine failed'); item4Proof.oneLegacyFolderQuarantined = true; item4Proof.quarantinedOutsideReference = true; item4Proof.setupOutsideIgnoreWindow = true; }
async function restoreLegacyFolder() { if (!legacyFolderSnapshot) return true; try { assert(!ignoreWindowOpen, 'Legacy folder restoration entered the Ignore mutation window'); await restoreMetadata(legacyFolderSnapshot.id, legacyFolderSnapshot); await clearLegacyFolderRecovery(legacyFolderSnapshot.id); const restored = await metadata(legacyFolderSnapshot.id); assert(legacyFolderMatches(legacyFolderSnapshot, restored, true), 'Legacy holding folder restoration failed'); item4Proof.restorationOutsideIgnoreWindow = true; item4Proof.restoredNameExact = restored.name === legacyFolderSnapshot.name; item4Proof.restoredParentsExact = sameParents(restored.parents, legacyFolderSnapshot.parents); item4Proof.freshRestorationReadback = true; return true; } catch { return false; } }
function assertLegacyFolderSnapshot(snapshot, parentId) { assert(snapshot.id && snapshot.name === removedFolderName && snapshot.mimeType === 'application/vnd.google-apps.folder' && snapshot.trashed === false && sameParents(snapshot.parents, [parentId]) && snapshot.appProperties, 'Legacy holding folder metadata snapshot is incomplete'); }
function withoutLegacyMarker(appProperties = {}) { const copy = { ...appProperties }; delete copy.klasrLegacyFolderRecovery; delete copy.klasrLegacyFolderParent; return copy; }
function legacyFolderMatches(snapshot, current, restored) { const expectedProperties = snapshot.appProperties ?? {}; const currentProperties = restored ? (current.appProperties ?? {}) : withoutLegacyMarker(current.appProperties); return current.id === snapshot.id && current.mimeType === snapshot.mimeType && current.trashed === snapshot.trashed && sameParents(current.parents, restored ? snapshot.parents : [sharedRootId]) && (restored ? current.name === snapshot.name : current.name !== snapshot.name) && Object.keys(expectedProperties).sort().join() === Object.keys(currentProperties).sort().join() && Object.entries(expectedProperties).every(([key, value]) => currentProperties[key] === value); }
function recoveryMarker(item, expectedScope) {
  const marker = item.appProperties ?? {};
  const present = ['klasrRecoveryRevision', 'klasrRecoveryVersion', 'klasrRecoveryScope'].filter((key) => marker[key] !== undefined);
  if (!present.length) return;
  assert(present.length === 3 && marker.klasrRecoveryVersion === recoveryVersion && marker.klasrRecoveryScope === expectedScope && /^[A-Za-z0-9_-]+$/.test(marker.klasrRecoveryRevision), 'Invalid Drive recovery marker');
  return marker.klasrRecoveryRevision;
}
async function pinOriginalRevision(item, snapshotBytes) {
  const current = await metadata(item.id);
  assert(current.name === item.name && current.mimeType === 'application/pdf' && current.headRevisionId, 'Original binary revision is unavailable or mismatched');
  assert(sameBytes(await downloadBytes(item.id), snapshotBytes), 'Current fixture head does not match its snapshot');
  const pinned = (await listRevisions(item.id)).filter((revision) => revision.keepForever === true);
  const candidates = [];
  for (const candidate of pinned) {
    const candidateBytes = await downloadRevision(item.id, candidate.id);
    candidates.push({ ...candidate, matchesSnapshot: sameBytes(candidateBytes, snapshotBytes) });
  }
  const reusable = selectMatchingPinnedRevision(candidates);
  if (reusable) return reusable.id;
  const revision = await drive(`/drive/v3/files/${encodeURIComponent(item.id)}/revisions/${encodeURIComponent(current.headRevisionId)}?fields=id,keepForever`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keepForever: true }) });
  assert(revision.id === current.headRevisionId && revision.keepForever === true, 'Original binary revision was not pinned');
  const verified = await drive(`/drive/v3/files/${encodeURIComponent(item.id)}/revisions/${encodeURIComponent(revision.id)}?fields=id,keepForever`);
  assert(verified.id === revision.id && verified.keepForever === true, 'Original binary revision pin readback failed');
  return revision.id;
}
async function markRecovery(id, revisionId, scope) {
  await drive(`/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,appProperties`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appProperties: { klasrRecoveryRevision: revisionId, klasrRecoveryVersion: recoveryVersion, klasrRecoveryScope: scope } }) });
  assert(recoveryMarker(await metadata(id), scope) === revisionId, 'Drive recovery marker readback failed');
}
async function finishRecovery(id, scope) {
  await drive(`/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,appProperties`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appProperties: { klasrRecoveryRevision: null, klasrRecoveryVersion: null, klasrRecoveryScope: null } }) });
  assert(!recoveryMarker(await metadata(id), scope), 'Drive recovery marker clear readback failed');
}
async function restoreFromRevision(item, revisionId, target, scope, finish = true) {
  const revision = await drive(`/drive/v3/files/${encodeURIComponent(item.id)}/revisions/${encodeURIComponent(revisionId)}?fields=id,keepForever`);
  assert(revision.id === revisionId && revision.keepForever === true, 'Pinned recovery revision is missing or mismatched');
  const originalBytes = await downloadRevision(item.id, revisionId);
  if (target.bytes) assert(sameBytes(originalBytes, target.bytes), 'Pinned recovery revision does not match fixture snapshot');
  await replaceBytes(item.id, originalBytes);
  await restoreMetadata(item.id, target);
  const restored = await metadata(item.id);
  assert(restored.name === target.name && restored.mimeType === target.mimeType && restored.trashed === target.trashed && sameParents(restored.parents, target.parents) && sameBytes(await downloadBytes(item.id), originalBytes), 'Drive revision restoration readback failed');
  if (finish) await finishRecovery(item.id, scope);
}
async function recoveryCandidates(scope, driveId) {
  const q = new URLSearchParams({ q: `appProperties has { key='klasrRecoveryScope' and value='${scope}' }`, ...(driveId ? { corpora: 'drive', driveId } : { corpora: 'allDrives' }), pageSize: '1000', fields: 'files(id,name,mimeType,parents,trashed,appProperties)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
  return (await drive(`/drive/v3/files?${q}`)).files ?? [];
}
async function recoverMarkedFixtures() {
  accessToken = await serviceAccountToken();
  const { driveId } = await metadata(sharedRootId);
  for (const [index, scope] of ['invoice', 'manual'].entries()) {
    const candidates = await recoveryCandidates(scope, driveId);
    assert(candidates.length <= 1, 'Ambiguous Drive recovery marker');
    if (!candidates.length) continue;
    const item = candidates[0];
    const revisionId = recoveryMarker(item, scope);
    assert(revisionId, 'Exact Drive recovery marker is missing');
    await restoreFromRevision(item, revisionId, { name: fixtureNames[index], mimeType: 'application/pdf', parents: [sharedRootId], trashed: false }, scope);
  }
}
async function fixtureMatches(snapshot) { const current = await metadata(snapshot.id); return current.name === snapshot.name && current.mimeType === snapshot.mimeType && current.trashed === snapshot.trashed && sameParents(current.parents, snapshot.parents) && sameBytes(await downloadBytes(snapshot.id), snapshot.bytes); }
async function restoreFixtures(finish = true) {
  if (restorationFlight) return restorationFlight;
  if (!fixtureSnapshots.length) return { touched: 0 };
  restorationFlight = (async () => {
    accessToken = await serviceAccountToken();
    const results = await Promise.allSettled(fixtureSnapshots.map(async (snapshot) => {
      const revisionId = recoveryMarker(await metadata(snapshot.id), snapshot.recoveryScope);
      if (!revisionId) { assert(await fixtureMatches(snapshot), 'Unmarked fixture is not untouched or restored'); return; }
      await restoreFromRevision(snapshot, revisionId, snapshot, snapshot.recoveryScope, finish);
    }));
    assert(results.every(({ status }) => status === 'fulfilled'), 'Fixture restoration failed');
    const restored = await Promise.all(fixtureSnapshots.map(async (snapshot) => ({ ...await metadata(snapshot.id), bytes: await downloadBytes(snapshot.id) })));
    assert(restorationVerified(fixtureSnapshots, restored, fixtureSnapshots.map((snapshot) => ({ id: snapshot.id, bytes: observedReplacements.get(snapshot.id) }))), 'Fixture restoration verification failed');
    return { touched: fixtureSnapshots.length };
  })();
  try { return await restorationFlight; }
  finally { restorationFlight = undefined; }
}
async function cleanupVerified() { if (!fixtureSnapshots.length) return false; if (!cleanup.legacyFolderRestored) return false; accessToken = await serviceAccountToken(); const expectedReplacements = fixtureSnapshots.length; if (!(await createdGone()) || replacementAttempted.size !== expectedReplacements || replacementVerified.size !== expectedReplacements) return false; for (const snapshot of fixtureSnapshots) { const current = await metadata(snapshot.id); if (current.name !== snapshot.name || current.mimeType !== snapshot.mimeType || current.trashed !== snapshot.trashed || !sameParents(current.parents, snapshot.parents) || !sameBytes(await downloadBytes(snapshot.id), snapshot.bytes) || recoveryMarker(current, snapshot.recoveryScope)) return false; } const rootItems = await listChildren(sharedRootId); if (rootItems.filter(({ name }) => name === fixtureNames[1]).length !== item5Proof.originalExactNameCount || rootItems.filter(({ name, mimeType }) => name === fixtureNames[1] && mimeType === 'application/pdf').length !== item5Proof.originalPdfCount) return false; return !legacyFolderSnapshot || legacyFolderMatches(legacyFolderSnapshot, await metadata(legacyFolderSnapshot.id), true); }
function sameParents(actual = [], expected = []) { return actual.length === expected.length && actual.every((parent) => expected.includes(parent)); }
function sameBytes(actual, expected) { return createHash('sha256').update(actual).digest().equals(createHash('sha256').update(expected).digest()); }
// Stable choice: lexicographically smallest matching pinned revision ID.
function selectMatchingPinnedRevision(candidates) { return candidates.filter(({ matchesSnapshot }) => matchesSnapshot).sort((left, right) => left.id.localeCompare(right.id))[0]; }

function syntheticInvoicePdf(reference) {
  const text = ['INVOICE', 'Northwind Office Supplies', 'Bill to: Klasr Consulting', `Invoice number: ${reference}`, 'Invoice date: 2026-08-15', 'Professional services: EUR 1,200.00', 'VAT 20%: EUR 240.00', 'TOTAL DUE: EUR 1,440.00', 'Payment terms: 30 days'];
  const stream = `BT /F1 24 Tf 72 760 Td ${text.map((line, index) => `${index ? '0 -52 Td ' : ''}(${line.replace(/[()\\]/g, '\\$&')}) Tj`).join(' ')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
function reviewRequiredPdf() {
  const text = ['Contract REF-ZEPHYR-742 dated 2026-08-15', 'from Zephyr Research.', 'Archived research memorandum.'];
  const stream = `BT /F1 18 Tf 72 720 Td ${text.map((line, index) => `${index ? '0 -30 Td ' : ''}(${line}) Tj`).join(' ')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
function isPdf(bytes) { return Buffer.isBuffer(bytes) && bytes.subarray(0, 5).toString() === '%PDF-' && bytes.subarray(-6).toString().trim() === '%%EOF'; }
function existingFixturePdf(bytes) { return Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.subarray(0, 5).toString() === '%PDF-'; }
async function loginWithGoogleUser(page, email, password, manualTimeout) {
  const stage = () => { failureStage = 'google-consent'; };
  const visible = async (locator, timeout = 100) => locator.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
  const fail = async (substage, reason) => {
    stage(substage);
    const heading = await page.locator('h1, h2, [role="heading"]').first().innerText().catch(() => 'no visible heading');
    const text = await page.locator('body').innerText().catch(() => 'no visible page text');
    throw new Error(`substage=${substage}; ${reason}; URL=${page.url()}; heading=${heading}; visible page text=${text.slice(0, 1200)}`);
  };
  const challenge = async (substage) => {
    const identifier = page.locator('input[type="email"], input[name="identifier"]').first();
    if (await visible(identifier)) return false;
    const heading = await page.locator('h1, h2, [role="heading"]').first().innerText().catch(() => '');
    const text = await page.locator('body').innerText().catch(() => '');
    const challengeElement = page.locator('#captcha, iframe[src*="recaptcha"]').first();
    const challengeUrl = /\/challenge\/|\/v3\/signin\/challenge(?:\/|\?|$)/i.test(page.url());
    const challengeText = /suspicious|unusual traffic|connexion inhabituelle|security check|vérification de sécurité|this browser or app may not be secure|ce navigateur/i.test(`${heading} ${text}`);
    if (challengeUrl || challengeText || await challengeElement.count()) await fail(substage, `unexpected security check: ${heading || 'unknown heading'}`);
    return false;
  };

  await page.getByRole('button', { name: 'Continuer avec Google', exact: true }).click();
  try { await page.waitForURL((url) => url.hostname === 'accounts.google.com' || /\/dashboard/.test(url.pathname), { timeout: 30_000 }); }
  catch { await fail('account-choice', 'Google OAuth redirect did not reach accounts.google.com or the dashboard'); }
  if (/\/dashboard/.test(new URL(page.url()).pathname)) return;
  if (manualTimeout !== undefined) {
    stage('manual-consent');
    process.stdout.write(`MANUAL_CONSENT_WAITING_URL=${page.url()}\n`);
    const startedAt = Date.now();
    while (Date.now() - startedAt < manualTimeout) {
      const currentUrl = page.url();
      if (/\/dashboard/.test(new URL(currentUrl).pathname)) return;
      if (/\/signin\/(?:rejected|oauth\/error)(?:\/|\?|$)|\/challenge\//i.test(currentUrl)) await fail('manual-consent', 'Google manual consent reached an error page');
      await page.waitForTimeout(Math.min(3_000, manualTimeout - (Date.now() - startedAt)));
    }
    await fail('manual-consent', `manual consent timed out after ${manualTimeout / 1000}s`);
  }

  stage('account-choice');
  const account = page.locator('[role="link"], button').filter({ hasText: email }).first();
  if (await visible(account, 2_000)) await account.click();
  else {
    stage('identifier');
    const identifierUrl = /\/(?:v3\/signin|signin\/v2|signin\/oauth)\/identifier(?:\/|\?|$)/i.test(page.url());
    const identifier = page.locator('input[type="email"], input[name="identifier"]').first();
    if (!await visible(identifier, 15_000)) {
      await challenge('identifier');
      await fail('identifier', `Google account chooser showed neither the staging account nor an identifier field${identifierUrl ? ' on the identifier page' : ''}`);
    }
    await identifier.fill(email);
    await page.locator('#identifierNext').click();
  }

  stage('password');
  const passwordInput = page.locator('input[type="password"]').first();
  if (await visible(passwordInput, 15_000)) {
    await passwordInput.fill(password);
    await page.locator('#passwordNext').click();
  } else {
    await challenge('password');
    await fail('password', 'Google password field did not appear');
  }
  await page.waitForTimeout(1_000);
  await challenge('password');

  stage('consent-screen');
  for (let step = 0; step < 2 && !/\/dashboard/.test(new URL(page.url()).pathname); step += 1) {
    await challenge('consent-screen');
    const consent = page.getByRole('button', { name: /^(?:Continue|Allow|Continuer|Autoriser)$/i }).last();
    if (!await visible(consent, 5_000)) break;
    await consent.click();
    await page.waitForTimeout(500);
  }
  try { await page.waitForURL(/\/dashboard/, { timeout: 30_000 }); }
  catch { await fail('consent-screen', 'Google consent did not return to the dashboard'); }
}
function selectFixtures(items) {
  return fixtureNames.map((name) => exact(items, name, 'application/pdf'));
}
function selectFixturePlan(items) {
  const invoice = exact(items, fixtureNames[0], 'application/pdf');
  const exactName = items.filter(({ name }) => name === fixtureNames[1]);
  assert(exactName.every(({ mimeType }) => mimeType === 'application/pdf'), `Non-PDF provider item named ${fixtureNames[1]} is unsafe`);
  assert(exactName.length <= 1, `Expected zero or one provider item named ${fixtureNames[1]}`);
  return { invoice, review: exactName[0], reviewOriginallyAbsent: exactName.length === 0 };
}
function selectBorrowedCarrier(items, authorizedRootId) {
  const eligible = items.filter(({ name, mimeType, parents, trashed }) => name === fixtureNames[0]
    && mimeType === 'application/pdf' && trashed !== true && sameParents(parents, [authorizedRootId]));
  assert(eligible.length === 1, `Expected exactly one eligible authorized staging invoice PDF; observed ${eligible.length}`);
  return eligible[0];
}
function restorationVerified(snapshots, restored, replacements) {
  assert(snapshots.length >= 1 && snapshots.length <= 2 && restored.length === snapshots.length, 'Expected complete fixture restoration snapshots');
  assert(replacements.length === snapshots.length && snapshots.every((snapshot) => replacements.some((replacement) => replacement.id === snapshot.id && (replacement.bytes === undefined || !sameBytes(snapshot.bytes, replacement.bytes)))), 'Changed fixture proof is missing');
  return snapshots.every((snapshot) => {
    const current = restored.find((item) => item.id === snapshot.id);
    return current && current.name === snapshot.name && current.mimeType === snapshot.mimeType && current.trashed === snapshot.trashed
      && sameParents(current.parents, snapshot.parents) && sameBytes(current.bytes, snapshot.bytes);
  });
}

async function ensureApps() {
  await assertAppsAbsent([`${apiBase}/health`, `${webBase}/login`]);
  const python = path.join(root, 'apps/api-py/.venv/bin/python');
  const { KLASR_LLM_PROVIDER, KLASR_LLM_MODEL, KLASR_LLM_API_KEY, KLASR_STAGING_ACCOUNT_PASSWORD, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ...runtimeEnv } = process.env;
  const common = { ...runtimeEnv, ...(GOOGLE_CLIENT_ID && { GOOGLE_CLIENT_ID }), ...(GOOGLE_CLIENT_SECRET && { GOOGLE_CLIENT_SECRET }), NODE_ENV: 'test', KLASR_DATABASE_URL: databaseUrl, KLASR_MONGO_URL: mongoUrl, INTERNAL_API_SECRET: internalSecret, TOKEN_ENCRYPTION_KEY: tokenKey, KLASR_INLINE_WORKER: 'false', KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: String(authenticationMode === 'sa'), KLASR_GOOGLE_SERVICE_ACCOUNT_FILE: credentialPath, KLASR_GOOGLE_DRIVE_ROOT_ID: sharedRootId, KLASR_DRIVE_MUTATION_LOG: ignoreMutationLogPath };
  const migration = spawnSync(path.join(root, 'apps/api-py/.venv/bin/alembic'), ['upgrade', 'head'], { cwd: path.join(root, 'apps/api-py'), env: common, stdio: 'ignore' });
  assert(migration.status === 0, 'Alembic migration failed');
  children.push({ child: spawn(python, [path.join(root, 'scripts/live-google-api.py'), String(apiPort)], { cwd: root, detached: true, stdio: 'inherit', env: common }), url: `${apiBase}/health` });
  await waitReachable(`${apiBase}/health`);
  children.push({ child: spawn(python, ['src/worker.py'], { cwd: path.join(root, 'apps/api-py'), detached: true, stdio: 'inherit', env: { ...common, KLASR_WORKER: 'true' } }) });
  children.push({ child: spawn(process.execPath, [requireWeb.resolve('next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', String(webPort)], { cwd: path.join(root, 'apps/web'), detached: true, stdio: 'inherit', env: { ...common, NEXTAUTH_URL: webBase, NEXTAUTH_SECRET: nextAuthSecret, API_URL: apiBase, NEXT_PUBLIC_API_URL: apiBase, NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: String(authenticationMode === 'sa') } }), url: webBase });
  await waitReachable(`${webBase}/login`);
}
function assertPythonRuntime() {
  const version = spawnSync(path.join(root, 'apps/api-py/.venv/bin/python'), ['--version'], { encoding: 'utf8' });
  assert(version.status === 0 && /Python 3\.1[3-9]\./.test(version.stdout || version.stderr), 'apps/api-py/.venv must use Python 3.13+');
}
async function stopApps(owned) {
  for (const { child } of owned) signalTree(child, 'SIGTERM');
  if (await waitStopped(owned, 5_000)) return;
  for (const { child } of owned) signalTree(child, 'SIGKILL');
  assert(await waitStopped(owned, 5_000), 'Runner-owned app processes did not stop');
}
function signalTree(child, signal) { try { process.kill(-child.pid, signal); } catch { if (child.exitCode === null) child.kill(signal); } }
async function waitStopped(owned, timeout) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 100) {
    if (owned.every(({ child }) => (child.exitCode !== null || child.signalCode !== null) && !groupAlive(child.pid)) && !(await Promise.all(owned.filter(({ url }) => url).map(({ url }) => reachable(url)))).some(Boolean)) return true;
    await delay(100);
  }
  return false;
}
function groupAlive(pid) { try { process.kill(-pid, 0); return true; } catch { return false; } }
async function reachable(url) { try { return (await fetch(url)).ok; } catch { return false; } }
async function assertAppsAbsent(urls) { for (const url of urls) assert(!(await reachable(url)), `Pre-existing app is reachable at ${url}; refusing stale runtime evidence`); }
async function waitReachable(url) { for (let i = 0; i < 120; i += 1) { if (await reachable(url)) return; await delay(500); } throw new Error(`Loopback app did not start: ${new URL(url).pathname}`); }

async function lifecycleCheck() {
  const owned = [];
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  const server = `require('node:http').createServer((_, response) => response.end('ok')).listen(${port}, '127.0.0.1')`;
  const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(server)}], { stdio: 'ignore' }); setInterval(() => {}, 1000)`;
  owned.push({ child: spawn(process.execPath, ['-e', parent], { detached: true, stdio: 'ignore' }), url: `http://127.0.0.1:${port}` });
  await waitReachable(`http://127.0.0.1:${port}`);
  let ignored = false;
  try { await assertAppsAbsent([`http://127.0.0.1:${port}`]); } catch (error) { ignored = /Pre-existing app/.test(error.message); }
  assert(ignored, 'Pre-existing health endpoint was not ignored');
  await stopApps(owned);
  await assertAppsAbsent([`http://127.0.0.1:${port}`]);
}
async function tenantRecord() { for (let i = 0; i < 40; i += 1) { const tenant = db('tenant'); if (tenant) return tenant; await delay(250); } throw new Error('Acceptance tenant was not onboarded'); }
async function failedAnalysisDiagnostic() {
  if (!organizationId) return;
  try { return db('failed', organizationId, runStartedAt.toISOString()) ? 'stage=analysis reason=job_failed' : undefined; }
  catch { return undefined; }
}
function assertNoPriorTenantSettingCount(count) { assert(count === 0, 'Prior tenant setting cannot be safely restored without plaintext'); }
function selectEligibleAnthropicModel(models) { const eligible = models.filter((model) => /^claude-[a-z0-9-]+$/i.test(model)).sort(); assert(eligible.length, 'No eligible Anthropic model discovered'); return eligible.at(-1); }
async function resetTenantData(id) { db('reset', id); llmSetupEvents.push('reset'); }
async function cleanupTenant(id) { db('cleanup', id); }
async function configureLlmThroughUi(page) {
  assert(!process.env.KLASR_LLM_API_KEY.includes('\n'), 'LLM key must be a single environment value');
  await page.goto(`${webBase}/dashboard/settings`);
  await page.getByRole('radio', { name: 'Anthropic' }).check();
  await page.getByLabel('Clé API').fill(process.env.KLASR_LLM_API_KEY);
  await page.getByLabel('Modèle').fill(selectedLlmModel);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith('/api/llm-settings') && candidate.request().method() === 'PUT'),
    page.getByRole('button', { name: 'Valider et enregistrer' }).click(),
  ]);
  const saved = await response.json().catch(() => ({}));
  assert(response.ok() && saved.configured === true && saved.provider === llmProvider && saved.model === selectedLlmModel,
    `LLM settings PUT failed (${response.status()}): ${saved.error ?? 'invalid saved configuration'}`);
  await expect(page.getByRole('region', { name: 'Configuration active' })).toContainText(selectedLlmModel);
  llmSetupEvents.push('configure');
}
function db(...args) {
  const run = spawnSync(path.join(root, 'apps/api-py/.venv/bin/python'), [path.join(root, 'scripts/live-google-db.py'), ...args], { cwd: root, encoding: 'utf8', timeout: 30_000, env: { ...process.env, KLASR_DATABASE_URL: databaseUrl } });
  assert(run.status === 0, `Database probe failed: ${args[0]}`);
  return JSON.parse(run.stdout);
}
async function api(route, init = {}) { const response = await fetch(`${apiBase}${route}`, { ...init, headers: { 'x-internal-secret': internalSecret, 'content-type': 'application/json', ...(init.headers ?? {}) } }); assert(response.ok, `API request failed (${response.status})`); return response.json(); }
async function chooseBrowserItem(page, name, action, expectAnalysis = false) {
  if (action === "Lancer l'organisation") { llmSetupEvents.push('launch'); assertLlmSetupSequence(llmSetupEvents); }
  const submit = page.getByRole('button', { name: action });
  const browserPanel = submit.locator('..');
  await browserPanel.getByRole('list').waitFor({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  const row = browserPanel.getByRole('button', { name, exact: true }).locator('..');
  const radio = row.getByRole('radio');
  await row.getByText('Sélectionner', { exact: true }).click();
  await expect(radio).toBeChecked();
  await expect(submit).toBeEnabled();
  if (!expectAnalysis) { await submit.click(); return; }

  let launch = null;
  let lastConsole = null;
  let bodyRead;
  const onRequest = (request) => {
    if (new URL(request.url()).pathname.endsWith('/api/drive/launch')) launch = { method: request.method(), path: new URL(request.url()).pathname, startedAt: Date.now(), response: null };
  };
  const onResponse = (response) => {
    if (!response.url().includes('/api/drive/launch')) return;
    launch ??= { method: response.request().method(), path: new URL(response.url()).pathname, startedAt: Date.now(), response: null };
    launch.response = { status: response.status(), body: null, responseMs: Date.now() - launch.startedAt };
    bodyRead = response.text().then((body) => { launch.response.body = redact(body); }, () => undefined);
  };
  const onConsole = (message) => { if (['error', 'warning'].includes(message.type())) lastConsole = redact(message.text()); };
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('console', onConsole);
  try {
    await submit.click();
    await expect(page.getByRole('status')).toContainText('Analyse en cours');
  } catch (error) {
    await bodyRead;
    const alerts = await page.getByRole('alert').allTextContents().catch(() => []);
    const statuses = await page.getByRole('status').allTextContents().catch(() => []);
    error.launchFailureDetail = redact(`${String(error?.message ?? error).split(/\r?\n/)[0]} launch=${JSON.stringify(launch)} alerts=${JSON.stringify(alerts.map((text) => redact(text)))} statuses=${statuses.length}:${JSON.stringify(statuses.map((text) => redact(text)))} console=${JSON.stringify(lastConsole)} url=${page.url()}`)
      .replace(/\s+/g, ' ').trim().slice(0, 1500);
    throw error;
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('console', onConsole);
  }
}
async function waitForProposalCards(page, count) { await expect(page.locator('[data-testid^="proposal-"]')).toHaveCount(count, { timeout: 180_000 }); }
function proposalCardFor(page, documentName) { return page.locator('[data-testid^="proposal-"]').filter({ hasText: documentName }); }
function chooseDecisionFixtures(proposals) {
  assert(proposals.some(({ reviewRequired }) => reviewRequired), 'Expected at least one review-required proposal excluded from Tout valider');
  const confirm = proposals.find(({ reviewRequired, confirmEnabled, destination }) => !reviewRequired && confirmEnabled && destination === '/invoices');
  assert(confirm, 'Expected an enabled standard proposal for /invoices confirmation');
  const ignore = proposals.find(({ reviewRequired }) => reviewRequired);
  assert(ignore !== confirm, 'Expected a separate review-required proposal for ignore');
  return { confirm, ignore };
}
async function expectConfidenceBadge(card) {
  await expect(card.getByLabel(/^Confiance (?:100|[1-9]?\d) %, source (?:IA|règle)$/)).toBeVisible();
}
async function expectReviewRequiredProposal(card) {
  await expect(card.getByText('à vérifier', { exact: true })).toBeVisible();
  await expect(card.getByText(/exclue de Tout valider/)).toBeVisible();
}
async function displayedProposedName(card) { return (await card.getByText(/^→ /).textContent()).replace(/^→\s*/, '').trim(); }
async function displayedDestination(card) { return (await card.locator('p span.font-mono').last().textContent()).trim(); }
async function copyCookies(from, to) { await to.addCookies(await from.cookies()); }
