import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const requireFromApi = createRequire(path.resolve(process.cwd(), '../api/package.json'));
const { PrismaClient } = requireFromApi('@prisma/client');
const axeSource = readFileSync(path.resolve(process.cwd(), '../../node_modules/.pnpm/axe-core@4.12.1/node_modules/axe-core/axe.min.js'), 'utf8');
const email = 'camille.local@klasr.test';
const evidence = path.resolve(process.cwd(), '../../.tmp/hermes/ux-clarity/evidence/item-2/screenshots');
let original: Record<string, unknown> | null = null;
let originalFolders: Array<Record<string, unknown>> = [];
let organizationId = '';

test.afterAll(async () => {
  if (!organizationId) return;
  const prisma = new PrismaClient();
  await prisma.llmSetting.deleteMany({ where: { organizationId } });
  if (original) await prisma.llmSetting.create({ data: original as never });
  await prisma.folder.deleteMany({ where: { organizationId } });
  if (originalFolders.length) await prisma.folder.createMany({ data: originalFolders as never });
  await prisma.$disconnect();
});

test('missing and validated dashboard states plus accessible provider picker', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login');
  await assertAxe(page, '/login');
  await page.getByRole('button', { name: 'Mode local' }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const prisma = new PrismaClient();
  const membership = await prisma.membership.findFirstOrThrow({ where: { user: { email } }, select: { organizationId: true } });
  organizationId = membership.organizationId;
  original = await prisma.llmSetting.findUnique({ where: { organizationId } });
  originalFolders = await prisma.folder.findMany({ where: { organizationId } });
  await prisma.llmSetting.deleteMany({ where: { organizationId } });
  await prisma.$disconnect();

  await page.goto('/dashboard');
  const chooseReference = page.getByRole('button', { name: 'Choisir Cabinet de démonstration' });
  if (await chooseReference.isVisible()) {
    await chooseReference.click();
    await expect(page.getByText('/Comptabilité/Électricité')).toBeVisible();
  }
  const onboarding = page.getByRole('heading', { name: 'Aucune clé LLM configurée' });
  await expect(onboarding).toBeVisible();
  const launch = page.getByRole('button', { name: /Lancer l'organisation/ });
  await expect(launch).toBeDisabled();
  await expect(page.locator('#llm-launch-help')).toContainText('analyse est bloquée');
  await assertAxe(page, '/dashboard missing');
  await page.screenshot({ path: `${evidence}/dashboard-missing-1280.png`, fullPage: true });

  await page.getByRole('link', { name: 'Configurer' }).click();
  await expect(page).toHaveURL(/\/dashboard\/settings/);
  await expect(page.getByRole('radiogroup', { name: 'Fournisseur' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(4);
  await assertAxe(page, '/dashboard/settings');
  await page.screenshot({ path: `${evidence}/settings-picker-1280.png`, fullPage: true });

  const anthropic = page.getByRole('radio', { name: 'Anthropic' });
  await anthropic.focus();
  await page.keyboard.press('ArrowRight');
  const openai = page.getByRole('radio', { name: 'OpenAI' });
  await expect(openai).toBeChecked();
  await expect(openai).toBeFocused();
  await expect(openai.locator('..')).toHaveCSS('outline-width', '2px');
  await page.screenshot({ path: `${evidence}/settings-keyboard-focus-1280.png`, fullPage: true });

  await page.getByText('Compatible', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Compatible' })).toBeChecked();
  const baseUrl = page.getByLabel('URL de base');
  await expect(baseUrl).toBeVisible();
  await expect(baseUrl).toHaveAttribute('required', '');
  await page.screenshot({ path: `${evidence}/settings-compatible-url-1280.png`, fullPage: true });
  await baseUrl.fill('http://127.0.0.1:4310/v1');
  await page.getByLabel('Clé API').fill('synthetic-fixture-token');
  await page.getByRole('button', { name: 'Découvrir les modèles' }).click();
  await expect(page.getByText('2 modèles disponibles.')).toBeVisible();
  await page.getByLabel('Modèle').selectOption('fixture-z');
  await page.getByRole('button', { name: 'Valider et enregistrer' }).click();
  await expect(page.getByText('Configuration validée et enregistrée.')).toBeVisible();
  await expect(page.getByLabel('Clé API')).toHaveValue('');

  await page.goto('/dashboard');
  await expect(onboarding).toHaveCount(0);
  await expect(page.getByRole('img', { name: 'Compatible' })).toBeVisible();
  await expect(page.getByText('fixture-z')).toBeVisible();
  await expect(page.getByText(/Validée le/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Lancer l'organisation/ })).toBeEnabled();
  await assertAxe(page, '/dashboard validated');
  await page.screenshot({ path: `${evidence}/dashboard-validated-1280.png`, fullPage: true });
});

async function assertAxe(page: import('@playwright/test').Page, route: string) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => (await (window as unknown as { axe: { run(): Promise<{ violations: Array<{ id: string }> }> } }).axe.run()).violations);
  console.log(`axe route=${route} violations=${violations.map(({ id }) => id).join(',') || '0'}`);
  expect(violations).toEqual([]);
}
