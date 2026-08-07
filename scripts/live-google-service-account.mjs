import { spawn } from 'node:child_process';
import { sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--lifecycle-check')) {
  await lifecycleCheck();
  process.stdout.write('live runner lifecycle check PASS\n');
  process.exit(0);
}

const syntheticLineage = { sha: '0'.repeat(40), issue: 1, attempt: 1 };
const lineage = process.argv.includes('--evidence-self-check') ? syntheticLineage : parseLineage(process.env);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, '.tmp/hermes/drive-reference-organization-flow');
const screenshotDir = path.join(evidenceDir, 'screenshots');
const manifestPath = path.join(evidenceDir, 'manifest.sanitized.json');
mkdirSync(screenshotDir, { recursive: true });

if (process.argv.includes('--evidence-self-check')) {
  assertManifest(sanitizedManifest({ serviceAccountAuth: 'PASS' }, { fixtureRestored: true, createdItemsRemoved: true, tenantCleaned: true, appsStopped: true, noOrphans: true }, lineage));
  process.stdout.write('live evidence schema check PASS\n');
  process.exit(0);
}

const requireApi = createRequire(path.join(root, 'apps/api/package.json'));
const requireWeb = createRequire(path.join(root, 'apps/web/package.json'));
const { createCanvas } = requireApi('@napi-rs/canvas');
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
const createdIds = [];
const fixtureNames = ['CDA_Oct25_18mois_Calendrier.pdf', 'doc3.pdf'];
const fixtureSnapshots = [];
const children = [];
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const evidence = {
  identity: 'Google service account (non-production acceptance; not end-user OAuth consent)',
  serviceAccountAuth: 'FAIL', realDriveListing: 'FAIL', realDriveDownloadOcr: 'FAIL',
  realProposalReview: 'FAIL', realDriveConfirmMutation: 'FAIL', realDriveCorrectMutation: 'FAIL',
  realDriveRejectMutation: 'FAIL', terminalNoReenqueue: 'FAIL', desktopBrowser: 'FAIL',
  mobile390Browser: 'FAIL', launchCompletion: 'FAIL', freshProviderMetadata: 'FAIL', cleanup: 'FAIL',
};
let accessToken;
let browser;
let organizationId;
let holdingWasPresent = false;
const cleanup = { fixtureRestored: false, createdItemsRemoved: false, tenantCleaned: false, appsStopped: false, noOrphans: false };

