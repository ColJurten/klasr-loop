import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireFromApi = createRequire(path.resolve(process.cwd(), '../api/package.json'));
const { PrismaClient } = requireFromApi('@prisma/client');
const email = 'camille.local@klasr.test';
let existingUserId: string | null;

test.beforeAll(async () => {
  const prisma = new PrismaClient();
  existingUserId = (await prisma.user.findUnique({ where: { email }, select: { id: true } }))?.id ?? null;
  console.log(`ordinary_prerequisite=${existingUserId ? 'existing' : 'created-by-test'}`);
  await prisma.$disconnect();
});

test.afterAll(async () => {
  if (existingUserId) return;
  const prisma = new PrismaClient();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, memberships: { select: { organizationId: true } } } });
  if (user) {
    const organizationIds = user.memberships.map(({ organizationId }: { organizationId: string }) => organizationId);
    await prisma.membership.deleteMany({ where: { userId: user.id } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.delete({ where: { id: user.id } });
  }
  await prisma.$disconnect();
});

test('ordinary authenticated user reaches the expected cloud onboarding mode', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login');
  await page.getByRole('button', { name: 'Mode local' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  if (process.env.KLASR_E2E_API_MODE !== 'production') {
    await expect(page.getByText('Mode local', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Bonjour/ })).toBeVisible();
    return;
  }
  const prisma = new PrismaClient();
  expect(await prisma.driveConnection.count({ where: { user: { email } } })).toBe(0);
  await prisma.$disconnect();
  await expect(page.getByText('Aucun stockage cloud connecté')).toBeVisible();
  await expect(page.getByText('Mode local', { exact: true })).toHaveCount(0);
  await expect(page.getByText('1. Dossier de référence')).toHaveCount(0);
  await expect(page.getByText('4. Suggestions à revoir')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Lancer l'organisation/ })).toHaveCount(0);
  await expect(page.getByLabel('Parcours indisponible')).toBeVisible();
  if (testInfo.project.name === 'desktop') {
    await page.screenshot({
      path: path.resolve(process.cwd(), '../../.tmp/hermes/ux-clarity/evidence/item-3/screenshots/unlinked-ordinary-production-1280.png'),
      fullPage: true,
    });
  }

  await page.getByRole('button', { name: 'Connecter', exact: true }).click();
  const google = page.getByRole('button', { name: 'Google Drive' });
  const oneDrive = page.getByRole('button', { name: /OneDrive.*Bientôt disponible/ });
  await expect(google).toBeVisible();
  await expect(oneDrive).toBeDisabled();
  await page.keyboard.press('Tab');
  await expect(google).toBeFocused();
  await expect(google).toHaveCSS('outline-width', '2px');
  if (testInfo.project.name === 'desktop') {
    await page.screenshot({
      path: path.resolve(process.cwd(), '../../.tmp/hermes/ux-clarity/evidence/item-3/screenshots/picker-ordinary-production-focus-1280.png'),
      fullPage: true,
    });
  }
});
