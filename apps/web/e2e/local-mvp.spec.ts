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

test('local sign-in syncs, renders a proposal, confirms it, and shows completed state', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByText('Mode local')).toBeVisible();
  await page.getByText('Mode local').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  await expect(page.getByText('Mode local')).toBeVisible();
  await expect(page.getByText('API hors ligne')).toHaveCount(0);
  await seedLocalRule();
  const syncResponse = page.waitForResponse((response) => response.url().endsWith('/api/sync'));
  await page.getByRole('button', { name: /Synchroniser/ }).click();
  await expect((await syncResponse).status()).toBe(200);
  await page.reload();
  await expect(page.getByText('Facture_Electricite_2026-07.pdf')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Valider le classement/ }).first().click();
  await expect(page.getByText('File terminée')).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByText('Historique récent')).toBeVisible();
  await expect(page.getByText('Rien à valider')).toBeVisible();
  await expect(page.getByText('Facture_Electricite_2026-07.pdf')).toBeVisible();
  await expect(page.getByText('Classés')).toBeVisible();
  await expect(page.getByText(/0 job\(s\), 0 actif\(s\), 0 échec\(s\)/)).toBeVisible();
});

async function seedLocalRule() {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/klasr',
      },
    },
  });
  try {
    const membership = await prisma.membership.findFirstOrThrow({
      where: { user: { email } },
      select: { organizationId: true },
    });
    await prisma.classificationRule.create({
      data: {
        organizationId: membership.organizationId,
        priority: 1,
        destinationPath: '/Comptabilité/Électricité',
        suggestedNameTemplate: 'Facture_Electricite_2026-07.pdf',
        conditions: { create: [{ field: 'CONTENT', operator: 'CONTAINS', value: 'électricité' }] },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}
