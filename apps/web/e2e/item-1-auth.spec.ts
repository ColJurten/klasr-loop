import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const requireFromApi = createRequire(path.resolve(process.cwd(), '../api/package.json'));
const { PrismaClient } = requireFromApi('@prisma/client');
const axeSource = readFileSync(path.resolve(process.cwd(), '../../node_modules/.pnpm/axe-core@4.12.1/node_modules/axe-core/axe.min.js'), 'utf8');
const email = 'item1-local-attempt4@klasr.test';
const password = 'Attempt4-secure-password!';
const evidence = path.resolve(process.cwd(), '../../.tmp/hermes/ux-clarity/evidence/item-1');

test.afterAll(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
    if (user) {
      const organizations = user.memberships.map(({ organizationId }: { organizationId: string }) => organizationId);
      await prisma.membership.deleteMany({ where: { userId: user.id } });
      await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    console.log(`cleanup_user_count=${await prisma.user.count({ where: { email } })}`);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
});

test('signup, logout, login and accessible branded screens', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'single deterministic lifecycle captures both required viewports');
  const browserErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()); });
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('response', response => { if (response.url().endsWith('/api/auth/register')) console.log(`registration_status=${response.status()}`); });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login');
  await captureLogin(page, '1280');
  await page.getByRole('button', { name: 'Créer un compte' }).click();
  await page.getByLabel('Nom affiché').fill('Item Un');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByLabel('Confirmer le mot de passe').fill(password);
  await page.getByRole('button', { name: 'Créer mon compte' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  const prisma = new PrismaClient();
  try {
    const localUser = await prisma.user.findUnique({ where: { email }, include: { memberships: true } });
    expect(localUser).toMatchObject({ email, memberships: [{ role: 'ADMIN' }] });
    expect(localUser?.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(localUser?.passwordHash).not.toContain(password);
    expect(await prisma.organization.count({ where: { memberships: { some: { user: { email } } } } })).toBe(1);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
  console.log('security=one_user_one_org bcrypt_cost=12 plaintext_absent');
  await assertAxe(page, '/dashboard-1280');
  await page.goto('/dashboard/settings'); await assertAxe(page, '/dashboard/settings-1280');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });

  await page.setViewportSize({ width: 375, height: 812 }); await page.goto('/login');
  await captureLogin(page, '375');
  await page.goto('/dashboard'); await assertAxe(page, '/dashboard-375');
  await page.goto('/dashboard/settings'); await assertAxe(page, '/dashboard/settings-375');
  expect(browserErrors).toEqual([]);
  console.log('browser_errors=0 lifecycle=signup-logout-login-dashboard');
});

async function captureLogin(page: import('@playwright/test').Page, viewport: string) {
  await assertAxe(page, `/login-${viewport}`);
  const microsoft = page.getByRole('button', { name: /Microsoft.*Bientôt disponible/ });
  await expect(microsoft).toBeVisible();
  await expect(microsoft).toBeDisabled();
  await expect(page.getByText(/liaison sûre.*propriété/i)).toBeVisible();
  await microsoft.click({ force: true });
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole('button', { name: 'Continuer avec Google' }).focus();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveText('Mode local');
  await page.screenshot({ path: `${evidence}/login-${viewport}-color.png`, fullPage: true });
  await page.evaluate(() => { document.documentElement.style.filter = 'grayscale(1)'; });
  await page.screenshot({ path: `${evidence}/login-${viewport}-grayscale.png`, fullPage: true });
  await page.evaluate(() => { document.documentElement.style.filter = ''; });
}

async function assertAxe(page: import('@playwright/test').Page, route: string) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => (await (window as unknown as { axe: { run(): Promise<{ violations: Array<{ id: string; impact: string }> }> } }).axe.run()).violations.filter(({ impact }) => impact === 'serious' || impact === 'critical'));
  console.log(`axe route=${route} serious_critical=${violations.map(({ id }) => id).join(',') || '0'}`);
  expect(violations).toEqual([]);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Tab');
  const focus = page.locator(':focus');
  await expect(focus).toBeVisible();
  expect(await focus.evaluate(element => Number.parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
  console.log(`keyboard_focus route=${route} visible=true`);
}