try {
  credentialPath = required('KLASR_GOOGLE_SERVICE_ACCOUNT_FILE');
  sharedRootId = required('KLASR_GOOGLE_DRIVE_ROOT_ID');
  accessToken = await serviceAccountToken();
  evidence.serviceAccountAuth = 'PASS';
  const rootItems = await listChildren(sharedRootId);
  const reference = exact(rootItems, 'stg_tree', 'application/vnd.google-apps.folder');
  holdingWasPresent = (await listChildren(reference.id)).some((item) => item.name === 'À traiter manuellement');
  const destinations = Object.fromEntries(await Promise.all(['invoices', 'meetings', 'quotes'].map(async (name) => {
    const item = exact(await listChildren(reference.id), name, 'application/vnd.google-apps.folder');
    return [name, item];
  })));
  evidence.realDriveListing = 'PASS';

  const inputFolder = await createFolder(runName, sharedRootId);
  createdIds.push(inputFolder.id);
  const existingFixtures = fixtureNames.map((name) => rootItems.find((item) => item.name === name && item.mimeType === 'application/pdf'));
  const supplied = existingFixtures.every(Boolean)
    ? existingFixtures
    : await Promise.all(['confirm', 'reject'].map(async (key) => {
      const item = await uploadPng(`${runName}-${key}.png`, sharedRootId, renderPng(`KLASR GENERATED ${key.toUpperCase()}`));
      createdIds.push(item.id);
      return item;
    }));
  for (const item of supplied) {
    const snapshot = await metadata(item.id);
    fixtureSnapshots.push(snapshot);
    await restoreMetadata(snapshot.id, { ...snapshot, parents: [inputFolder.id] });
  }
  const extension = path.extname(supplied[0].name);
  await ensureApps();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${webBase}/login`);
  await page.getByRole('button', { name: 'Validation Google staging' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await page.getByText('Validation staging · identité de service Google').waitFor();
  organizationId = await tenantId();
  await resetTenantData(organizationId);
  assert(await prisma.classificationRule.count({ where: { organizationId } }) === 0, 'Acceptance tenant must have zero rules');

  await chooseBrowserItem(page, 'stg_tree', 'Choisir ce dossier');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  for (const name of ['invoices', 'meetings', 'quotes']) await page.getByText(new RegExp(`/${name}$`)).waitFor();
  await chooseBrowserItem(page, runName, "Lancer l'organisation", true);
  await waitForProposalCards(page, 2);
  await expect(page.getByText('Analyse en cours', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: "Lancer l'organisation" })).toBeEnabled();
  evidence.launchCompletion = 'PASS';
  const confirmedCard = proposalCardFor(page, supplied[0].name);
  const rejectedCard = proposalCardFor(page, supplied[1].name);
  await expect(confirmedCard.getByLabel(/Confiance 20 %/)).toBeVisible();
  await expect(rejectedCard.getByLabel(/Confiance \d+ %/)).toBeVisible();
  await expect(confirmedCard).toContainText(supplied[0].name);
  await expect(rejectedCard).toContainText(supplied[1].name);
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

  const confirmPath = await displayedDestination(confirmedCard);
  await confirmedCard.getByRole('button', { name: /Valider le classement/ }).click();
  await expect(confirmedCard).toHaveCount(0);
  await rejectedCard.getByRole('button', { name: 'Retirer' }).click();
  await expect(rejectedCard).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Historique' })).toBeVisible();

  const confirmedMeta = await metadata(supplied[0].id);
  const confirmDestination = Object.values(destinations).find((item) => `/${item.name}` === confirmPath);
  assert(
    confirmDestination && confirmedMeta.name === supplied[0].name && sameParents(confirmedMeta.parents, [confirmDestination.id]),
    `confirm metadata mismatch: ${JSON.stringify({ confirmPath, actualName: confirmedMeta.name, expectedName: supplied[0].name, actualParents: confirmedMeta.parents, expectedParent: confirmDestination?.id })}`,
  );
  evidence.realDriveConfirmMutation = 'PASS';
  const rejectedMeta = await metadata(supplied[1].id);
  const holding = exact(await listChildren(reference.id), 'À traiter manuellement', 'application/vnd.google-apps.folder');
  if (!holdingWasPresent) createdIds.push(holding.id);
  assert(
    rejectedMeta.name === supplied[1].name && sameParents(rejectedMeta.parents, [holding.id]),
    `reject metadata mismatch: ${JSON.stringify({ actualName: rejectedMeta.name, expectedName: supplied[1].name, actualParents: rejectedMeta.parents, expectedParent: holding.id })}`,
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
  evidence.terminalNoReenqueue = 'PASS';

  await restoreFixtures();
  await resetTenantData(organizationId);
  assert(await prisma.classificationRule.count({ where: { organizationId } }) === 0, 'Correction run must have zero rules');
  await page.goto(`${webBase}/dashboard`);
  await chooseBrowserItem(page, 'stg_tree', 'Choisir ce dossier');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await chooseBrowserItem(page, supplied[0].name, "Lancer l'organisation", true);
  await waitForProposalCards(page, 1);
  const directCard = proposalCardFor(page, supplied[0].name);
  await directCard.getByRole('button', { name: 'Corriger' }).click();
  const correctedName = `Calendrier_CDA_Corrige${extension}`;
  await directCard.getByLabel('Nom final').fill(correctedName);
  await directCard.getByLabel('Dossier de destination').selectOption(destinations.meetings.id);
  await directCard.getByRole('button', { name: 'Confirmer la correction' }).click();
  await expect(directCard).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Historique' })).toBeVisible();
  const correctedMeta = await metadata(supplied[0].id);
  assert(correctedMeta.name === correctedName && sameParents(correctedMeta.parents, [destinations.meetings.id]), 'direct correction metadata mismatch');
  evidence.realDriveCorrectMutation = 'PASS';
  assert(await prisma.document.count({ where: { organizationId, status: 'CLASSIFIED' } }) === 1, 'UI correction did not persist classified state');
  const directRelaunch = await api(`/organizations/${organizationId}/drive/launch`, { method: 'POST', body: JSON.stringify({ itemExternalId: supplied[0].id }) });
  assert(directRelaunch.enqueued === 0, 'terminal direct file was re-enqueued');
} finally {
  if (browser) await browser.close().catch(() => undefined);
  cleanup.fixtureRestored = await restoreFixtures().then(() => true, () => false);
  for (const id of [...createdIds].reverse()) await trash(id).catch(() => undefined);
  cleanup.createdItemsRemoved = await createdGone().catch(() => false);
  cleanup.tenantCleaned = organizationId ? await cleanupTenant(organizationId).then(() => true, () => false) : true;
  evidence.cleanup = await cleanupVerified().catch(() => false) ? 'PASS' : 'FAIL';
  cleanup.appsStopped = await stopApps(children).then(() => true, () => false);
  cleanup.noOrphans = children.every(({ child }) => !groupAlive(child.pid))
    && !(await Promise.all([reachable(`${apiBase}/health`), reachable(webBase)])).some(Boolean);
  if (!cleanup.appsStopped) process.exitCode = 1;
  await prisma.$disconnect().catch(() => { process.exitCode = 1; });
  accessToken = undefined;
  const manifest = sanitizedManifest(evidence, cleanup, lineage);
  assertManifest(manifest);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

if (Object.entries(evidence).some(([key, value]) => key !== 'identity' && typeof value === 'string' && value !== 'PASS')) process.exitCode = 1;

function required(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
function sanitizedManifest(raw, proof, manifestLineage) {
  const results = {
    service_account_auth: raw.serviceAccountAuth === 'PASS', drive_listing: raw.realDriveListing === 'PASS',
    drive_download_ocr: raw.realDriveDownloadOcr === 'PASS', proposal_review: raw.realProposalReview === 'PASS',
    confirm_mutation: raw.realDriveConfirmMutation === 'PASS', correction_mutation: raw.realDriveCorrectMutation === 'PASS',
    reject_mutation: raw.realDriveRejectMutation === 'PASS', terminal_no_reenqueue: raw.terminalNoReenqueue === 'PASS',
    desktop_browser: raw.desktopBrowser === 'PASS', mobile_390_browser: raw.mobile390Browser === 'PASS',
    launch_completion: raw.launchCompletion === 'PASS', fresh_provider_metadata: raw.freshProviderMetadata === 'PASS',
  };
  const cleanupResult = { fixture_restored: proof.fixtureRestored, created_items_removed: proof.createdItemsRemoved, tenant_cleaned: proof.tenantCleaned };
  const processes = { apps_stopped: proof.appsStopped, no_orphans: proof.noOrphans };
  const passed = [...Object.values(results), ...Object.values(cleanupResult), ...Object.values(processes)].every((value) => value === true);
  return {
    version: 1,
    identity: 'Google service account non-production acceptance',
    ...manifestLineage,
    status: passed ? 'PASS' : 'FAIL', results, cleanup: cleanupResult, processes,
  };
}
function parseLineage(env) {
  const value = { sha: env.KLASR_EVIDENCE_SHA, issue: Number(env.KLASR_EVIDENCE_ISSUE), attempt: Number(env.KLASR_EVIDENCE_ATTEMPT) };
  assert(/^[0-9a-f]{40}$/.test(value.sha ?? '') && /^\d+$/.test(env.KLASR_EVIDENCE_ISSUE ?? '') && value.issue > 0 && /^\d+$/.test(env.KLASR_EVIDENCE_ATTEMPT ?? '') && value.attempt > 0, 'Evidence lineage is invalid');
  return value;
}
function assertManifest(manifest) {
  const keys = (value) => Object.keys(value).sort().join(',');
  assert(keys(manifest) === 'attempt,cleanup,identity,issue,processes,results,sha,status,version', 'Sanitized manifest top-level schema mismatch');
  assert(keys(manifest.results) === 'confirm_mutation,correction_mutation,desktop_browser,drive_download_ocr,drive_listing,fresh_provider_metadata,launch_completion,mobile_390_browser,proposal_review,reject_mutation,service_account_auth,terminal_no_reenqueue', 'Sanitized manifest result schema mismatch');
  assert(keys(manifest.cleanup) === 'created_items_removed,fixture_restored,tenant_cleaned', 'Sanitized manifest cleanup schema mismatch');
  assert(keys(manifest.processes) === 'apps_stopped,no_orphans', 'Sanitized manifest process schema mismatch');
  assert(/^[0-9a-f]{40}$/.test(manifest.sha) && Number.isInteger(manifest.issue) && manifest.issue > 0 && Number.isInteger(manifest.attempt) && manifest.attempt > 0, 'Sanitized manifest lineage is invalid');
}
function loopback(value) { const url = new URL(value); if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error('Live app URLs must use loopback'); return value.replace(/\/$/, ''); }
function assert(condition, message) { if (!condition) throw new Error(message); }
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
async function metadata(id) { return drive(`/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,parents,trashed&supportsAllDrives=true`); }
async function createFolder(name, parentId) { return drive('/drive/v3/files?supportsAllDrives=true&fields=id,name,parents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }) }); }
async function uploadPng(name, parentId, bytes) { const boundary = `klasr-${Date.now()}`; const head = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId] })}\r\n--${boundary}\r\nContent-Type: image/png\r\n\r\n`); const tail = Buffer.from(`\r\n--${boundary}--`); return drive('/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,parents', { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body: Buffer.concat([head, bytes, tail]) }); }
async function trash(id) { await drive(`/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) }); }
async function createdGone() { if (!accessToken) return createdIds.length === 0; for (const id of createdIds) { try { const item = await metadata(id); if (!item.trashed) return false; } catch { /* deleted is clean */ } } return true; }
async function restoreMetadata(id, target) { const current = await metadata(id); const query = new URLSearchParams({ supportsAllDrives: 'true', fields: 'id,name,mimeType,parents,trashed' }); const add = target.parents.filter((parent) => !current.parents.includes(parent)); const remove = current.parents.filter((parent) => !target.parents.includes(parent)); if (add.length) query.set('addParents', add.join(',')); if (remove.length) query.set('removeParents', remove.join(',')); return drive(`/drive/v3/files/${encodeURIComponent(id)}?${query}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: target.name, trashed: target.trashed }) }); }
async function restoreFixtures() { const results = await Promise.allSettled(fixtureSnapshots.map((snapshot) => restoreMetadata(snapshot.id, snapshot))); assert(results.every((result) => result.status === 'fulfilled'), 'Fixture restoration failed'); }
async function cleanupVerified() { if (!(await createdGone())) return false; for (const snapshot of fixtureSnapshots) { const current = await metadata(snapshot.id); if (current.name !== snapshot.name || current.trashed !== snapshot.trashed || !sameParents(current.parents, snapshot.parents)) return false; } return true; }
function sameParents(actual = [], expected = []) { return actual.length === expected.length && actual.every((parent) => expected.includes(parent)); }

