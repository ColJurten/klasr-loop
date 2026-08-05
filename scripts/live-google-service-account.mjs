import { spawn } from 'node:child_process';
import { sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireApi = createRequire(path.join(root, 'apps/api/package.json'));
const requireWeb = createRequire(path.join(root, 'apps/web/package.json'));
const { createCanvas } = requireApi('@napi-rs/canvas');
const { PrismaClient } = requireApi('@prisma/client');
const { chromium, expect } = requireWeb('@playwright/test');

const credentialPath = required('KLASR_GOOGLE_SERVICE_ACCOUNT_FILE');
const sharedRootId = required('KLASR_GOOGLE_DRIVE_ROOT_ID');
const apiPort = Number(process.env.KLASR_LIVE_API_PORT ?? 3201);
const webPort = Number(process.env.KLASR_LIVE_WEB_PORT ?? 4201);
const apiBase = loopback(process.env.KLASR_LIVE_API_URL ?? `http://127.0.0.1:${apiPort}/api/v1`);
const webBase = loopback(process.env.KLASR_LIVE_WEB_URL ?? `http://127.0.0.1:${webPort}`);
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/klasr';
const mongoUrl = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017';
const internalSecret = process.env.KLASR_LIVE_INTERNAL_SECRET ?? 'google-sa-live-internal';
const nextAuthSecret = process.env.KLASR_LIVE_NEXTAUTH_SECRET ?? 'google-sa-live-nextauth';
const tokenKey = process.env.TOKEN_ENCRYPTION_KEY ?? 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const evidenceDir = path.join(root, '.tmp/hermes/drive-reference-organization-flow');
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
  mobile390Browser: 'FAIL', cleanup: 'FAIL', fixtures: [], destinations: {},
};
let accessToken;
let browser;
let organizationId;
let holdingWasPresent = false;

