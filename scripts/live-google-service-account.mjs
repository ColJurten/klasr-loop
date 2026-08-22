import { spawn } from 'node:child_process';
import { createHash, sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { assertTreeBinding, currentTreeBinding, parseObservedRecord } from './live-google-evidence.mjs';

const fixtureNames = ['CDA_Oct25_18mois_Calendrier.pdf', 'doc3.pdf'];
const recoveryVersion = '1';
const failureStages = ['preflight', 'auth', 'recovery', 'listing', 'app-start', 'browser-byok', 'drive-fixture-prepare', 'browser-source-selection', 'browser-input-enqueue', 'proposal-card-wait', 'launch-completion-ui', 'anthropic-provenance-db', 'ui-decisions-provider-metadata', 'correction-relaunch', 'settings-delete', 'cleanup-finalization'];
const failureOverrides = ['stage=analysis reason=job_failed'];

if (process.argv.includes('--lifecycle-check')) {
  await lifecycleCheck();
  process.stdout.write('live runner lifecycle check PASS\n');
  process.exit(0);
}

if (process.argv.includes('--decision-selection-check')) {
  const items = fixtureNames.map((name, index) => ({ id: String(index), name, mimeType: 'application/pdf' }));
  const supplied = selectFixtures(items);
  const fixtureSnapshots = supplied.map((item, index) => ({ ...item, parents: ['root'], trashed: false, bytes: Buffer.from(`%PDF-${index}\n%%EOF`) }));
  const replacements = [{ id: supplied[0].id, bytes: syntheticInvoicePdf('self-check') }, { id: supplied[1].id, bytes: manualReviewPdf() }];
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
    { id: 'manual', manualReview: true, confirmEnabled: false, destination: '' },
    { id: 'wrong', manualReview: false, confirmEnabled: true, destination: '/quotes' },
    { id: 'valid', manualReview: false, confirmEnabled: true, destination: '/invoices' },
  ]);
  assert(selected.confirm.id === 'valid' && selected.reject.id === 'manual', 'Decision fixture selection is not provider-agnostic');
  process.stdout.write('live runner fixture restoration and decision selection check PASS\n');
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
const isolatedLifecycleCheck = fatalLifecycleCheck || process.argv.includes('--preflight-lifecycle-check');
const evidenceDir = isolatedLifecycleCheck ? required('KLASR_FATAL_CHECK_DIR') : path.join(root, '.tmp/hermes/drive-reference-organization-flow');
const screenshotDir = path.join(evidenceDir, 'screenshots');
const manifestPath = path.join(evidenceDir, 'manifest.sanitized.json');
const realAcceptancePath = isolatedLifecycleCheck ? path.join(evidenceDir, 'REAL_ACCEPTANCE.md') : path.join(root, '.tmp/hermes/BYOK-20260816/REAL_ACCEPTANCE.md');
const observedPath = path.join(evidenceDir, 'observed.sanitized.json');
mkdirSync(screenshotDir, { recursive: true });