function renderPng(text) { const canvas = createCanvas(1600, 900); const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1600, 900); ctx.fillStyle = 'black'; ctx.font = 'bold 54px sans-serif'; text.split(' ').reduce((lines, word) => { const last = lines.at(-1); if (ctx.measureText(`${last} ${word}`).width < 1400) lines[lines.length - 1] = `${last} ${word}`; else lines.push(word); return lines; }, ['']).forEach((line, index) => ctx.fillText(line, 100, 180 + index * 100)); return canvas.toBuffer('image/png'); }

async function ensureApps() {
  const common = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl, MONGO_URL: mongoUrl, INTERNAL_API_SECRET: internalSecret, TOKEN_ENCRYPTION_KEY: tokenKey, KLASR_LOCAL_MVP: 'false', KLASR_INLINE_WORKER: 'true', KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: 'true', KLASR_GOOGLE_SERVICE_ACCOUNT_FILE: credentialPath, KLASR_GOOGLE_DRIVE_ROOT_ID: sharedRootId };
  if (!(await reachable(`${apiBase}/health`))) children.push({ child: spawn('pnpm', ['--filter', '@klasr/api', 'exec', 'nest', 'start'], { cwd: root, detached: true, stdio: 'ignore', env: { ...common, PORT: String(apiPort), HOST: '127.0.0.1' } }), url: `${apiBase}/health` });
  await waitReachable(`${apiBase}/health`);
  if (!(await reachable(webBase))) children.push({ child: spawn('pnpm', ['--filter', '@klasr/web', 'exec', 'next', 'dev', '-H', '127.0.0.1', '-p', String(webPort)], { cwd: root, detached: true, stdio: 'ignore', env: { ...common, NEXTAUTH_URL: webBase, NEXTAUTH_SECRET: nextAuthSecret, API_URL: apiBase, NEXT_PUBLIC_API_URL: apiBase, NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: 'true' } }), url: webBase });
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
  await stopApps(owned);
}
async function tenantId() { for (let i = 0; i < 40; i += 1) { const membership = await prisma.membership.findFirst({ where: { user: { email } }, select: { organizationId: true } }); if (membership) return membership.organizationId; await delay(250); } throw new Error('Acceptance tenant was not onboarded'); }

