import { execFileSync } from 'node:child_process';
import { sign } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { chromium, expect } = createRequire(`${process.cwd()}/apps/web/package.json`)('@playwright/test');
const out = process.env.KLASR_E2E_OUTPUT || '.tmp/hermes/compose-e2e/probe';
mkdirSync(out, { recursive: true });
const times = { started: new Date().toISOString() }, steps = {};
let browser, token, before, fileId, organizationId, proposal = {}, failure;
const consoleErrors = [];
const rootId = process.env.KLASR_GOOGLE_DRIVE_ROOT_ID;
const dbEnv = { ...process.env, KLASR_DATABASE_URL: 'postgresql+psycopg://postgres:postgres@127.0.0.1:55432/klasr' };
const save = (name, value) => writeFileSync(`${out}/${name}`, `${JSON.stringify(value, null, 2)}\n`);
const assert = (value, message) => { if (!value) throw new Error(message); };
const stamp = (name) => { times[name] = new Date().toISOString(); };

async function auth() {
  const credentials = JSON.parse(readFileSync(process.env.KLASR_GOOGLE_SERVICE_ACCOUNT_FILE));
  const now = Math.floor(Date.now() / 1000), encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: credentials.token_uri, iat: now, exp: now + 3600 })}`;
  const assertion = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), credentials.private_key).toString('base64url')}`;
  const response = await fetch(credentials.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  assert(response.ok, `token ${response.status}`);
  return (await response.json()).access_token;
}

