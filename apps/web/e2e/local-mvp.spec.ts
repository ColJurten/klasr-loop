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

test('local sign-in selects a reference tree, launches Drive input, reviews corrections and rejection', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Mode local')).toBeVisible();
  await page.getByText('Mode local').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page.getByText('Mode local')).toBeVisible();
  await expect(page.getByText('API hors ligne')).toHaveCount(0);

  const referenceResponse = page.waitForResponse((response) => response.url().endsWith('/api/drive/reference-root'));
  await page.getByRole('button', { name: /Choisir Cabinet de démonstration/ }).click();
  await expect((await referenceResponse).status()).toBe(200);
  await expect(page.getByText('/Comptabilité/Électricité')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('/Social/Paie')).toBeVisible();

  const launchResponse = page.waitForResponse((response) => response.url().endsWith('/api/drive/launch'));
  await page.getByLabel('Élément Drive existant').selectOption('local_input_folder');
  await page.getByRole('button', { name: /Lancer l'organisation/ }).click();
  await expect((await launchResponse).status()).toBe(200);
  await page.waitForLoadState('networkidle');
  const proposalRows = page.locator('[data-testid^="proposal-"]');
  for (let attempt = 0; attempt < 15 && (await proposalRows.count()) < 3; attempt += 1) {
    await page.waitForTimeout(1000);
    await page.reload();
    await page.waitForLoadState('networkidle');
  }
  await expect(proposalRows.filter({ hasText: 'scan-facture-electricite.pdf' })).toBeVisible({ timeout: 30_000 });
  await expect(proposalRows.filter({ hasText: 'releve-banque-juillet.pdf' })).toBeVisible();
  await expect(proposalRows.filter({ hasText: 'note-paie-juillet.png' })).toBeVisible();

  await page.getByRole('button', { name: /Valider le classement de scan-facture-electricite.pdf/ }).click();

  await proposalRows.filter({ hasText: 'releve-banque-juillet.pdf' }).getByRole('button', { name: 'Corriger' }).click();
  await page.getByLabel('Nom final').fill('Releve_Banque_2026-07.pdf');
  await page.getByLabel('Dossier de destination').selectOption('local_folder_banque');
  await page.getByRole('button', { name: /Confirmer la correction/ }).click();

  await proposalRows.filter({ hasText: 'note-paie-juillet.png' }).getByRole('button', { name: 'Retirer' }).click();

  await expect(page.getByText('File terminée')).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByText('Historique récent')).toBeVisible();
  await expect(page.getByText('Rien à valider')).toBeVisible();
  const history = page.locator('section[aria-label="Historique"]');
  await expect(history.getByText('Releve_Banque_2026-07.pdf')).toBeVisible();
  await expect(history.getByText('/À traiter manuellement')).toBeVisible();
  await expect(page.getByText('Classés')).toBeVisible();
  await expect(page.getByText(/0 job\(s\), 0 actif\(s\), 0 échec\(s\)/)).toBeVisible();
});