try {
  accessToken = await serviceAccountToken();
  evidence.serviceAccountAuth = 'PASS';
  const rootItems = await listChildren(sharedRootId);
  const reference = exact(rootItems, 'stg_tree', 'application/vnd.google-apps.folder');
  holdingWasPresent = (await listChildren(reference.id)).some((item) => item.name === 'À traiter manuellement');
  const destinations = Object.fromEntries(await Promise.all(['invoices', 'meetings', 'quotes'].map(async (name) => {
    const item = exact(await listChildren(reference.id), name, 'application/vnd.google-apps.folder');
    return [name, item];
  })));
  evidence.destinations = Object.fromEntries(Object.entries(destinations).map(([name, item]) => [name, item.id]));
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
  const suppliedSource = existingFixtures.every(Boolean) ? 'user-supplied dedicated staging PDF' : 'runner-generated PNG upload';
  for (const item of supplied) {
    const snapshot = await metadata(item.id);
    fixtureSnapshots.push(snapshot);
    await restoreMetadata(snapshot.id, { ...snapshot, parents: [inputFolder.id] });
  }
  const extension = path.extname(supplied[0].name);
  const fixtureSpecs = [
    { key: 'confirm', item: supplied[0], proposedName: `Calendrier_CDA_Classe${extension}`, destination: 'invoices' },
    { key: 'reject', item: supplied[1], proposedName: `Document_Staging_Classe${path.extname(supplied[1].name)}`, destination: 'quotes' },
  ];
  evidence.fixtures = fixtureSpecs.map(({ key, item, proposedName, destination }) => ({ key, id: item.id, originalName: item.name, proposedName, destination, source: suppliedSource }));

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
  await seedRules(organizationId, fixtureSpecs, destinations);

  await chooseBrowserItem(page, 'stg_tree', 'Choisir ce dossier');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  for (const name of ['invoices', 'meetings', 'quotes']) await page.getByText(new RegExp(`/${name}$`)).waitFor();
  await chooseBrowserItem(page, runName, "Lancer l'organisation");
  const proposals = await waitForProposals(organizationId, 2);
  evidence.realDriveDownloadOcr = 'PASS';
  evidence.realProposalReview = 'PASS';
  await page.reload();
  await page.screenshot({ path: path.join(evidenceDir, 'live-google-sa-desktop-review.png'), fullPage: true });
  evidence.desktopBrowser = 'PASS';

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await copyCookies(context, mobile);
  await mobilePage.goto(`${webBase}/dashboard`);
  await mobilePage.getByText('Validation staging · identité de service Google').waitFor();
  await mobilePage.screenshot({ path: path.join(evidenceDir, 'live-google-sa-mobile-390.png'), fullPage: true });
  evidence.mobile390Browser = 'PASS';
  await mobile.close();

  const confirmed = proposalFor(proposals, supplied[0].id);
  const rejected = proposalFor(proposals, supplied[1].id);
  await page.locator(`[data-testid="proposal-${confirmed.id}"]`).getByRole('button', { name: /Valider le classement/ }).click();
  await page.locator(`[data-testid="proposal-${rejected.id}"]`).getByRole('button', { name: 'Retirer' }).click();
  await waitForTerminal(organizationId, 2);

  const confirmedMeta = await metadata(confirmed.document.externalId);
  assert(confirmedMeta.name === fixtureSpecs[0].proposedName && sameParents(confirmedMeta.parents, [destinations.invoices.id]), 'confirm metadata mismatch');
  evidence.realDriveConfirmMutation = 'PASS';
  const rejectedMeta = await metadata(rejected.document.externalId);
  const holding = exact(await listChildren(reference.id), 'À traiter manuellement', 'application/vnd.google-apps.folder');
  if (!holdingWasPresent) createdIds.push(holding.id);
  assert(rejectedMeta.name === supplied[1].name && sameParents(rejectedMeta.parents, [holding.id]), 'reject metadata mismatch');
  evidence.realDriveRejectMutation = 'PASS';

  const relaunch = await api(`/organizations/${organizationId}/drive/launch`, {
    method: 'POST', body: JSON.stringify({ itemExternalId: inputFolder.id }),
  });
  assert(relaunch.enqueued === 0, 'terminal documents were re-enqueued');
  evidence.terminalNoReenqueue = 'PASS';

  await restoreFixtures();
  await resetTenantData(organizationId);
  await seedRules(organizationId, [{ key: 'correct', item: supplied[0], proposedName: `Direct_Proposal${extension}`, destination: 'invoices' }], destinations);
  await page.goto(`${webBase}/dashboard`);
  await chooseBrowserItem(page, 'stg_tree', 'Choisir ce dossier');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  await chooseBrowserItem(page, supplied[0].name, "Lancer l'organisation");
  const directRows = await waitForProposals(organizationId, 1);
  const direct = proposalFor(directRows, supplied[0].id);
  await page.reload();
  const directCard = page.locator(`[data-testid="proposal-${direct.id}"]`);
  await directCard.getByRole('button', { name: 'Corriger' }).click();
  const correctedName = `Calendrier_CDA_Corrige${extension}`;
  await directCard.getByLabel('Nom final').fill(correctedName);
  await directCard.getByLabel('Dossier de destination').selectOption(destinations.meetings.id);
  await directCard.getByRole('button', { name: 'Confirmer la correction' }).click();
  await waitForTerminal(organizationId, 1);
  const correctedMeta = await metadata(supplied[0].id);
  assert(correctedMeta.name === correctedName && sameParents(correctedMeta.parents, [destinations.meetings.id]), 'direct correction metadata mismatch');
  evidence.realDriveCorrectMutation = 'PASS';
  const directRelaunch = await api(`/organizations/${organizationId}/drive/launch`, { method: 'POST', body: JSON.stringify({ itemExternalId: supplied[0].id }) });
  assert(directRelaunch.enqueued === 0, 'terminal direct file was re-enqueued');
} finally {
  if (browser) await browser.close().catch(() => undefined);
  await restoreFixtures().catch(() => undefined);
  for (const id of [...createdIds].reverse()) await trash(id).catch(() => undefined);
  if (organizationId) await cleanupTenant(organizationId).catch(() => undefined);
  evidence.cleanup = await cleanupVerified().catch(() => false) ? 'PASS' : 'FAIL';
  await stopApps(children).catch(() => { process.exitCode = 1; });
  await prisma.$disconnect();
  accessToken = undefined;
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (Object.entries(evidence).some(([key, value]) => key !== 'identity' && typeof value === 'string' && value !== 'PASS')) process.exitCode = 1;

function required(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
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
  const common = { ...process.env, NODE_ENV: 'test', DATABASE_URL: databaseUrl, MONGO_URL: mongoUrl, INTERNAL_API_SECRET: internalSecret, TOKEN_ENCRYPTION_KEY: tokenKey, KLASR_LOCAL_MVP: 'false', KLASR_INLINE_WORKER: 'true', KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: 'true', KLASR_GOOGLE_SERVICE_ACCOUNT_FILE: credentialPath, KLASR_GOOGLE_DRIVE_ROOT_ID: sharedRootId, ANTHROPIC_API_KEY: '' };
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
async function seedRules(id, specs, destinations) { for (let i = 0; i < specs.length; i += 1) { const { item, proposedName, destination } = specs[i]; await prisma.classificationRule.create({ data: { organizationId: id, priority: i + 1, destinationPath: `/${destination}`, suggestedNameTemplate: proposedName, conditions: { create: [{ field: 'FILENAME', operator: 'EQUALS', value: item.name }] } } }); assert(destinations[destination], 'Missing destination'); } }
async function cleanupTenant(id) { const rules = await prisma.classificationRule.findMany({ where: { organizationId: id }, select: { id: true } }); await prisma.actionHistory.deleteMany({ where: { organizationId: id } }); await prisma.classificationProposal.deleteMany({ where: { organizationId: id } }); await prisma.document.deleteMany({ where: { organizationId: id } }); await prisma.ruleCondition.deleteMany({ where: { ruleId: { in: rules.map((rule) => rule.id) } } }); await prisma.classificationRule.deleteMany({ where: { organizationId: id } }); await prisma.folder.deleteMany({ where: { organizationId: id } }); await prisma.organization.update({ where: { id }, data: { referenceRootExternalId: null, referenceRootName: null } }); }
async function api(route, init = {}) { const response = await fetch(`${apiBase}${route}`, { ...init, headers: { 'x-internal-secret': internalSecret, 'content-type': 'application/json', ...(init.headers ?? {}) } }); assert(response.ok, `API request failed (${response.status})`); return response.json(); }
async function chooseBrowserItem(page, name, action) { const submit = page.getByRole('button', { name: action }); const browserPanel = submit.locator('..'); await browserPanel.getByRole('list').waitFor({ timeout: 30_000 }); await page.waitForLoadState('networkidle'); const row = browserPanel.getByRole('button', { name, exact: true }).locator('..'); const radio = row.getByRole('radio'); await row.getByText('Sélectionner', { exact: true }).click(); await expect(radio).toBeChecked(); await expect(submit).toBeEnabled(); await submit.click(); }
async function waitForProposals(id, count) { for (let i = 0; i < 180; i += 1) { const rows = await prisma.classificationProposal.findMany({ where: { organizationId: id, status: 'PENDING' }, include: { document: true } }); if (rows.length === count) return rows; await delay(1000); } throw new Error('Real OCR did not produce expected proposals'); }
async function waitForTerminal(id, count) { for (let i = 0; i < 60; i += 1) { if (await prisma.document.count({ where: { organizationId: id, status: { in: ['CLASSIFIED', 'MANUAL'] } } }) === count) return; await delay(500); } throw new Error('Browser decisions did not reach terminal state'); }
function proposalFor(rows, externalId) { const row = rows.find((item) => item.document.externalId === externalId); assert(row, 'Missing proposal for provider fixture'); return row; }
async function copyCookies(from, to) { await to.addCookies(await from.cookies()); }
