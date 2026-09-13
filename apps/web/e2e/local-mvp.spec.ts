import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireFromApi = createRequire(path.resolve(process.cwd(), '../api/package.json'));
const { PrismaClient } = requireFromApi('@prisma/client');
const { MongoClient } = requireFromApi('mongodb');
const email = 'camille.local@klasr.test';
type RuleId = { id: string };

test.beforeEach(async () => {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/klasr',
      },
    },
  });
  const mongo = new MongoClient(process.env.MONGO_URL ?? 'mongodb://localhost:27017');
  try {
    await mongo.connect();
    await prisma.$executeRawUnsafe('DELETE FROM pgboss.job WHERE name = $1', 'analysis').catch(() => undefined);
    const membership = await prisma.membership.findFirst({
      where: { user: { email } },
      select: { organizationId: true, userId: true },
    });
    if (!membership) {
      await prisma.user.deleteMany({ where: { email } });
      return;
    }
    const organizationId = membership.organizationId;
    const rules = await prisma.classificationRule.findMany({
      where: { organizationId },
      select: { id: true },
    });
    await mongo.db('klasr').collection('analyses').deleteMany({ organizationId });
    await prisma.actionHistory.deleteMany({ where: { organizationId } });
    await prisma.classificationProposal.deleteMany({ where: { organizationId } });
    await prisma.document.deleteMany({ where: { organizationId } });
    await prisma.ruleCondition.deleteMany({ where: { ruleId: { in: rules.map((rule: RuleId) => rule.id) } } });
    await prisma.classificationRule.deleteMany({ where: { organizationId } });
    await prisma.folder.deleteMany({ where: { organizationId } });
    await prisma.usageMetric.deleteMany({ where: { organizationId } });
    await prisma.driveConnection.deleteMany({ where: { organizationId } });
    await prisma.membership.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: membership.userId } });
  } finally {
    await mongo.close().catch(() => undefined);
    await prisma.$disconnect();
  }
});

test('local sign-in selects a reference tree, launches Drive input, reviews corrections and ignore', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/login');
  await expect(page.getByText('Mode local')).toBeVisible();
  await page.getByText('Mode local').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page.getByText('Mode local')).toBeVisible();
  await expect(page.getByText('API hors ligne')).toHaveCount(0);

  await page.getByRole('link', { name: 'Paramètres IA', exact: true }).click();
  await page.getByText('Compatible', { exact: true }).click();
  await page.getByLabel('URL de base').fill('http://127.0.0.1:4310/v1');
  await page.getByLabel('Clé API').fill('synthetic-fixture-token');
  await page.getByRole('button', { name: 'Découvrir les modèles' }).click();
  await expect(page.getByLabel('Modèle').locator('option')).toHaveCount(2);
  await page.getByLabel('Modèle').selectOption('fixture-z');
  await page.getByRole('button', { name: 'Valider et enregistrer' }).click();
  await expect(page.getByRole('status')).toContainText('Configuration validée');
  await page.goto('/dashboard');

  const referenceResponse = page.waitForResponse((response) => response.url().endsWith('/api/drive/reference-root'));
  await page.getByRole('button', { name: /Choisir Cabinet de démonstration/ }).click();
  await expect((await referenceResponse).status()).toBe(200);
  await expect(page.getByText('/Comptabilité/Électricité')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('/Social/Paie')).toBeVisible();
  await page.screenshot({
    path: path.resolve(process.cwd(), `../../.tmp/hermes/drive-reference-organization-flow/local-${testInfo.project.name}-dashboard.sanitized.png`),
    fullPage: true,
  });

  const launchResponse = page.waitForResponse((response) => response.url().endsWith('/api/drive/launch'));
  await page.getByLabel('Élément Drive existant').selectOption('local_input_folder');
  await page.getByRole('button', { name: /Lancer l'organisation/ }).click();
  await expect((await launchResponse).status()).toBe(200);
  const proposalRows = page.locator('[data-testid^="proposal-"]');
  await expect(proposalRows).toHaveCount(4, { timeout: 30_000 });
  await expect(proposalRows.filter({ hasText: 'scan-facture-electricite.pdf' })).toBeVisible({ timeout: 30_000 });
  await expect(proposalRows.filter({ hasText: 'releve-banque-juillet.pdf' })).toBeVisible();
  await expect(proposalRows.filter({ hasText: 'note-paie-juillet.png' })).toBeVisible();
  await expect(proposalRows.filter({ hasText: 'archive.zip' })).toBeVisible();

  const factureCard = proposalRows.filter({ hasText: 'scan-facture-electricite.pdf' });
  await factureCard.getByRole('button', { name: 'Corriger', exact: true }).click();
  let correction = page.getByRole('dialog', { name: 'Éditer la proposition' });
  await correction.getByLabel('Nom du fichier proposé').fill('Facture_Electricite_2026-07.pdf');
  await correction.getByLabel('Dossier de destination').selectOption('local_folder_elec');
  await correction.getByRole('button', { name: 'Valider' }).click();

  const bankCard = proposalRows.filter({ hasText: 'releve-banque-juillet.pdf' });
  await bankCard.getByRole('button', { name: 'Corriger', exact: true }).click();
  correction = page.getByRole('dialog', { name: 'Éditer la proposition' });
  await correction.getByLabel('Nom du fichier proposé').fill('Releve_Banque_2026-07.pdf');
  await correction.getByLabel('Dossier de destination').selectOption('local_folder_banque');
  await correction.getByRole('button', { name: 'Valider' }).click();

  const ignoredCard = proposalRows.filter({ hasText: 'note-paie-juillet.png' });
  const ignoreButton = ignoredCard.getByRole('button', { name: 'Ignorer' });
  await expect(ignoreButton).toHaveAttribute('title', 'Ignorer cette proposition — le fichier reste à sa place');
  for (let presses = 0; presses < 30 && !(await ignoreButton.evaluate((button) => button === document.activeElement)); presses += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(ignoreButton).toBeFocused();
  await expect(ignoreButton).toHaveCSS('outline-width', '2px');
  await expect(ignoreButton).toHaveCSS('outline-style', 'solid');
  await expect(ignoredCard.getByRole('tooltip', { name: 'Ignorer cette proposition — le fichier reste à sa place' })).toBeVisible();
  await page.screenshot({
    path: path.resolve(process.cwd(), '../../.tmp/hermes/ux-clarity/evidence/item-4/screenshots/dashboard-ignore-tooltip-1280.png'),
    fullPage: true,
  });
  await ignoreButton.press('Enter');
  await proposalRows.filter({ hasText: 'archive.zip' }).getByRole('button', { name: 'Ignorer' }).click();

  await expect(proposalRows).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('Historique récent')).toBeVisible();
  await expect(page.getByText('Rien à valider')).toBeVisible();
  const history = page.locator('section[aria-label="Historique"]');
  await expect(history.getByText('Releve_Banque_2026-07.pdf')).toBeVisible();
  await expect(history.getByText('Ignoré', { exact: false })).toHaveCount(2);
  await expect(history).not.toContainText('/À traiter');
  await page.screenshot({
    path: path.resolve(process.cwd(), '../../.tmp/hermes/ux-clarity/evidence/item-4/screenshots/dashboard-ignore-history-1280.png'),
    fullPage: true,
  });
  await expect(page.getByText('Classés')).toBeVisible();
});
