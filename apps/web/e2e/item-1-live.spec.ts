import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveItem1EvidenceProvenance, resolvePlaywrightRuntime } from '../playwright-runtime';

test.skip(process.env.KLASR_ITEM1_LIVE !== 'true', 'protected genuine-provider run only');

const requireFromApi = createRequire(path.resolve(process.cwd(), '../api/package.json'));
const { PrismaClient } = requireFromApi('@prisma/client');
const { compare } = requireFromApi('bcrypt');
const axeSource = readFileSync(path.resolve(process.cwd(), '../../node_modules/.pnpm/axe-core@4.12.1/node_modules/axe-core/axe.min.js'), 'utf8');
const credentialPath = path.resolve(process.cwd(), '../../.tmp/hermes/ux-clarity/.item1-staging-login.json');
const evidence = path.resolve(process.cwd(), '../../.tmp/hermes/ux-clarity/evidence/item-1');

test('genuine Google owner enrolls and uses one local identity', async ({ page }) => {
  test.setTimeout(180_000);
  const provenance = resolveItem1EvidenceProvenance(process.env);
  const credentials = JSON.parse(readFileSync(credentialPath, 'utf8')) as Record<string, unknown>;
  const email = secret(credentials, ['email', 'googleEmail', 'username']);
  const password = secret(credentials, ['password', 'googlePassword']);
  const localPassword = secret(credentials, ['localPassword', 'enrollmentPassword']);
  const prisma = new PrismaClient();
  const browserErrors: string[] = [];
  const report: Record<string, unknown> = { task: provenance.task, attempt: provenance.attempt, run: provenance.run, provider: 'google', genuineOAuth: false };
  page.on('console', message => { if (message.type() === 'error') browserErrors.push('console-error'); });
  page.on('pageerror', () => browserErrors.push('page-error'));

  try {
    await cleanup(prisma, email);
    expect(await prisma.user.count({ where: { email: normalize(email) } })).toBe(0);
    report.freshFixtureUserRows = 0;
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/login');
    const authorization = page.waitForRequest(request => request.url().startsWith('https://accounts.google.com/'));
    await page.getByRole('button', { name: 'Continuer avec Google' }).click();
    expect(new URL((await authorization).url()).searchParams.get('redirect_uri')).toBe(resolvePlaywrightRuntime(process.env).callbackUrl);
    await googleSignIn(page, email, password);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 60_000 });
    Object.assign(report, { genuineOAuth: true, verifiedGoogleCallback: true, callbackMatchedAuthorizedOrigin: true });

    await page.goto('/dashboard/settings');
    await expect(page.getByRole('heading', { name: 'Ajouter un mot de passe klasr' })).toBeVisible();
    await page.getByLabel('Nouveau mot de passe').fill(localPassword);
    await page.getByLabel('Confirmer le mot de passe local').fill(localPassword);
    await page.getByRole('button', { name: 'Ajouter mon mot de passe' }).click();
    await expect(page.getByRole('status')).toContainText('Mot de passe ajouté');
    await assertAxeAndFocus(page);
    await page.screenshot({ path: path.join(evidence, 'enrollment-success-1280.png'), fullPage: true });

    await page.getByRole('button', { name: 'Se déconnecter' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Adresse e-mail').fill(email);
    await page.getByLabel('Mot de passe', { exact: true }).fill(localPassword);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

    const state = await readback(prisma, email, localPassword);
    expect(state).toEqual({ users: 1, organizations: 1, ownerMemberships: 1, identityRecords: 1, duplicateIdentityRecords: 0, passwordPresent: true, bcryptFormat: true, passwordValid: true });
    Object.assign(report, state, { localLoginSameIdentity: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/dashboard/settings');
    await assertAxeAndFocus(page);
    await page.screenshot({ path: path.join(evidence, 'enrollment-account-375.png'), fullPage: true });
    expect(browserErrors).toEqual([]);
    report.browserErrors = 0;
    report.axeSeriousCritical = 0;
    report.keyboardFocus = true;
  } catch (error) {
    const gate = humanGate(error, page.url());
    if (gate) Object.assign(report, { status: 'human-gate', humanGate: gate });
    else Object.assign(report, { status: 'failed', failure: 'sanitized-product-or-runner-failure' });
    throw new Error(gate ? `HUMAN_GATE:${gate}` : 'sanitized-product-or-runner-failure');
  } finally {
    await page.context().clearCookies().catch(() => undefined);
    await cleanup(prisma, email).catch(() => undefined);
    const remaining = await prisma.user.count({ where: { email: normalize(email) } }).catch(() => -1);
    Object.assign(report, { cleanupUserRows: remaining, cleanupComplete: remaining === 0 });
    writeFileSync(path.join(evidence, provenance.outputFilename), JSON.stringify(report, null, 2));
    await prisma.$disconnect().catch(() => undefined);
  }
});

function secret(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  return '';
}

async function googleSignIn(page: import('@playwright/test').Page, email: string, password: string) {
  if (!email || !password) throw new Error('HUMAN_GATE:protected-credential-shape');
  const emailInput = page.locator('input[type="email"]');
  if (await emailInput.isVisible().catch(() => false)) {
    await emailInput.fill(email);
    await page.getByRole('button', { name: /Next|Suivant/ }).click();
  }
  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => { throw new Error('HUMAN_GATE:google-challenge'); });
  await passwordInput.fill(password);
  await page.getByRole('button', { name: /Next|Suivant/ }).click();
  const consent = page.getByRole('button', { name: /Continue|Continuer|Allow|Autoriser/ }).last();
  if (await consent.isVisible({ timeout: 10_000 }).catch(() => false)) throw new Error('HUMAN_GATE:google-consent');
  if (page.url().includes('accounts.google.com')) throw new Error('HUMAN_GATE:google-challenge');
}

async function readback(prisma: any, email: string, password: string) {
  const normalized = normalize(email);
  const users = await prisma.user.findMany({ where: { email: normalized }, include: { memberships: true } });
  const user = users[0];
  return {
    users: users.length,
    organizations: await prisma.organization.count({ where: { memberships: { some: { user: { email: normalized } } } } }),
    ownerMemberships: user?.memberships.filter(({ role }: { role: string }) => role === 'ADMIN').length ?? 0,
    identityRecords: users.length,
    duplicateIdentityRecords: Math.max(0, users.length - 1),
    passwordPresent: Boolean(user?.passwordHash),
    bcryptFormat: /^\$2[aby]\$12\$/.test(user?.passwordHash ?? ''),
    passwordValid: user?.passwordHash ? await compare(password, user.passwordHash) : false,
  };
}

async function cleanup(prisma: any, email: string) {
  const normalized = normalize(email);
  const users = await prisma.user.findMany({ where: { email: normalized }, include: { memberships: true } });
  for (const user of users) {
    const organizations = user.memberships.map(({ organizationId }: { organizationId: string }) => organizationId);
    await prisma.driveConnection.deleteMany({ where: { userId: user.id } });
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}

async function assertAxeAndFocus(page: import('@playwright/test').Page) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => (await (window as any).axe.run()).violations.filter(({ impact }: { impact: string }) => impact === 'serious' || impact === 'critical'));
  expect(violations).toEqual([]);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
}

function humanGate(error: unknown, url: string): string | null {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('HUMAN_GATE:')) return message.slice('HUMAN_GATE:'.length);
  return url.includes('accounts.google.com') ? 'google-challenge' : null;
}
function normalize(value: string) { return value.trim().toLowerCase(); }