async function drive(path, init = {}) {
  const response = await fetch(`https://www.googleapis.com${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  assert(response.ok, `Drive ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function children(parent) {
  const query = new URLSearchParams({ q: `'${parent}' in parents and trashed=false`, fields: 'files(id,name,mimeType,parents,md5Checksum)', pageSize: '1000', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' });
  return (await drive(`/drive/v3/files?${query}`)).files;
}

const meta = id => drive(`/drive/v3/files/${id}?fields=id,name,parents,md5Checksum&supportsAllDrives=true`);
async function restore(id, target) {
  const current = await meta(id), query = new URLSearchParams({ supportsAllDrives: 'true', fields: 'id,name,parents,md5Checksum' });
  const add = target.parents.filter(parent => !current.parents.includes(parent));
  const remove = current.parents.filter(parent => !target.parents.includes(parent));
  if (add.length) query.set('addParents', add.join(','));
  if (remove.length) query.set('removeParents', remove.join(','));
  await drive(`/drive/v3/files/${id}?${query}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: target.name }) });
}

function db(...args) {
  return JSON.parse(execFileSync('apps/api-py/.venv/bin/python', ['scripts/live-google-db.py', ...args], { encoding: 'utf8', env: dbEnv }));
}

async function choose(page, mode, rowName, actionName) {
  const action = page.getByRole('button', { name: actionName });
  const panel = action.locator('..');
  await panel.getByRole('list').waitFor({ timeout: 30_000 });
  const navigation = panel.getByRole('button', { name: rowName, exact: true });
  await navigation.waitFor();
  const row = navigation.locator('..');
  const radio = row.locator(`input[type="radio"][name="drive-${mode}"]`);
  await radio.click();
  await page.waitForTimeout(300);
  if (!(await radio.isChecked())) {
    await radio.locator('..').click();
    await page.waitForTimeout(300);
  }
  await expect(radio).toBeChecked({ timeout: 10_000 });
  await expect(action).toBeEnabled({ timeout: 10_000 });
  await action.click();
}

try {
  token = await auth();
  const matches = (await children(rootId)).filter(item => item.name === 'doc3.pdf' && item.mimeType === 'application/pdf');
  assert(matches.length === 1, `doc3 count ${matches.length}`);
  fileId = matches[0].id;
  before = await meta(fileId);
  save('drive-before.json', before); stamp('driveBefore'); steps.driveBefore = 'PASS';

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(`${new Date().toISOString()} console.error: ${message.text()}`);
  });
  page.on('pageerror', error => consoleErrors.push(`${new Date().toISOString()} pageerror: ${error.stack || error.message}`));
  await page.goto('http://localhost:3100/login');
  await page.getByRole('button', { name: 'Validation Google staging' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 }); stamp('login'); steps.login = 'PASS';

  const tenant = db('tenant'); organizationId = tenant.organizationId; assert(organizationId, 'tenant missing');
  db('reset', organizationId);
  await page.goto('http://localhost:3100/dashboard/settings');
  await page.getByRole('radio', { name: 'Anthropic' }).check();
  await page.getByLabel('Clé API').fill(process.env.KLASR_LLM_API_KEY);
  await page.getByLabel('Modèle').fill(process.env.KLASR_LLM_MODEL);
  const [saved] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/llm-settings') && response.request().method() === 'PUT'), page.getByRole('button', { name: 'Valider et enregistrer' }).click()]);
  assert(saved.ok(), `LLM save ${saved.status()}`); stamp('llmSave'); steps.llmSave = 'PASS';

  await page.goto('http://localhost:3100/dashboard');
  await choose(page, 'folder', 'stg_tree', 'Choisir ce dossier');
  await page.getByText(/\/invoices$/).waitFor({ timeout: 30_000 }); stamp('referenceTree'); steps.referenceTree = 'PASS';

  await choose(page, 'input', 'doc3.pdf', "Lancer l'organisation");
  stamp('launch'); steps.launch = 'PASS';
  const card = page.locator('[data-testid^="proposal-"]').filter({ hasText: 'doc3.pdf' });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && !(await card.count())) {
    assert(!(await page.getByText('Analyse interrompue', { exact: false }).count()), 'Analyse interrompue appeared during in-flight job');
    await page.waitForTimeout(500);
  }
  assert(await card.count(), 'proposal timeout'); stamp('proposal'); steps.proposal = 'PASS without reload';
  await card.screenshot({ path: `${out}/proposal-card.png` });
  const confidenceLabel = await card.locator('[aria-label^="Confiance "]').getAttribute('aria-label');
  proposal.confidence = Number(confidenceLabel.match(/Confiance (\d+) %/)[1]) / 100;
  proposal.suggestedName = (await card.getByText(/^→ /).textContent()).replace(/^→\s*/, '').trim();
  proposal.destination = (await card.locator('p span.font-mono').last().textContent()).trim();
  proposal.reviewRequired = await card.getByText('à vérifier', { exact: true }).isVisible();
  Object.assign(proposal, db('proposal', organizationId, fileId));
  save('proposal-detail.json', proposal);

  await page.screenshot({ path: `${out}/confirm-action.png`, fullPage: true });
  const direct = card.getByRole('button', { name: `Valider le classement de doc3.pdf` });
  if (await direct.isEnabled()) await direct.click();
  else {
    steps.correction = 'REQUIRED';
    await card.getByRole('button', { name: 'Corriger' }).click();
    const dialog = page.getByRole('dialog');
    if (!proposal.destination) await dialog.getByRole('combobox').selectOption({ label: /invoices/ });
    await dialog.getByRole('button', { name: 'Valider' }).click();
  }
  await expect(card).toHaveCount(0, { timeout: 30_000 }); stamp('confirm'); steps.confirm = 'PASS';
  await page.screenshot({ path: `${out}/confirm-action-result.png`, fullPage: true });
  const mutated = await meta(fileId); save('drive-mutated.json', mutated); stamp('driveMutated');
  assert(mutated.name !== before.name && JSON.stringify(mutated.parents) !== JSON.stringify(before.parents), 'rename+move mutation not observed');
  steps.driveMutation = 'PASS';
} catch (error) {
  failure = String(error?.message || error);
} finally {
  if (fileId && before) {
    try {
      await restore(fileId, before);
      const restored = await meta(fileId); save('drive-restored.json', restored); stamp('driveRestored');
      assert(restored.name === before.name && JSON.stringify(restored.parents) === JSON.stringify(before.parents) && restored.md5Checksum === before.md5Checksum, 'restore mismatch');
      steps.driveRestore = 'PASS';
    } catch (error) { steps.driveRestore = `FAIL: ${error.message}`; failure ||= steps.driveRestore; }
  }
  await browser?.close().catch(() => {});
  save('console-errors.txt', consoleErrors.join('\n'));
  const restored = (() => { try { return JSON.parse(readFileSync(`${out}/drive-restored.json`)); } catch { return {}; } })();
  save('flow-report.json', {
    verdict: failure ? 'FAIL' : 'PENDING_WORKER_EVIDENCE', revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    timestamps: times, steps, observations: { interruptedEver: failure?.includes('Analyse interrompue') || false, noReload: steps.proposal === 'PASS without reload' }, proposal,
    md5Equality: before ? { before: before.md5Checksum, restored: restored.md5Checksum, equal: restored.md5Checksum === before.md5Checksum } : null,
    failure: failure || null,
  });
}
if (failure) process.exitCode = 1;
