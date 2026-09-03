import { spawn } from 'node:child_process';
import { createHash, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { assertTreeBinding, currentTreeBinding, parseObservedRecord, resolveEvidenceRunDir } from './live-google-evidence.mjs';

const fixtureNames = ['CDA_Oct25_18mois_Calendrier.pdf', 'test2.pdf'];
const removedFolderName = 'À traiter manuellement';
const recoveryVersion = '1';
const failureStages = ['preflight', 'auth', 'recovery', 'listing', 'app-start', 'browser-launch', 'login-navigation', 'acceptance-login-session', 'dashboard-identity', 'tenant-lookup', 'drive-connection-readback', 'tenant-reset', 'anthropic-server-setup', 'settings-verification', 'dashboard-resume', 'drive-fixture-prepare', 'browser-source-selection', 'browser-input-enqueue', 'proposal-card-wait', 'launch-completion-ui', 'anthropic-provenance-db', 'ui-decisions-provider-metadata', 'correction-relaunch', 'settings-delete', 'cleanup-finalization'];
const failureOverrides = ['stage=analysis reason=job_failed', 'stage=ui-decisions-provider-metadata reason=ignore_metadata_changed', 'stage=ui-decisions-provider-metadata reason=legacy_folder_present'];

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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fatalLifecycleCheck = process.argv.includes('--fatal-lifecycle-check');
const isolatedLifecycleCheck = fatalLifecycleCheck || process.argv.includes('--preflight-lifecycle-check') || process.argv.includes('--evidence-self-check');
const evidenceRunId = process.env.KLASR_EVIDENCE_RUN_ID ?? `run-${Date.now()}`;
const evidenceDir = isolatedLifecycleCheck ? required('KLASR_FATAL_CHECK_DIR') : lineage.issue === 5
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
const item5ProofPath = lineage.issue === 5 ? path.join(evidenceDir, 'provider-proof.sanitized.json') : path.join(root, '.tmp/hermes/ux-clarity/evidence/item-5/provider-proof.sanitized.json');
mkdirSync(screenshotDir, { recursive: true });
mkdirSync(path.dirname(item3ScreenshotPath), { recursive: true });
mkdirSync(path.dirname(item5ProofPath), { recursive: true });

if (process.argv.includes('--evidence-self-check')) {
  const tree = { schema: 'klasr-tree-v1', mode: 'worktree', head: lineage.sha, digest: 'b'.repeat(64) };
  const observed = { schema: 'klasr-live-observed-v1', stage: 'settings-deleted', selectedModelId: 'claude-safe', modelCount: 2, modelUsed: 'anthropic/claude-safe', tree };
  const raw = {
    serviceAccountAuth: 'PASS', realDriveListing: 'PASS', realDriveDownloadOcr: 'PASS', realProposalReview: 'PASS',
    realDriveConfirmMutation: 'PASS', realDriveCorrectMutation: 'PASS', realDriveIgnoreNoMutation: 'PASS', terminalNoReenqueue: 'PASS',
    desktopBrowser: 'PASS', mobile390Browser: 'PASS', launchCompletion: 'PASS', freshProviderMetadata: 'PASS',
    anthropicDiscovery: 'PASS', anthropicSettingSaved: 'PASS', anthropicClassification: 'PASS', anthropicSettingRemoved: 'PASS',
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
  const item3 = sanitizedItem3Proof({ serviceAccountIdentity: 'service@example.test', grantedScopes: ['https://www.googleapis.com/auth/drive'], driveConnectionPresent: true, lastSyncAt: '2026-08-30T00:00:00.000Z', realSyncObserved: true, fileBrowserVisible: true }, evidenceTask, lineage, tree);
  assertItem3Proof(item3, evidenceTask, lineage, tree, true);
  for (const bad of [{ ...item3, task: 't_wrong' }, { ...item3, attempt: 2 }, { ...item3, sha: '1'.repeat(40) }, { ...item3, tree: { ...tree, digest: 'c'.repeat(64) } }, { ...item3, assertions: { ...item3.assertions, lastSyncAt: null } }]) assertThrows(() => assertItem3Proof(bad, evidenceTask, lineage, tree, true), 'Item 3 proof mismatch must fail closed');
  assert(complete.status === 'PASS' && incomplete.status === 'FAIL', 'Evidence self-check must fail incomplete runs');
  const markdown = realAcceptanceMarkdown(complete, evidenceTask, undefined);
  assert(markdown.includes(`Task: \`${evidenceTask}\``) && markdown.includes(`Attempt: \`${lineage.attempt}\``) && markdown.includes(`SHA: \`${lineage.sha}\``), 'REAL_ACCEPTANCE lineage must use current runner inputs');
  for (const key of ['anthropicDiscovery', 'anthropicSettingSaved', 'anthropicClassification', 'anthropicSettingRemoved']) {
    assert(sanitizedManifest({ ...raw, [key]: 'FAIL' }, proof, lineage, tree, observed, true).status === 'FAIL', `${key} must bind manifest PASS`);
  }
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

const requireApi = createRequire(path.join(root, 'apps/api/package.json'));
const requireWeb = createRequire(path.join(root, 'apps/web/package.json'));
const { PrismaClient } = requireApi('@prisma/client');
const { chromium, expect } = requireWeb('@playwright/test');

let credentialPath;
let sharedRootId;
const apiPort = Number(process.env.KLASR_LIVE_API_PORT ?? 3201);
const webPort = Number(process.env.KLASR_LIVE_WEB_PORT ?? 4201);
const apiBase = loopback(process.env.KLASR_LIVE_API_URL ?? `http://127.0.0.1:${apiPort}/api/v1`);
const webBase = loopback(process.env.KLASR_LIVE_WEB_URL ?? `http://127.0.0.1:${webPort}`);
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/klasr';
const mongoUrl = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017';
const internalSecret = process.env.KLASR_LIVE_INTERNAL_SECRET ?? 'google-sa-live-internal';
const nextAuthSecret = process.env.KLASR_LIVE_NEXTAUTH_SECRET ?? 'google-sa-live-nextauth';
const tokenKey = process.env.TOKEN_ENCRYPTION_KEY ?? 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const email = 'google-staging-acceptance@klasr.test';
const runName = `klasr-sa-${Date.now()}`;
const runStartedAt = new Date();
const initialTreeBinding = currentTreeBinding(root);
assert(initialTreeBinding.head === lineage.sha, 'Evidence lineage does not match current HEAD');
const createdIds = [];
const fixtureSnapshots = [];
const observedReplacements = new Map();
const children = [];
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const evidence = {
  identity: 'Google service account (non-production acceptance; not end-user OAuth consent)',
  serviceAccountAuth: 'FAIL', realDriveListing: 'FAIL', realDriveDownloadOcr: 'FAIL',
  realProposalReview: 'FAIL', realDriveConfirmMutation: 'FAIL', realDriveCorrectMutation: 'FAIL',
  realDriveIgnoreNoMutation: 'FAIL', terminalNoReenqueue: 'FAIL', desktopBrowser: 'FAIL',
  mobile390Browser: 'FAIL', launchCompletion: 'FAIL', freshProviderMetadata: 'FAIL',
  anthropicDiscovery: 'FAIL', anthropicSettingSaved: 'FAIL', anthropicClassification: 'FAIL', anthropicSettingRemoved: 'FAIL', cleanup: 'FAIL',
};
let anthropicKey;
let selectedAnthropicModel;
let discoveredAnthropicModelCount = 0;
let observedModelUsed;
let accessToken;
let browser;
let organizationId;
let runCompleted = false;
const replacementAttempted = new Set();
const replacementVerified = new Set();
const cleanup = { fixtureRestored: false, legacyFolderRestored: false, createdItemsRemoved: false, tenantCleaned: false, appsStopped: false, noOrphans: false };
let legacyFolderSnapshot;
let ignoreMutationCount;
let ignoreWindowOpen = false;
const item4Proof = { oneLegacyFolderQuarantined: false, quarantinedOutsideReference: false, absentDuringAcceptance: false, ignoredNameIdentical: false, ignoredParentsIdentical: false, ignoreFilesUpdateOrMoveCount: null, setupOutsideIgnoreWindow: false, restorationOutsideIgnoreWindow: false, restoredNameExact: false, restoredParentsExact: false, freshRestorationReadback: false };
const item3Proof = { serviceAccountIdentity: null, grantedScopes: [], driveConnectionPresent: false, lastSyncAt: null, realSyncObserved: false, fileBrowserVisible: false };
const item5Proof = { originalExactNameCount: null, originalPdfCount: null, borrowedCarrierIdStable: false, borrowedCarrierSnapshotted: false, recoveryMarkerVerified: false, originalBytesRetained: false, anthropicProvenance: false, noDestinationMatch: false, notExtractionFailed: false, overlayReasonVisible: false, overlayNameEdited: false, overlayDestinationEdited: false, noMutationBeforeValidation: false, createdRunnerOwned: false, createdInAuthorizedRoot: false, headedBrowser: false, overlayVisible: false, explicitValidateClicked: false, correctedNameExact: false, correctedParentExact: false, browserKpiUpdated: false, postValidationScreenshot: false, exactRestorationVerified: false, recoveryMarkerCleared: false, createdFixtureTrashed: false, finalExactNameCount: null, finalPdfCount: null };
let syntheticReviewFixtureId;
let syncBaseline;
let restorationFlight;
let finalizationFlight;
let normalCleanupDone = false;
let failureStage = 'preflight';
let failureStageAtFailure;
let failureDiagnostic;
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
  const missing = ['KLASR_LIVE_ANTHROPIC_API_KEY', 'KLASR_GOOGLE_SERVICE_ACCOUNT_FILE', 'KLASR_GOOGLE_DRIVE_ROOT_ID'].filter((name) => !process.env[name]);
  if (missing.length) { acceptanceBlocked = true; throw new Error(`Missing ${missing.join(', ')}`); }
  anthropicKey = required('KLASR_LIVE_ANTHROPIC_API_KEY');
  credentialPath = required('KLASR_GOOGLE_SERVICE_ACCOUNT_FILE');
  sharedRootId = required('KLASR_GOOGLE_DRIVE_ROOT_ID');
  failureStage = 'auth';
  accessToken = await serviceAccountToken();
  item3Proof.grantedScopes = await providerTokenInfo();
  item3Proof.serviceAccountIdentity = await providerDriveIdentity();
  evidence.serviceAccountAuth = 'PASS';
  failureStage = 'recovery';
  await recoverMarkedFixtures();
  await recoverLegacyFolder();
  failureStage = 'listing';
  const rootItems = await listChildren(sharedRootId);
  const fixturePlan = lineage.issue === 5 ? undefined : selectFixturePlan(rootItems);
  item5Proof.originalExactNameCount = rootItems.filter(({ name }) => name === fixtureNames[1]).length;
  item5Proof.originalPdfCount = rootItems.filter(({ name, mimeType }) => name === fixtureNames[1] && mimeType === 'application/pdf').length;
  const reference = exact(rootItems, 'stg_tree', 'application/vnd.google-apps.folder');
  const destinations = Object.fromEntries(await Promise.all(['invoices', 'meetings', 'quotes'].map(async (name) => {
    const item = exact(await listChildren(reference.id), name, 'application/vnd.google-apps.folder');
    return [name, item];
  })));
  let reviewFixture = fixturePlan?.review;
  if (lineage.issue !== 5 && !reviewFixture) {
    reviewFixture = await createRunnerOwnedPdf(fixtureNames[1], sharedRootId, reviewRequiredPdf());
    syntheticReviewFixtureId = reviewFixture.id;
    item5Proof.createdRunnerOwned = true;
    item5Proof.createdInAuthorizedRoot = sameParents(reviewFixture.parents, [sharedRootId]);
  }
  const supplied = lineage.issue === 5 ? undefined : [fixturePlan.invoice, reviewFixture];
  if (lineage.issue !== 5) await quarantineLegacyFolder(reference.id);
  evidence.realDriveListing = 'PASS';

  // fixtureNames order is contractual: invoice drives OCR/confirm; review drives extraction failure/ignore/correct.
  const [invoiceFixture] = supplied ?? [];
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
  await page.getByRole('button', { name: 'Validation Google staging' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  failureStage = 'dashboard-identity';
  await page.getByText('Validation staging · identité de service Google').waitFor();
  failureStage = 'tenant-lookup';
  organizationId = await tenantId();
  failureStage = 'drive-connection-readback';
  const connectionBeforeSync = await prisma.driveConnection.findFirst({ where: { organizationId, user: { email } }, select: { id: true, lastSyncAt: true } });
  assert(connectionBeforeSync, 'Acceptance user DriveConnection read-back is missing');
  item3Proof.driveConnectionPresent = true;
  syncBaseline = connectionBeforeSync.lastSyncAt;
  failureStage = 'tenant-reset';
  await assertNoPriorTenantSetting(organizationId);
  await resetTenantData(organizationId);
  assert(await prisma.classificationRule.count({ where: { organizationId } }) === 0, 'Acceptance tenant must have zero rules');
  failureStage = 'anthropic-server-setup';
  ({ model: selectedAnthropicModel, modelCount: discoveredAnthropicModelCount } = await configureAnthropicServerSide(context, anthropicKey));
  evidence.anthropicDiscovery = 'PASS';
  evidence.anthropicSettingSaved = 'PASS';
  failureStage = 'settings-verification';
  await page.getByRole('link', { name: 'Paramètres IA' }).click();
  await page.waitForURL(/\/dashboard\/settings/);
  await expect(page.getByText(`Anthropic · ${selectedAnthropicModel}`)).toBeVisible();
  await expect(page.getByLabel('Clé API')).toHaveValue('');
  failureStage = 'dashboard-resume';
  await page.getByRole('link', { name: 'Tableau de bord' }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
  await page.getByText('Validation staging · identité de service Google').waitFor();
  await page.getByRole('button', { name: 'Choisir ce dossier' }).waitFor();

  if (lineage.issue === 5) {
    failureStage = 'drive-fixture-prepare';
    const carrier = selectBorrowedCarrier(rootItems, sharedRootId);
    const snapshot = { ...await metadata(carrier.id), bytes: await downloadBytes(carrier.id), recoveryScope: 'invoice' };
    assert(existingFixturePdf(snapshot.bytes), 'Borrowed carrier bytes are not an eligible PDF');
    fixtureSnapshots.push(snapshot);
    item5Proof.borrowedCarrierSnapshotted = snapshot.name === carrier.name
      && snapshot.mimeType === carrier.mimeType && sameParents(snapshot.parents, carrier.parents);
    const revisionId = await pinOriginalRevision(carrier, snapshot.bytes);
    await markRecovery(carrier.id, revisionId, 'invoice');
    item5Proof.recoveryMarkerVerified = recoveryMarker(await metadata(carrier.id), 'invoice') === revisionId;
    await restoreMetadata(carrier.id, { ...snapshot, name: fixtureNames[1], parents: [sharedRootId], trashed: false });
    item5Proof.originalBytesRetained = sameBytes(snapshot.bytes, await downloadBytes(carrier.id));
    assert(item5Proof.originalBytesRetained, 'Borrowed carrier bytes changed during metadata-only preparation');
    item5Proof.borrowedCarrierIdStable = (await metadata(carrier.id)).id === snapshot.id;

    failureStage = 'browser-source-selection';
    await chooseBrowserItem(page, 'stg_tree', 'Choisir ce dossier');
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    for (const name of ['invoices', 'meetings', 'quotes']) await page.getByText(new RegExp(`/${name}$`)).waitFor();
    const connectionAfterSync = await prisma.driveConnection.findFirst({ where: { organizationId, user: { email } }, select: { lastSyncAt: true } });
    assert(connectionAfterSync?.lastSyncAt && connectionAfterSync.lastSyncAt >= runStartedAt && (!syncBaseline || connectionAfterSync.lastSyncAt > syncBaseline), 'DriveConnection lastSyncAt was not caused by this real sync');
    item3Proof.lastSyncAt = connectionAfterSync.lastSyncAt.toISOString();
    item3Proof.realSyncObserved = true;
    item3Proof.fileBrowserVisible = true;
    failureStage = 'browser-input-enqueue';
    await chooseBrowserItem(page, fixtureNames[1], "Lancer l'organisation", true);
    failureStage = 'proposal-card-wait';
    await waitForProposalCards(page, 1);
    failureStage = 'launch-completion-ui';
    await expect(page.getByText('Analyse en cours', { exact: true })).toHaveCount(0);
    evidence.launchCompletion = 'PASS';
    const directCard = proposalCardFor(page, fixtureNames[1]);
    await expectReviewRequiredProposal(directCard);
    const liveProposal = await prisma.classificationProposal.findFirst({
      where: { organizationId, document: { externalId: carrier.id } },
      orderBy: { createdAt: 'desc' },
      select: { modelUsed: true, reviewReason: true },
    });
    item5Proof.anthropicProvenance = Boolean(liveProposal?.modelUsed?.includes(`anthropic/${selectedAnthropicModel}`));
    item5Proof.noDestinationMatch = liveProposal?.reviewReason === 'no_destination_match';
    item5Proof.notExtractionFailed = liveProposal?.reviewReason !== 'extraction_failed';
    assert(item5Proof.anthropicProvenance, 'Current Item 5 proposal lacks Anthropic provenance');
    assert(item5Proof.noDestinationMatch && item5Proof.notExtractionFailed, 'Current Item 5 proposal is not review-required for no_destination_match');
    observedModelUsed = liveProposal.modelUsed;
    evidence.anthropicClassification = 'PASS';
    evidence.realDriveDownloadOcr = 'PASS';
    evidence.realProposalReview = 'PASS';
    failureStage = 'ui-decisions-provider-metadata';
    await directCard.getByRole('button', { name: 'Corriger', exact: true }).click();
    const correctionDialog = page.getByRole('dialog', { name: 'Éditer la proposition' });
    await expect(correctionDialog).toBeVisible();
    item5Proof.overlayVisible = true;
    await expect(correctionDialog).toContainText('no_destination_match');
    item5Proof.overlayReasonVisible = true;
    await page.screenshot({ path: path.join(screenshotDir, 'live-google-sa-item-5-overlay-1280.png'), fullPage: true });
    const correctedName = `Document_Corrige${path.extname(fixtureNames[1])}`;
    await correctionDialog.getByLabel('Nom du fichier proposé').fill(correctedName);
    item5Proof.overlayNameEdited = await correctionDialog.getByLabel('Nom du fichier proposé').inputValue() === correctedName;
    await correctionDialog.getByLabel('Dossier de destination').selectOption(destinations.meetings.id);
    item5Proof.overlayDestinationEdited = await correctionDialog.getByLabel('Dossier de destination').inputValue() === destinations.meetings.id;
    const beforeValidation = await metadata(carrier.id);
    item5Proof.noMutationBeforeValidation = beforeValidation.name === fixtureNames[1]
      && sameParents(beforeValidation.parents, [sharedRootId])
      && sameBytes(await downloadBytes(carrier.id), snapshot.bytes);
    assert(item5Proof.noMutationBeforeValidation, 'Provider changed before explicit validation');
    await correctionDialog.getByRole('button', { name: 'Valider', exact: true }).click();
    item5Proof.explicitValidateClicked = true;
    await expect(directCard).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Historique' })).toBeVisible();
    const correctedMeta = await metadata(carrier.id);
    item5Proof.correctedNameExact = correctedMeta.name === correctedName;
    item5Proof.correctedParentExact = sameParents(correctedMeta.parents, [destinations.meetings.id]);
    assert(item5Proof.correctedNameExact && item5Proof.correctedParentExact, 'Direct correction metadata mismatch');
    evidence.realDriveCorrectMutation = 'PASS';
    evidence.realDriveConfirmMutation = 'PASS';
    evidence.realDriveIgnoreNoMutation = 'PASS';
    evidence.freshProviderMetadata = 'PASS';
    await expect(page.getByText('Classés', { exact: true }).locator('..').getByText('1', { exact: true })).toBeVisible();
    item5Proof.browserKpiUpdated = true;
    await page.screenshot({ path: path.join(screenshotDir, 'live-google-sa-item-5-post-validation-1280.png'), fullPage: true });
    item5Proof.postValidationScreenshot = true;
    const directRelaunch = await api(`/organizations/${organizationId}/drive/launch`, { method: 'POST', body: JSON.stringify({ itemExternalId: carrier.id }) });
    assert(directRelaunch.enqueued === 0, 'Terminal corrected carrier was re-enqueued');
    evidence.desktopBrowser = 'PASS';
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobilePage = await mobile.newPage();
    await copyCookies(context, mobile);
    await mobilePage.goto(`${webBase}/dashboard`);
    await mobilePage.getByRole('region', { name: 'Historique' }).waitFor();
    await mobilePage.screenshot({ path: path.join(screenshotDir, 'live-google-sa-item-5-mobile-390.png'), fullPage: true });
    await mobile.close();
    evidence.mobile390Browser = 'PASS';
    evidence.terminalNoReenqueue = 'PASS';
  } else {
  failureStage = 'drive-fixture-prepare';
  const inputFolder = await createFolder(runName, sharedRootId);
  createdIds.push(inputFolder.id);
  for (const [index, item] of supplied.entries()) {
    if (item.id !== syntheticReviewFixtureId) fixtureSnapshots.push({ ...await metadata(item.id), bytes: await downloadBytes(item.id), recoveryScope: index === 0 ? 'invoice' : 'manual' });
  }
  assert(fixtureSnapshots.length >= 1 && fixtureSnapshots.length <= 2 && fixtureSnapshots.every(({ bytes }) => existingFixturePdf(bytes)), 'Existing PDF fixtures must be snapshotted');
  const replacementBytes = syntheticInvoicePdf(runName);
  const reviewBytes = reviewRequiredPdf();
  assert(isPdf(replacementBytes) && isPdf(reviewBytes), 'Generated replacements must be PDF-marked');
  const invoiceSnapshot = fixtureSnapshots.find(({ id }) => id === invoiceFixture.id);
  const invoiceRevision = await pinOriginalRevision(invoiceFixture, invoiceSnapshot.bytes);
  await markRecovery(invoiceFixture.id, invoiceRevision, 'invoice');
  await restoreMetadata(invoiceFixture.id, { ...invoiceSnapshot, parents: [inputFolder.id] });
  replacementAttempted.add(invoiceFixture.id);
  await replaceBytes(invoiceFixture.id, replacementBytes);
  observedReplacements.set(invoiceFixture.id, await downloadBytes(invoiceFixture.id));
  assert(!sameBytes(invoiceSnapshot.bytes, observedReplacements.get(invoiceFixture.id)), 'Temporary fixture replacement did not change provider bytes');
  replacementVerified.add(invoiceFixture.id);
  if (reviewFixture.id === syntheticReviewFixtureId) {
    await restoreMetadata(reviewFixture.id, { ...reviewFixture, name: fixtureNames[1], parents: [inputFolder.id], trashed: false });
  } else {
    const manualSnapshot = fixtureSnapshots.find(({ id }) => id === reviewFixture.id);
    const manualRevision = await pinOriginalRevision(reviewFixture, manualSnapshot.bytes);
    await markRecovery(reviewFixture.id, manualRevision, 'manual');
    await restoreMetadata(reviewFixture.id, { ...manualSnapshot, parents: [inputFolder.id] });
    replacementAttempted.add(reviewFixture.id);
    await replaceBytes(reviewFixture.id, reviewBytes);
    observedReplacements.set(reviewFixture.id, await downloadBytes(reviewFixture.id));
    assert(!sameBytes(manualSnapshot.bytes, observedReplacements.get(reviewFixture.id)), 'Temporary manual fixture replacement did not change provider bytes');
    replacementVerified.add(reviewFixture.id);
  }

  failureStage = 'browser-source-selection';
  await chooseBrowserItem(page, 'stg_tree', 'Choisir ce dossier');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  for (const name of ['invoices', 'meetings', 'quotes']) await page.getByText(new RegExp(`/${name}$`)).waitFor();
  item3Proof.fileBrowserVisible = true;
  const connectionAfterSync = await prisma.driveConnection.findFirst({ where: { organizationId, user: { email } }, select: { lastSyncAt: true } });
  assert(connectionAfterSync?.lastSyncAt && connectionAfterSync.lastSyncAt >= runStartedAt && (!syncBaseline || connectionAfterSync.lastSyncAt > syncBaseline), 'DriveConnection lastSyncAt was not caused by this real sync');
  item3Proof.lastSyncAt = connectionAfterSync.lastSyncAt.toISOString();
  item3Proof.realSyncObserved = true;
  await expect(page.getByText(/Dernière synchronisation :/)).toBeVisible();
  await expect(page.getByAltText('Google Drive')).toBeVisible();
  await page.screenshot({ path: item3ScreenshotPath, fullPage: true });
  failureStage = 'browser-input-enqueue';
  await chooseBrowserItem(page, runName, "Lancer l'organisation", true);
  failureStage = 'proposal-card-wait';
  await waitForProposalCards(page, 2);
  failureStage = 'launch-completion-ui';
  await expect(page.getByText('Analyse en cours', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: "Lancer l'organisation" })).toBeEnabled();
  evidence.launchCompletion = 'PASS';
  failureStage = 'anthropic-provenance-db';
  const anthropicProof = await prisma.classificationProposal.findFirst({ where: { organizationId, modelUsed: { contains: `anthropic/${selectedAnthropicModel}` } }, select: { modelUsed: true } });
  assert(anthropicProof, 'Anthropic provider/model provenance is missing');
  observedModelUsed = anthropicProof.modelUsed;
  evidence.anthropicClassification = 'PASS';
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
  evidence.realDriveDownloadOcr = 'PASS';
  evidence.realProposalReview = 'PASS';
  await page.screenshot({ path: path.join(screenshotDir, 'live-google-sa-desktop-review.png'), fullPage: true });
  evidence.desktopBrowser = 'PASS';

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await copyCookies(context, mobile);
  await mobilePage.goto(`${webBase}/dashboard`);
  await mobilePage.getByText('Validation staging · identité de service Google').waitFor();
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
  assert(await prisma.document.count({ where: { organizationId, status: { in: ['CLASSIFIED', 'IGNORED'] } } }) === 2, 'UI decisions did not persist terminal document states');

  await page.screenshot({ path: path.join(screenshotDir, 'live-google-sa-desktop-final.png'), fullPage: true });
  const finalMobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const finalMobilePage = await finalMobile.newPage();
  await copyCookies(context, finalMobile);
  await finalMobilePage.goto(`${webBase}/dashboard`);
  await finalMobilePage.getByRole('region', { name: 'Historique' }).waitFor();
  await finalMobilePage.screenshot({ path: path.join(screenshotDir, 'live-google-sa-mobile-390-final.png'), fullPage: true });
  await finalMobile.close();

  const relaunch = await api(`/organizations/${organizationId}/drive/launch`, {
    method: 'POST', body: JSON.stringify({ itemExternalId: inputFolder.id }),
  });
  assert(relaunch.enqueued === 0, 'terminal documents were re-enqueued');


  failureStage = 'correction-relaunch';
  await restoreFixtures(false);
  if (reviewFixture.id === syntheticReviewFixtureId) await restoreMetadata(reviewFixture.id, { ...reviewFixture, name: fixtureNames[1], parents: [sharedRootId], trashed: false });
  await resetTenantData(organizationId);
  assert(await prisma.classificationRule.count({ where: { organizationId } }) === 0, 'Correction run must have zero rules');
  await page.goto(`${webBase}/dashboard`);
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
  await expect(correctionDialog).toContainText('no_destination_match');
  await page.screenshot({ path: path.join(screenshotDir, 'live-google-sa-item-5-overlay-1280.png'), fullPage: true });
  const correctedName = `Document_Corrige${path.extname(correctionFixture.name)}`;
  await correctionDialog.getByLabel('Nom du fichier proposé').fill(correctedName);
  await correctionDialog.getByLabel('Dossier de destination').selectOption(destinations.meetings.id);
  await correctionDialog.getByRole('button', { name: 'Valider', exact: true }).click();
  item5Proof.explicitValidateClicked = true;
  await expect(directCard).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Historique' })).toBeVisible();
  const correctedMeta = await metadata(correctionFixture.id);
  assert(correctedMeta.name === correctedName && sameParents(correctedMeta.parents, [destinations.meetings.id]), 'direct correction metadata mismatch');
  item5Proof.correctedNameExact = correctedMeta.name === correctedName;
  item5Proof.correctedParentExact = sameParents(correctedMeta.parents, [destinations.meetings.id]);
  evidence.realDriveCorrectMutation = 'PASS';
  assert(await prisma.document.count({ where: { organizationId, status: 'CLASSIFIED' } }) === 1, 'UI correction did not persist classified state');
  await expect(page.getByText('Classés', { exact: true }).locator('..').getByText('1', { exact: true })).toBeVisible();
  item5Proof.browserKpiUpdated = true;
  const directRelaunch = await api(`/organizations/${organizationId}/drive/launch`, { method: 'POST', body: JSON.stringify({ itemExternalId: correctionFixture.id }) });
  assert(directRelaunch.enqueued === 0, 'terminal direct file was re-enqueued');
  evidence.terminalNoReenqueue = 'PASS';
  }
  failureStage = 'settings-delete';
  await page.getByRole('link', { name: 'Paramètres IA' }).click();
  await page.waitForURL(/\/dashboard\/settings/);
  await page.getByRole('button', { name: 'Supprimer la configuration' }).click();
  await expect(page.getByRole('status')).toContainText('Configuration supprimée');
  assert(await prisma.llmSetting.count({ where: { organizationId } }) === 0, 'tenant_setting_absent');
  evidence.anthropicSettingRemoved = 'PASS';
  if (lineage.issue !== 5) writeFileSync(observedPath, `${JSON.stringify({ schema: 'klasr-live-observed-v1', stage: 'settings-deleted', selectedModelId: selectedAnthropicModel, modelCount: discoveredAnthropicModelCount, modelUsed: observedModelUsed, tree: initialTreeBinding })}\n`, { mode: 0o600 });
  runCompleted = true;
} catch (error) {
  failureStageAtFailure = failureStage;
  failureDiagnostic = await failedAnalysisDiagnostic().catch(() => undefined);
  failureDiagnostic ??= safeFailureReason(error);
  process.exitCode = 1;
} finally {
  await finalize().catch(() => {
    failureDiagnostic = 'stage=cleanup-finalization';
    process.exitCode = 1;
  });
  if (failureStageAtFailure) process.stderr.write(`root failure: ${failureDiagnostic ?? `stage=${failureStageAtFailure}`}\n`);
}

if (Object.entries(evidence).some(([key, value]) => key !== 'identity' && typeof value === 'string' && value !== 'PASS')) process.exitCode = 1;

function required(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
function safeFailureReason(error) {
  if (failureStage === 'listing') {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'stage=listing reason=provider_timeout';
    const provider = /^Google Drive request failed \((\d{3}), ([a-zA-Z0-9_-]+)\)$/.exec(error?.message ?? '');
    if (provider) return `stage=listing reason=provider_${provider[1]}_${provider[2]}`;
    if (error?.message === 'Runner-owned fixture creation readback failed') return 'stage=listing reason=fixture_creation_readback_failed';
    if (error?.message === 'Runner-owned fixture bytes must be a deterministic PDF') return 'stage=listing reason=fixture_pdf_invalid';
  }
  if (failureStage !== 'ui-decisions-provider-metadata') return undefined;
  if (error?.message === 'Ignore changed provider name or parents') return 'stage=ui-decisions-provider-metadata reason=ignore_metadata_changed';
  if (error?.message === 'Removed routing folder exists after ignore') return 'stage=ui-decisions-provider-metadata reason=legacy_folder_present';
}
function finalize() {
  return finalizationFlight ??= (async () => {
    failureDiagnostic ??= await failedAnalysisDiagnostic().catch(() => undefined);
    failureStage = 'cleanup-finalization';
    if (browser) await browser.close().catch(() => undefined);
    cleanup.fixtureRestored = await restoreFixtures().then(() => true, () => false);
    if (lineage.issue === 5 && fixtureSnapshots.length === 1) {
      const restoredCarrier = await metadata(fixtureSnapshots[0].id).catch(() => undefined);
      item5Proof.exactRestorationVerified = Boolean(restoredCarrier && await fixtureMatches(fixtureSnapshots[0]));
      item5Proof.recoveryMarkerCleared = Boolean(restoredCarrier && !recoveryMarker(restoredCarrier, 'invoice'));
    }
    cleanup.legacyFolderRestored = await restoreLegacyFolder();
    cleanup.fixtureRestored &&= cleanup.legacyFolderRestored;
    for (const id of [...createdIds].reverse()) await trash(id).catch(() => undefined);
    cleanup.createdItemsRemoved = await createdGone().catch(() => false);
    if (accessToken && sharedRootId) {
      const finalRootItems = await listChildren(sharedRootId).catch(() => []);
      item5Proof.createdFixtureTrashed = !syntheticReviewFixtureId || !finalRootItems.some(({ id }) => id === syntheticReviewFixtureId);
      item5Proof.finalExactNameCount = finalRootItems.filter(({ name }) => name === fixtureNames[1]).length;
      item5Proof.finalPdfCount = finalRootItems.filter(({ name, mimeType }) => name === fixtureNames[1] && mimeType === 'application/pdf').length;
    }
    cleanup.tenantCleaned = organizationId ? await cleanupTenant(organizationId).then(() => true, () => false) : true;
    evidence.cleanup = await cleanupVerified().catch(() => false) ? 'PASS' : 'FAIL';
    cleanup.appsStopped = await stopApps(children).then(() => true, () => false);
    cleanup.noOrphans = children.every(({ child }) => !groupAlive(child.pid))
      && !(await Promise.all([reachable(`${apiBase}/health`), reachable(webBase)])).some(Boolean);
    await prisma.$disconnect().catch(() => { process.exitCode = 1; });
    accessToken = undefined;
    const finalTreeBinding = currentTreeBinding(root);
    assertTreeBinding(initialTreeBinding, finalTreeBinding);
    if (lineage.issue !== 5) {
      const sanitizedItem4 = sanitizedItem4Proof(item4Proof, evidenceTask, lineage, finalTreeBinding);
      assertItem4Proof(sanitizedItem4, evidenceTask, lineage, finalTreeBinding, runCompleted);
      writeFileSync(item4ProofPath, `${JSON.stringify(sanitizedItem4, null, 2)}\n`, { mode: 0o600 });
      const sanitizedItem3 = sanitizedItem3Proof(item3Proof, evidenceTask, lineage, finalTreeBinding);
      assertItem3Proof(sanitizedItem3, evidenceTask, lineage, finalTreeBinding, runCompleted);
      writeFileSync(item3ProofPath, `${JSON.stringify(sanitizedItem3, null, 2)}\n`, { mode: 0o600 });
    }
    const sanitizedItem5 = sanitizedItem5Proof(item5Proof, evidenceTask, lineage, finalTreeBinding);
    assertItem5Proof(sanitizedItem5, evidenceTask, lineage, finalTreeBinding, runCompleted);
    writeFileSync(item5ProofPath, `${JSON.stringify(sanitizedItem5, null, 2)}\n`, { mode: 0o600 });
    const observed = runCompleted && lineage.issue !== 5 ? parseObservedRecord(readFileSync(observedPath, 'utf8'), finalTreeBinding) : undefined;
    const manifest = sanitizedManifest(evidence, cleanup, lineage, finalTreeBinding, observed, runCompleted, item5Proof);
    assertManifest(manifest);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    writeFileSync(realAcceptancePath, realAcceptanceMarkdown(manifest, evidenceTask, selectedAnthropicModel), { mode: 0o600 });
    normalCleanupDone = true;
    if (manifest.status !== 'PASS' || !cleanup.appsStopped) process.exitCode = 1;
  })();
}
function realAcceptanceMarkdown(manifest, task, model) {
  const live = manifest.status === 'PASS' ? 'PASS' : acceptanceBlocked ? 'BLOCKED' : 'FAIL';
  return `# Real BYOK acceptance\n\n- Task: \`${task}\`\n- Attempt: \`${manifest.attempt}\`\n- SHA: \`${manifest.sha}\`\n- Fake/browser fixture evidence: separate deterministic acceptance; never promoted to live-provider PASS.\n- Genuine Anthropic + Google browser: **${live}**\n- Provider metadata: \`${model ? `anthropic/${model}` : 'not-recorded'}\`\n- Cleanup: **${manifest.cleanup.fixture_restored && manifest.cleanup.created_items_removed && manifest.cleanup.tenant_cleaned && manifest.processes.apps_stopped && manifest.processes.no_orphans ? 'PASS' : 'FAIL'}**\n`;
}
function sanitizedManifest(raw, proof, manifestLineage, tree, observed, completed, item5Assertions) {
  const results = {
    anthropic_discovery: raw.anthropicDiscovery === 'PASS', anthropic_setting_saved: raw.anthropicSettingSaved === 'PASS',
    anthropic_classification: raw.anthropicClassification === 'PASS', anthropic_setting_removed: raw.anthropicSettingRemoved === 'PASS',
    service_account_auth: raw.serviceAccountAuth === 'PASS', drive_listing: raw.realDriveListing === 'PASS',
    drive_download_ocr: raw.realDriveDownloadOcr === 'PASS', proposal_review: raw.realProposalReview === 'PASS',
    confirm_mutation: raw.realDriveConfirmMutation === 'PASS', correction_mutation: raw.realDriveCorrectMutation === 'PASS',
    reject_mutation: raw.realDriveIgnoreNoMutation === 'PASS', terminal_no_reenqueue: raw.terminalNoReenqueue === 'PASS',
    desktop_browser: raw.desktopBrowser === 'PASS', mobile_390_browser: raw.mobile390Browser === 'PASS',
    launch_completion: raw.launchCompletion === 'PASS', fresh_provider_metadata: raw.freshProviderMetadata === 'PASS',
  };
  const cleanupResult = { fixture_restored: proof.fixtureRestored, created_items_removed: proof.createdItemsRemoved, tenant_cleaned: proof.tenantCleaned };
  const processes = { apps_stopped: proof.appsStopped, no_orphans: proof.noOrphans };
  const item5Required = ['anthropicProvenance', 'borrowedCarrierIdStable', 'borrowedCarrierSnapshotted', 'browserKpiUpdated', 'correctedNameExact', 'correctedParentExact', 'createdFixtureTrashed', 'exactRestorationVerified', 'explicitValidateClicked', 'headedBrowser', 'noDestinationMatch', 'noMutationBeforeValidation', 'notExtractionFailed', 'originalBytesRetained', 'overlayDestinationEdited', 'overlayNameEdited', 'overlayReasonVisible', 'overlayVisible', 'postValidationScreenshot', 'recoveryMarkerCleared', 'recoveryMarkerVerified'];
  const item5Passed = manifestLineage.issue === 5 && completed && item5Assertions
    && item5Assertions.originalExactNameCount === 0 && item5Assertions.originalPdfCount === 0
    && item5Assertions.finalExactNameCount === 0 && item5Assertions.finalPdfCount === 0
    && item5Assertions.createdRunnerOwned === false && item5Assertions.createdInAuthorizedRoot === false
    && item5Required.every((key) => item5Assertions[key] === true)
    && [...Object.values(cleanupResult), ...Object.values(processes)].every((value) => value === true);
  const passed = item5Passed || (manifestLineage.issue !== 5 && completed && observed && [...Object.values(results), ...Object.values(cleanupResult), ...Object.values(processes)].every((value) => value === true));
  return {
    version: 1,
    identity: 'Google service account non-production acceptance',
    ...manifestLineage,
    status: passed ? 'PASS' : 'FAIL', tree, observed: observed ?? null, results, cleanup: cleanupResult, processes,
  };
}
function parseLineage(env) {
  const value = { sha: env.KLASR_EVIDENCE_SHA, issue: Number(env.KLASR_EVIDENCE_ISSUE), attempt: Number(env.KLASR_EVIDENCE_ATTEMPT) };
  assert(/^[0-9a-f]{40}$/.test(value.sha ?? '') && /^\d+$/.test(env.KLASR_EVIDENCE_ISSUE ?? '') && value.issue > 0 && /^\d+$/.test(env.KLASR_EVIDENCE_ATTEMPT ?? '') && value.attempt > 0, 'Evidence lineage is invalid');
  return value;
}
function parseEvidenceTask(env) { assert(/^t_[a-z0-9]+$/.test(env.KLASR_EVIDENCE_TASK ?? ''), 'Evidence task is invalid'); return env.KLASR_EVIDENCE_TASK; }
function assertManifest(manifest) {
  const keys = (value) => Object.keys(value).sort().join(',');
  assert(keys(manifest) === 'attempt,cleanup,identity,issue,observed,processes,results,sha,status,tree,version', 'Sanitized manifest top-level schema mismatch');
  assert(keys(manifest.results) === 'anthropic_classification,anthropic_discovery,anthropic_setting_removed,anthropic_setting_saved,confirm_mutation,correction_mutation,desktop_browser,drive_download_ocr,drive_listing,fresh_provider_metadata,launch_completion,mobile_390_browser,proposal_review,reject_mutation,service_account_auth,terminal_no_reenqueue', 'Sanitized manifest result schema mismatch');
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
  assert(keys(proof.assertions) === 'driveConnectionPresent,fileBrowserVisible,grantedScopes,lastSyncAt,realSyncObserved,serviceAccountIdentity', 'Item 3 proof assertion schema mismatch');
  assert(proof.assertions.serviceAccountIdentity === null || /^[^\s@]+@[^\s@]+$/.test(proof.assertions.serviceAccountIdentity), 'Item 3 identity read-back invalid');
  assert(Array.isArray(proof.assertions.grantedScopes) && proof.assertions.grantedScopes.every((scope) => typeof scope === 'string'), 'Item 3 granted-scope read-back invalid');
  assert(proof.assertions.lastSyncAt === null || !Number.isNaN(Date.parse(proof.assertions.lastSyncAt)), 'Item 3 lastSyncAt invalid');
  assert(typeof proof.assertions.driveConnectionPresent === 'boolean' && typeof proof.assertions.realSyncObserved === 'boolean' && typeof proof.assertions.fileBrowserVisible === 'boolean', 'Item 3 boolean assertion invalid');
  if (requireComplete) assert(proof.assertions.serviceAccountIdentity && proof.assertions.grantedScopes.includes('https://www.googleapis.com/auth/drive') && proof.assertions.driveConnectionPresent && proof.assertions.lastSyncAt && proof.assertions.realSyncObserved && proof.assertions.fileBrowserVisible, 'Item 3 proof assertions incomplete');
  assertTreeBinding(tree, proof.tree);
}
function sanitizedItem5Proof(assertions, task, proofLineage, tree) {
  return { schema: 'klasr-item5-provider-proof-v1', task, issue: proofLineage.issue, attempt: proofLineage.attempt, sha: proofLineage.sha, tree, assertions };
}
function assertItem5Proof(proof, task, proofLineage, tree, requireComplete = false) {
  const keys = (value) => Object.keys(value).sort().join(',');
  assert(keys(proof) === 'assertions,attempt,issue,schema,sha,task,tree' && proof.schema === 'klasr-item5-provider-proof-v1', 'Item 5 proof schema mismatch');
  assert(proof.task === task && proof.issue === proofLineage.issue && proof.attempt === proofLineage.attempt && proof.sha === proofLineage.sha, 'Item 5 proof lineage mismatch');
  assert(keys(proof.assertions) === 'anthropicProvenance,borrowedCarrierIdStable,borrowedCarrierSnapshotted,browserKpiUpdated,correctedNameExact,correctedParentExact,createdFixtureTrashed,createdInAuthorizedRoot,createdRunnerOwned,exactRestorationVerified,explicitValidateClicked,finalExactNameCount,finalPdfCount,headedBrowser,noDestinationMatch,noMutationBeforeValidation,notExtractionFailed,originalBytesRetained,originalExactNameCount,originalPdfCount,overlayDestinationEdited,overlayNameEdited,overlayReasonVisible,overlayVisible,postValidationScreenshot,recoveryMarkerCleared,recoveryMarkerVerified', 'Item 5 proof assertion schema mismatch');
  const counts = ['originalExactNameCount', 'originalPdfCount', 'finalExactNameCount', 'finalPdfCount'];
  assert(Object.entries(proof.assertions).every(([key, value]) => counts.includes(key) ? value === null || Number.isInteger(value) : typeof value === 'boolean'), 'Item 5 proof assertion value invalid');
  if (requireComplete && proofLineage.issue === 5) {
    const requiredTrue = ['anthropicProvenance', 'borrowedCarrierIdStable', 'borrowedCarrierSnapshotted', 'browserKpiUpdated', 'correctedNameExact', 'correctedParentExact', 'createdFixtureTrashed', 'exactRestorationVerified', 'explicitValidateClicked', 'headedBrowser', 'noDestinationMatch', 'noMutationBeforeValidation', 'notExtractionFailed', 'originalBytesRetained', 'overlayDestinationEdited', 'overlayNameEdited', 'overlayReasonVisible', 'overlayVisible', 'postValidationScreenshot', 'recoveryMarkerCleared', 'recoveryMarkerVerified'];
    assert(proof.assertions.originalExactNameCount === 0 && proof.assertions.originalPdfCount === 0
      && proof.assertions.finalExactNameCount === 0 && proof.assertions.finalPdfCount === 0
      && proof.assertions.createdRunnerOwned === false && proof.assertions.createdInAuthorizedRoot === false
      && requiredTrue.every((key) => proof.assertions[key] === true), 'Item 5 borrowed-carrier proof assertions incomplete');
  } else if (requireComplete) assert(proof.assertions.originalExactNameCount === 0 && proof.assertions.originalPdfCount === 0 && proof.assertions.finalExactNameCount === 0 && proof.assertions.finalPdfCount === 0, 'Item 5 proof assertions incomplete');
  assertTreeBinding(tree, proof.tree);
}
function loopback(value) { const url = new URL(value); if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('Live app URLs must use loopback'); return value.replace(/\/$/, ''); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function assertThrows(action, message) { try { action(); } catch { return; } throw new Error(message); }
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

async function drive(url, init = {}) { const response = await fetch(`https://www.googleapis.com${url}`, { ...init, signal: init.signal ?? AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) } }); if (!response.ok) { let reason = 'unknown'; try { const payload = await response.json(); reason = payload?.error?.errors?.[0]?.reason ?? 'unknown'; } catch { /* status remains sufficient */ } throw new Error(`Google Drive request failed (${response.status}, ${reason})`); } return response.status === 204 ? null : response.json(); }
async function listChildren(parentId) { const q = new URLSearchParams({ q: `'${parentId.replaceAll("'", "\\'")}' in parents and trashed=false`, pageSize: '1000', fields: 'files(id,name,mimeType,parents)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }); return (await drive(`/drive/v3/files?${q}`)).files ?? []; }
async function metadata(id) { return drive(`/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,parents,trashed,headRevisionId,appProperties,driveId&supportsAllDrives=true`); }
async function createFolder(name, parentId) { return drive('/drive/v3/files?supportsAllDrives=true&fields=id,name,parents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }) }); }
async function createRunnerOwnedPdf(name, parentId, bytes) {
  assert(isPdf(bytes), 'Runner-owned fixture bytes must be a deterministic PDF');
  const created = await drive('/drive/v3/files?supportsAllDrives=true&fields=id,name,mimeType,parents,trashed,appProperties', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/pdf', parents: [parentId], appProperties: { klasrRunnerOwned: evidenceTask } }) });
  createdIds.push(created.id);
  await replaceBytes(created.id, bytes);
  const current = await metadata(created.id);
  assert(current.name === name && current.mimeType === 'application/pdf' && current.trashed === false && sameParents(current.parents, [parentId]) && current.appProperties?.klasrRunnerOwned === evidenceTask && sameBytes(await downloadBytes(current.id), bytes), 'Runner-owned fixture creation readback failed');
  return current;
}
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
async function cleanupVerified() { if (!fixtureSnapshots.length) return false; if (!cleanup.legacyFolderRestored) return false; accessToken = await serviceAccountToken(); const expectedReplacements = lineage.issue === 5 ? 0 : fixtureSnapshots.length; if (!(await createdGone()) || replacementAttempted.size !== expectedReplacements || replacementVerified.size !== expectedReplacements) return false; for (const snapshot of fixtureSnapshots) { const current = await metadata(snapshot.id); if (current.name !== snapshot.name || current.mimeType !== snapshot.mimeType || current.trashed !== snapshot.trashed || !sameParents(current.parents, snapshot.parents) || !sameBytes(await downloadBytes(snapshot.id), snapshot.bytes) || recoveryMarker(current, snapshot.recoveryScope)) return false; } const rootItems = await listChildren(sharedRootId); if (rootItems.filter(({ name }) => name === fixtureNames[1]).length !== item5Proof.originalExactNameCount || rootItems.filter(({ name, mimeType }) => name === fixtureNames[1] && mimeType === 'application/pdf').length !== item5Proof.originalPdfCount) return false; return !legacyFolderSnapshot || legacyFolderMatches(legacyFolderSnapshot, await metadata(legacyFolderSnapshot.id), true); }
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
function reviewRequiredPdf() { return Buffer.from('%PDF-1.4\n%%EOF\n'); }
function isPdf(bytes) { return Buffer.isBuffer(bytes) && bytes.subarray(0, 5).toString() === '%PDF-' && bytes.subarray(-6).toString().trim() === '%%EOF'; }
function existingFixturePdf(bytes) { return Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.subarray(0, 5).toString() === '%PDF-'; }
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
  const common = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl, MONGO_URL: mongoUrl, INTERNAL_API_SECRET: internalSecret, TOKEN_ENCRYPTION_KEY: tokenKey, KLASR_LOCAL_MVP: 'false', KLASR_INLINE_WORKER: 'true', KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: 'true', KLASR_GOOGLE_SERVICE_ACCOUNT_FILE: credentialPath, KLASR_GOOGLE_DRIVE_ROOT_ID: sharedRootId, KLASR_DRIVE_MUTATION_LOG: ignoreMutationLogPath };
  children.push({ child: spawn('pnpm', ['--filter', '@klasr/api', 'exec', 'nest', 'start'], { cwd: root, detached: true, stdio: 'ignore', env: { ...common, PORT: String(apiPort), HOST: '127.0.0.1' } }), url: `${apiBase}/health` });
  await waitReachable(`${apiBase}/health`);
  children.push({ child: spawn('pnpm', ['--filter', '@klasr/web', 'exec', 'next', 'dev', '-H', '127.0.0.1', '-p', String(webPort)], { cwd: root, detached: true, stdio: 'ignore', env: { ...common, NEXTAUTH_URL: webBase, NEXTAUTH_SECRET: nextAuthSecret, API_URL: apiBase, NEXT_PUBLIC_API_URL: apiBase, NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: 'true' } }), url: webBase });
  await waitReachable(`${webBase}/login`);
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
    if (owned.every(({ child }) => (child.exitCode !== null || child.signalCode !== null) && !groupAlive(child.pid)) && !(await Promise.all(owned.map(({ url }) => reachable(url)))).some(Boolean)) return true;
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
async function tenantId() { for (let i = 0; i < 40; i += 1) { const membership = await prisma.membership.findFirst({ where: { user: { email } }, select: { organizationId: true } }); if (membership) return membership.organizationId; await delay(250); } throw new Error('Acceptance tenant was not onboarded'); }
async function failedAnalysisDiagnostic() { if (!organizationId) return; const rows = await prisma.$queryRaw`SELECT 1 FROM pgboss.job WHERE name = 'analysis' AND state = 'failed' AND data->>'organizationId' = ${organizationId} AND created_on >= ${runStartedAt} LIMIT 1`; return rows.length ? 'stage=analysis reason=job_failed' : undefined; }
function assertNoPriorTenantSettingCount(count) { assert(count === 0, 'Prior tenant setting cannot be safely restored without plaintext'); }
async function assertNoPriorTenantSetting(id) { assertNoPriorTenantSettingCount(await prisma.llmSetting.count({ where: { organizationId: id } })); }
function selectEligibleAnthropicModel(models) { const eligible = models.filter((model) => /^claude-[a-z0-9-]+$/i.test(model)).sort(); assert(eligible.length, 'No eligible Anthropic model discovered'); return eligible.at(-1); }
async function configureAnthropicServerSide(context, secret) {
  const cookie = (await context.cookies(webBase)).map(({ name, value }) => `${name}=${value}`).join('; ');
  const request = async (method, body) => {
    const response = await fetch(`${webBase}/api/llm-settings`, { method, headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert(response.ok, `Anthropic tenant ${method === 'POST' ? 'discovery' : 'validation'} failed`);
    return response.json();
  };
  const discovered = await request('POST', { provider: 'anthropic', apiKey: secret });
  assert(Array.isArray(discovered.models), 'Anthropic discovery response malformed');
  const model = selectEligibleAnthropicModel(discovered.models);
  await request('PUT', { provider: 'anthropic', apiKey: secret, model });
  const rows = await prisma.$queryRaw`SELECT ("encryptedApiKey" <> ${secret} AND "encryptedApiKey" LIKE 'v1.%') AS encrypted FROM "LlmSetting" WHERE "organizationId" = ${organizationId}`;
  assert(rows.length === 1 && rows[0].encrypted === true, 'Encrypted setting structural proof failed');
  return { model, modelCount: discovered.models.length };
}
async function resetTenantData(id) { const rules = await prisma.classificationRule.findMany({ where: { organizationId: id }, select: { id: true } }); await prisma.actionHistory.deleteMany({ where: { organizationId: id } }); await prisma.classificationProposal.deleteMany({ where: { organizationId: id } }); await prisma.document.deleteMany({ where: { organizationId: id } }); await prisma.ruleCondition.deleteMany({ where: { ruleId: { in: rules.map((rule) => rule.id) } } }); await prisma.classificationRule.deleteMany({ where: { organizationId: id } }); await prisma.folder.deleteMany({ where: { organizationId: id } }); await prisma.organization.update({ where: { id }, data: { referenceRootExternalId: null, referenceRootName: null } }); }
async function cleanupTenant(id) { const rules = await prisma.classificationRule.findMany({ where: { organizationId: id }, select: { id: true } }); await prisma.actionHistory.deleteMany({ where: { organizationId: id } }); await prisma.classificationProposal.deleteMany({ where: { organizationId: id } }); await prisma.document.deleteMany({ where: { organizationId: id } }); await prisma.ruleCondition.deleteMany({ where: { ruleId: { in: rules.map((rule) => rule.id) } } }); await prisma.classificationRule.deleteMany({ where: { organizationId: id } }); await prisma.folder.deleteMany({ where: { organizationId: id } }); await prisma.llmSetting.deleteMany({ where: { organizationId: id } }); await prisma.organization.update({ where: { id }, data: { referenceRootExternalId: null, referenceRootName: null } }); }
async function api(route, init = {}) { const response = await fetch(`${apiBase}${route}`, { ...init, headers: { 'x-internal-secret': internalSecret, 'content-type': 'application/json', ...(init.headers ?? {}) } }); assert(response.ok, `API request failed (${response.status})`); return response.json(); }
async function chooseBrowserItem(page, name, action, expectAnalysis = false) { const submit = page.getByRole('button', { name: action }); const browserPanel = submit.locator('..'); await browserPanel.getByRole('list').waitFor({ timeout: 30_000 }); await page.waitForLoadState('networkidle'); const row = browserPanel.getByRole('button', { name, exact: true }).locator('..'); const radio = row.getByRole('radio'); await row.getByText('Sélectionner', { exact: true }).click(); await expect(radio).toBeChecked(); await expect(submit).toBeEnabled(); await submit.click(); if (expectAnalysis) await expect(page.getByRole('status')).toContainText('Analyse en cours'); }
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