if (process.argv.includes('--evidence-self-check')) {
  const tree = { schema: 'klasr-tree-v1', mode: 'worktree', head: lineage.sha, digest: 'b'.repeat(64) };
  const observed = { schema: 'klasr-live-observed-v1', stage: 'settings-deleted', selectedModelId: 'claude-safe', modelCount: 2, modelUsed: 'anthropic/claude-safe', tree };
  const raw = {
    serviceAccountAuth: 'PASS', realDriveListing: 'PASS', realDriveDownloadOcr: 'PASS', realProposalReview: 'PASS',
    realDriveConfirmMutation: 'PASS', realDriveCorrectMutation: 'PASS', realDriveRejectMutation: 'PASS', terminalNoReenqueue: 'PASS',
    desktopBrowser: 'PASS', mobile390Browser: 'PASS', launchCompletion: 'PASS', freshProviderMetadata: 'PASS',
    anthropicDiscovery: 'PASS', anthropicSettingSaved: 'PASS', anthropicClassification: 'PASS', anthropicSettingRemoved: 'PASS',
  };
  const proof = { fixtureRestored: true, createdItemsRemoved: true, tenantCleaned: true, appsStopped: true, noOrphans: true };
  const complete = sanitizedManifest(raw, proof, lineage, tree, observed, true);
  const incomplete = sanitizedManifest(raw, proof, lineage, tree, observed, false);
  assertManifest(complete);
  assertManifest(incomplete);
  assert(complete.status === 'PASS' && incomplete.status === 'FAIL', 'Evidence self-check must fail incomplete runs');
  const markdown = realAcceptanceMarkdown(complete, evidenceTask, undefined);
  assert(markdown.includes(`Task: \`${evidenceTask}\``) && markdown.includes(`Attempt: \`${lineage.attempt}\``) && markdown.includes(`SHA: \`${lineage.sha}\``), 'REAL_ACCEPTANCE lineage must use current runner inputs');
  for (const key of ['anthropicDiscovery', 'anthropicSettingSaved', 'anthropicClassification', 'anthropicSettingRemoved']) {
    assert(sanitizedManifest({ ...raw, [key]: 'FAIL' }, proof, lineage, tree, observed, true).status === 'FAIL', `${key} must bind manifest PASS`);
  }
  process.stdout.write('live evidence schema check PASS\n');
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
  realDriveRejectMutation: 'FAIL', terminalNoReenqueue: 'FAIL', desktopBrowser: 'FAIL',
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
let holdingWasPresent = false;
const replacementAttempted = new Set();
const replacementVerified = new Set();
const cleanup = { fixtureRestored: false, createdItemsRemoved: false, tenantCleaned: false, appsStopped: false, noOrphans: false };
let restorationFlight;
let finalizationFlight;
let normalCleanupDone = false;
let failureStage = 'preflight';
let failureStageAtFailure;
let failureDiagnostic;
let acceptanceBlocked = false;

async function emergencyExit(code) {
  const outcome = await Promise.race([
    finalize().then(() => 'finalized', () => 'rejected'),
    delay(90_000, 'timeout'),
  ]);
  if (outcome !== 'finalized') process.stderr.write('root failure: stage=cleanup-finalization\n');
  process.exit(outcome === 'finalized' ? code : 1);
}
async function fatalExit(code = 1) {
  assert(failureStages.includes(failureStage), 'Invalid failure stage');
  assert(failureStageAtFailure === undefined || failureStages.includes(failureStageAtFailure), 'Invalid captured failure stage');
  failureDiagnostic ??= await failedAnalysisDiagnostic().catch(() => undefined);
  assert(failureDiagnostic === undefined || failureOverrides.includes(failureDiagnostic), 'Invalid failure diagnostic');
  process.stderr.write(`root failure: ${failureDiagnostic ?? `stage=${failureStageAtFailure ?? failureStage}`}\n`);
  if (normalCleanupDone) { process.exitCode = 1; return; }
  await emergencyExit(code);
}
process.on('SIGINT', () => void fatalExit(130));
process.on('SIGTERM', () => void fatalExit(143));
process.on('SIGHUP', () => void fatalExit(129));
process.on('uncaughtException', () => void fatalExit());
process.on('unhandledRejection', () => void fatalExit());

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
  evidence.serviceAccountAuth = 'PASS';
  failureStage = 'recovery';
  await recoverMarkedFixtures();
  failureStage = 'listing';
  const rootItems = await listChildren(sharedRootId);
  const supplied = selectFixtures(rootItems);
  const reference = exact(rootItems, 'stg_tree', 'application/vnd.google-apps.folder');
  holdingWasPresent = (await listChildren(reference.id)).some((item) => item.name === 'À traiter manuellement');
  const destinations = Object.fromEntries(await Promise.all(['invoices', 'meetings', 'quotes'].map(async (name) => {
    const item = exact(await listChildren(reference.id), name, 'application/vnd.google-apps.folder');
    return [name, item];
  })));
  evidence.realDriveListing = 'PASS';

  // fixtureNames order is contractual: invoice drives OCR/confirm; manual drives extraction failure/reject/correct.
  const [invoiceFixture, manualFixture] = supplied;
  failureStage = 'app-start';
  await ensureApps();
  failureStage = 'browser-byok';
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${webBase}/login`);
  await page.getByRole('button', { name: 'Validation Google staging' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await page.getByText('Validation staging · identité de service Google').waitFor();
  organizationId = await tenantId();
  await assertNoPriorTenantSetting(organizationId);
  await resetTenantData(organizationId);
  assert(await prisma.classificationRule.count({ where: { organizationId } }) === 0, 'Acceptance tenant must have zero rules');
  ({ model: selectedAnthropicModel, modelCount: discoveredAnthropicModelCount } = await configureAnthropicServerSide(context, anthropicKey));
  evidence.anthropicDiscovery = 'PASS';
  evidence.anthropicSettingSaved = 'PASS';
  await page.getByRole('link', { name: 'Paramètres IA' }).click();
  await page.waitForURL(/\/dashboard\/settings/);
  await expect(page.getByText(`Anthropic · ${selectedAnthropicModel}`)).toBeVisible();
  await expect(page.getByLabel('Clé API')).toHaveValue('');
  await page.getByRole('link', { name: 'Tableau de bord' }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
  await page.getByText('Validation staging · identité de service Google').waitFor();
  await page.getByRole('button', { name: 'Choisir ce dossier' }).waitFor();

  failureStage = 'drive-fixture-prepare';
  const inputFolder = await createFolder(runName, sharedRootId);
  createdIds.push(inputFolder.id);
  for (const item of supplied) fixtureSnapshots.push({ ...await metadata(item.id), bytes: await downloadBytes(item.id) });
  assert(fixtureSnapshots.length === 2 && fixtureSnapshots.every(({ bytes }) => existingFixturePdf(bytes)), 'Exactly two existing PDF fixtures must be snapshotted');
  const replacementBytes = syntheticInvoicePdf(runName);
  const manualBytes = manualReviewPdf();
  assert(isPdf(replacementBytes) && isPdf(manualBytes), 'Generated replacements must be PDF-marked');
  const invoiceRevision = await pinOriginalRevision(invoiceFixture, fixtureSnapshots[0].bytes);
  await markRecovery(invoiceFixture.id, invoiceRevision, 'invoice');
  await restoreMetadata(invoiceFixture.id, { ...fixtureSnapshots[0], parents: [inputFolder.id] });
  replacementAttempted.add(invoiceFixture.id);
  await replaceBytes(invoiceFixture.id, replacementBytes);
  observedReplacements.set(invoiceFixture.id, await downloadBytes(invoiceFixture.id));
  assert(!sameBytes(fixtureSnapshots[0].bytes, observedReplacements.get(invoiceFixture.id)), 'Temporary fixture replacement did not change provider bytes');
  replacementVerified.add(invoiceFixture.id);
  const manualRevision = await pinOriginalRevision(manualFixture, fixtureSnapshots[1].bytes);
  await markRecovery(manualFixture.id, manualRevision, 'manual');
  await restoreMetadata(manualFixture.id, { ...fixtureSnapshots[1], parents: [inputFolder.id] });
  replacementAttempted.add(manualFixture.id);
  await replaceBytes(manualFixture.id, manualBytes);
  observedReplacements.set(manualFixture.id, await downloadBytes(manualFixture.id));
  assert(!sameBytes(fixtureSnapshots[1].bytes, observedReplacements.get(manualFixture.id)), 'Temporary manual fixture replacement did not change provider bytes');
  replacementVerified.add(manualFixture.id);

  failureStage = 'browser-source-selection';
  await chooseBrowserItem(page, 'stg_tree', 'Choisir ce dossier');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  for (const name of ['invoices', 'meetings', 'quotes']) await page.getByText(new RegExp(`/${name}$`)).waitFor();
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
      manualReview: await card.getByText('à vérifier', { exact: true }).isVisible()
        && await card.getByText(/exclue de Tout valider/).isVisible(),
      confirmEnabled: await confirmButton.isEnabled(),
    });
  }
  const { confirm: confirmed, reject: rejected } = chooseDecisionFixtures(proposals);
  assert(confirmed.fixture.id === invoiceFixture.id && rejected.fixture.id === manualFixture.id, 'Decision fixtures did not preserve generated-confirm and manual-reject roles');
  const confirmedCard = confirmed.card;
  const rejectedCard = rejected.card;
  await expectReviewRequiredProposal(proposals.find(({ manualReview }) => manualReview).card);
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
  await confirmedCard.getByRole('button', { name: /Valider le classement/ }).click();
  await expect(confirmedCard).toHaveCount(0);
  await rejectedCard.getByRole('button', { name: 'Retirer' }).click();
  await expect(rejectedCard).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Historique' })).toBeVisible();

  const confirmedMeta = await metadata(confirmed.fixture.id);
  const confirmDestination = Object.values(destinations).find((item) => `/${item.name}` === confirmPath);
  assert(
    confirmDestination && confirmedMeta.name === confirmed.proposedName && sameParents(confirmedMeta.parents, [confirmDestination.id]),
    'Confirm provider metadata mismatch',
  );
  evidence.realDriveConfirmMutation = 'PASS';
  const rejectedMeta = await metadata(rejected.fixture.id);
  const holding = exact(await listChildren(reference.id), 'À traiter manuellement', 'application/vnd.google-apps.folder');
  if (!holdingWasPresent) createdIds.push(holding.id);
  assert(
    rejectedMeta.name === rejected.fixture.name && sameParents(rejectedMeta.parents, [holding.id]),
    'Reject provider metadata mismatch',
  );
  evidence.realDriveRejectMutation = 'PASS';
  evidence.freshProviderMetadata = 'PASS';
  assert(await prisma.document.count({ where: { organizationId, status: { in: ['CLASSIFIED', 'MANUAL'] } } }) === 2, 'UI decisions did not persist terminal document states');

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
  await resetTenantData(organizationId);
  assert(await prisma.classificationRule.count({ where: { organizationId } }) === 0, 'Correction run must have zero rules');
  await page.goto(`${webBase}/dashboard`);
  await chooseBrowserItem(page, 'stg_tree', 'Choisir ce dossier');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await chooseBrowserItem(page, manualFixture.name, "Lancer l'organisation", true);
  await waitForProposalCards(page, 1);
  const correctionFixture = manualFixture;
  const directCard = proposalCardFor(page, correctionFixture.name);
  await directCard.getByRole('button', { name: 'Corriger', exact: true }).click();
  const correctedName = `Document_Corrige${path.extname(correctionFixture.name)}`;
  await directCard.getByLabel('Nom final').fill(correctedName);
  await directCard.getByLabel('Dossier de destination').selectOption(destinations.meetings.id);
  await directCard.getByRole('button', { name: 'Confirmer la correction' }).click();
  await expect(directCard).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Historique' })).toBeVisible();
  const correctedMeta = await metadata(correctionFixture.id);
  assert(correctedMeta.name === correctedName && sameParents(correctedMeta.parents, [destinations.meetings.id]), 'direct correction metadata mismatch');
  evidence.realDriveCorrectMutation = 'PASS';
  assert(await prisma.document.count({ where: { organizationId, status: 'CLASSIFIED' } }) === 1, 'UI correction did not persist classified state');
  const directRelaunch = await api(`/organizations/${organizationId}/drive/launch`, { method: 'POST', body: JSON.stringify({ itemExternalId: correctionFixture.id }) });
  assert(directRelaunch.enqueued === 0, 'terminal direct file was re-enqueued');
  evidence.terminalNoReenqueue = 'PASS';
  failureStage = 'settings-delete';
  await page.getByRole('link', { name: 'Paramètres IA' }).click();
  await page.waitForURL(/\/dashboard\/settings/);
  await page.getByRole('button', { name: 'Supprimer la configuration' }).click();
  await expect(page.getByRole('status')).toContainText('Configuration supprimée');
  assert(await prisma.llmSetting.count({ where: { organizationId } }) === 0, 'tenant_setting_absent');
  evidence.anthropicSettingRemoved = 'PASS';
  writeFileSync(observedPath, `${JSON.stringify({ schema: 'klasr-live-observed-v1', stage: 'settings-deleted', selectedModelId: selectedAnthropicModel, modelCount: discoveredAnthropicModelCount, modelUsed: observedModelUsed, tree: initialTreeBinding })}\n`, { mode: 0o600 });
  runCompleted = true;
} catch (error) {
  failureStageAtFailure = failureStage;
  failureDiagnostic = await failedAnalysisDiagnostic().catch(() => undefined);
  throw error;
} finally {
  await finalize();
}

if (Object.entries(evidence).some(([key, value]) => key !== 'identity' && typeof value === 'string' && value !== 'PASS')) process.exitCode = 1;

function required(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
function finalize() {
  return finalizationFlight ??= (async () => {
    failureDiagnostic ??= await failedAnalysisDiagnostic().catch(() => undefined);
    failureStage = 'cleanup-finalization';
    if (browser) await browser.close().catch(() => undefined);
    cleanup.fixtureRestored = await restoreFixtures().then(() => true, () => false);
    for (const id of [...createdIds].reverse()) await trash(id).catch(() => undefined);
    cleanup.createdItemsRemoved = await createdGone().catch(() => false);
    cleanup.tenantCleaned = organizationId ? await cleanupTenant(organizationId).then(() => true, () => false) : true;
    evidence.cleanup = await cleanupVerified().catch(() => false) ? 'PASS' : 'FAIL';
    cleanup.appsStopped = await stopApps(children).then(() => true, () => false);
    cleanup.noOrphans = children.every(({ child }) => !groupAlive(child.pid))
      && !(await Promise.all([reachable(`${apiBase}/health`), reachable(webBase)])).some(Boolean);
    await prisma.$disconnect().catch(() => { process.exitCode = 1; });
    accessToken = undefined;
    const finalTreeBinding = currentTreeBinding(root);
    assertTreeBinding(initialTreeBinding, finalTreeBinding);
    const observed = runCompleted ? parseObservedRecord(readFileSync(observedPath, 'utf8'), finalTreeBinding) : undefined;
    const manifest = sanitizedManifest(evidence, cleanup, lineage, finalTreeBinding, observed, runCompleted);
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
function sanitizedManifest(raw, proof, manifestLineage, tree, observed, completed) {
  const results = {
    anthropic_discovery: raw.anthropicDiscovery === 'PASS', anthropic_setting_saved: raw.anthropicSettingSaved === 'PASS',
    anthropic_classification: raw.anthropicClassification === 'PASS', anthropic_setting_removed: raw.anthropicSettingRemoved === 'PASS',
    service_account_auth: raw.serviceAccountAuth === 'PASS', drive_listing: raw.realDriveListing === 'PASS',
    drive_download_ocr: raw.realDriveDownloadOcr === 'PASS', proposal_review: raw.realProposalReview === 'PASS',
    confirm_mutation: raw.realDriveConfirmMutation === 'PASS', correction_mutation: raw.realDriveCorrectMutation === 'PASS',
    reject_mutation: raw.realDriveRejectMutation === 'PASS', terminal_no_reenqueue: raw.terminalNoReenqueue === 'PASS',
    desktop_browser: raw.desktopBrowser === 'PASS', mobile_390_browser: raw.mobile390Browser === 'PASS',
    launch_completion: raw.launchCompletion === 'PASS', fresh_provider_metadata: raw.freshProviderMetadata === 'PASS',
  };
  const cleanupResult = { fixture_restored: proof.fixtureRestored, created_items_removed: proof.createdItemsRemoved, tenant_cleaned: proof.tenantCleaned };
  const processes = { apps_stopped: proof.appsStopped, no_orphans: proof.noOrphans };
  const passed = completed && observed && [...Object.values(results), ...Object.values(cleanupResult), ...Object.values(processes)].every((value) => value === true);
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

async function drive(url, init = {}) { const response = await fetch(`https://www.googleapis.com${url}`, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init.headers ?? {}) } }); if (!response.ok) { let reason = 'unknown'; try { const payload = await response.json(); reason = payload?.error?.errors?.[0]?.reason ?? 'unknown'; } catch { /* status remains sufficient */ } throw new Error(`Google Drive request failed (${response.status}, ${reason})`); } return response.status === 204 ? null : response.json(); }
async function listChildren(parentId) { const q = new URLSearchParams({ q: `'${parentId.replaceAll("'", "\\'")}' in parents and trashed=false`, pageSize: '1000', fields: 'files(id,name,mimeType,parents)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' }); return (await drive(`/drive/v3/files?${q}`)).files ?? []; }
async function metadata(id) { return drive(`/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,parents,trashed,headRevisionId,appProperties,driveId&supportsAllDrives=true`); }
async function createFolder(name, parentId) { return drive('/drive/v3/files?supportsAllDrives=true&fields=id,name,parents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }) }); }
async function downloadBytes(id) { const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${accessToken}` } }); assert(response.ok, `Google Drive media request failed (${response.status})`); return Buffer.from(await response.arrayBuffer()); }
async function downloadRevision(id, revisionId) { const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } }); assert(response.ok, `Google Drive revision media request failed (${response.status})`); return Buffer.from(await response.arrayBuffer()); }
async function listRevisions(id) { const revisions = []; let pageToken; do { const query = new URLSearchParams({ pageSize: '1000', fields: 'nextPageToken,revisions(id,keepForever)', ...(pageToken ? { pageToken } : {}) }); const page = await drive(`/drive/v3/files/${encodeURIComponent(id)}/revisions?${query}`); revisions.push(...(page.revisions ?? [])); pageToken = page.nextPageToken; } while (pageToken); return revisions; }
async function replaceBytes(id, bytes) { return drive(`/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true&fields=id,name,mimeType,parents`, { method: 'PATCH', headers: { 'content-type': 'application/pdf' }, body: bytes }); }
async function trash(id) { await drive(`/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); }
async function createdGone() { if (!accessToken) return createdIds.length === 0; for (const id of createdIds) { try { const item = await metadata(id); if (!item.trashed) return false; } catch { /* deleted is clean */ } } return true; }
async function restoreMetadata(id, target) { const current = await metadata(id); const query = new URLSearchParams({ supportsAllDrives: 'true', fields: 'id,name,mimeType,parents,trashed' }); const add = target.parents.filter((parent) => !current.parents.includes(parent)); const remove = current.parents.filter((parent) => !target.parents.includes(parent)); if (add.length) query.set('addParents', add.join(',')); if (remove.length) query.set('removeParents', remove.join(',')); return drive(`/drive/v3/files/${encodeURIComponent(id)}?${query}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: target.name, trashed: target.trashed }) }); }
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
    const results = await Promise.allSettled(fixtureSnapshots.map(async (snapshot, index) => {
      const revisionId = recoveryMarker(await metadata(snapshot.id), index === 0 ? 'invoice' : 'manual');
      if (!revisionId) { assert(await fixtureMatches(snapshot), 'Unmarked fixture is not untouched or restored'); return; }
      await restoreFromRevision(snapshot, revisionId, snapshot, index === 0 ? 'invoice' : 'manual', finish);
    }));
    assert(results.every(({ status }) => status === 'fulfilled'), 'Fixture restoration failed');
    const restored = await Promise.all(fixtureSnapshots.map(async (snapshot) => ({ ...await metadata(snapshot.id), bytes: await downloadBytes(snapshot.id) })));
    assert(restorationVerified(fixtureSnapshots, restored, fixtureSnapshots.map((snapshot) => ({ id: snapshot.id, bytes: observedReplacements.get(snapshot.id) }))), 'Fixture restoration verification failed');
    return { touched: fixtureSnapshots.length };
  })();
  try { return await restorationFlight; }
  finally { restorationFlight = undefined; }
}
async function cleanupVerified() { if (!fixtureSnapshots.length) return false; accessToken = await serviceAccountToken(); if (!(await createdGone()) || fixtureSnapshots.length !== 2 || replacementAttempted.size !== 2 || replacementVerified.size !== 2) return false; for (const snapshot of fixtureSnapshots) { const current = await metadata(snapshot.id); if (current.name !== snapshot.name || current.mimeType !== snapshot.mimeType || current.trashed !== snapshot.trashed || !sameParents(current.parents, snapshot.parents) || !sameBytes(await downloadBytes(snapshot.id), snapshot.bytes) || recoveryMarker(current, snapshot.id === fixtureSnapshots[0].id ? 'invoice' : 'manual')) return false; } return true; }
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
function manualReviewPdf() { return Buffer.from('%PDF-1.4\n%%EOF\n'); }
function isPdf(bytes) { return Buffer.isBuffer(bytes) && bytes.subarray(0, 5).toString() === '%PDF-' && bytes.subarray(-6).toString().trim() === '%%EOF'; }
function existingFixturePdf(bytes) { return Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.subarray(0, 5).toString() === '%PDF-'; }
function selectFixtures(items) {
  return fixtureNames.map((name) => exact(items, name, 'application/pdf'));
}
function restorationVerified(snapshots, restored, replacements) {
  assert(snapshots.length === 2 && restored.length === 2, 'Expected two fixture restoration snapshots');
  assert(replacements.length === 2 && snapshots.every((snapshot) => replacements.some((replacement) => replacement.id === snapshot.id && (replacement.bytes === undefined || !sameBytes(snapshot.bytes, replacement.bytes)))), 'Changed fixture proof is missing');
  return snapshots.every((snapshot) => {
    const current = restored.find((item) => item.id === snapshot.id);
    return current && current.name === snapshot.name && current.mimeType === snapshot.mimeType && current.trashed === snapshot.trashed
      && sameParents(current.parents, snapshot.parents) && sameBytes(current.bytes, snapshot.bytes);
  });
}

async function ensureApps() {
  await assertAppsAbsent([`${apiBase}/health`, `${webBase}/login`]);
  const common = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl, MONGO_URL: mongoUrl, INTERNAL_API_SECRET: internalSecret, TOKEN_ENCRYPTION_KEY: tokenKey, KLASR_LOCAL_MVP: 'false', KLASR_INLINE_WORKER: 'true', KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: 'true', KLASR_GOOGLE_SERVICE_ACCOUNT_FILE: credentialPath, KLASR_GOOGLE_DRIVE_ROOT_ID: sharedRootId };
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
  let rejected = false;
  try { await assertAppsAbsent([`http://127.0.0.1:${port}`]); } catch (error) { rejected = /Pre-existing app/.test(error.message); }
  assert(rejected, 'Pre-existing health endpoint was not rejected');
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
  assert(proposals.some(({ manualReview }) => manualReview), 'Expected at least one genuinely manual-review proposal excluded from Tout valider');
  const confirm = proposals.find(({ manualReview, confirmEnabled, destination }) => !manualReview && confirmEnabled && destination === '/invoices');
  assert(confirm, 'Expected an enabled non-manual proposal for /invoices confirmation');
  const reject = proposals.find(({ manualReview }) => manualReview);
  assert(reject !== confirm, 'Expected a separate manual-review proposal for rejection');
  return { confirm, reject };
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