async function resetTenantData(id) { const rules = await prisma.classificationRule.findMany({ where: { organizationId: id }, select: { id: true } }); await prisma.actionHistory.deleteMany({ where: { organizationId: id } }); await prisma.classificationProposal.deleteMany({ where: { organizationId: id } }); await prisma.document.deleteMany({ where: { organizationId: id } }); await prisma.ruleCondition.deleteMany({ where: { ruleId: { in: rules.map((rule) => rule.id) } } }); await prisma.classificationRule.deleteMany({ where: { organizationId: id } }); await prisma.folder.deleteMany({ where: { organizationId: id } }); await prisma.organization.update({ where: { id }, data: { referenceRootExternalId: null, referenceRootName: null } }); }
async function cleanupTenant(id) { const rules = await prisma.classificationRule.findMany({ where: { organizationId: id }, select: { id: true } }); await prisma.actionHistory.deleteMany({ where: { organizationId: id } }); await prisma.classificationProposal.deleteMany({ where: { organizationId: id } }); await prisma.document.deleteMany({ where: { organizationId: id } }); await prisma.ruleCondition.deleteMany({ where: { ruleId: { in: rules.map((rule) => rule.id) } } }); await prisma.classificationRule.deleteMany({ where: { organizationId: id } }); await prisma.folder.deleteMany({ where: { organizationId: id } }); await prisma.organization.update({ where: { id }, data: { referenceRootExternalId: null, referenceRootName: null } }); }
async function api(route, init = {}) { const response = await fetch(`${apiBase}${route}`, { ...init, headers: { 'x-internal-secret': internalSecret, 'content-type': 'application/json', ...(init.headers ?? {}) } }); assert(response.ok, `API request failed (${response.status})`); return response.json(); }
async function chooseBrowserItem(page, name, action, expectAnalysis = false) { const submit = page.getByRole('button', { name: action }); const browserPanel = submit.locator('..'); await browserPanel.getByRole('list').waitFor({ timeout: 30_000 }); await page.waitForLoadState('networkidle'); const row = browserPanel.getByRole('button', { name, exact: true }).locator('..'); const radio = row.getByRole('radio'); await row.getByText('Sélectionner', { exact: true }).click(); await expect(radio).toBeChecked(); await expect(submit).toBeEnabled(); await submit.click(); if (expectAnalysis) await expect(page.getByRole('status')).toContainText('Analyse en cours'); }
async function waitForProposalCards(page, count) { await expect(page.locator('[data-testid^="proposal-"]')).toHaveCount(count, { timeout: 180_000 }); }
function proposalCardFor(page, documentName) { return page.locator('[data-testid^="proposal-"]').filter({ hasText: documentName }); }
async function displayedDestination(card) { return (await card.locator('p span.font-mono').last().textContent()).trim(); }
async function copyCookies(from, to) { await to.addCookies(await from.cookies()); }
