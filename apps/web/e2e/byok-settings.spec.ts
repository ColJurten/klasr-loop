import { expect, test, type Page, type Response } from '@playwright/test';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireFromApi = createRequire(path.resolve(process.cwd(), '../api/package.json'));
const { PrismaClient } = requireFromApi('@prisma/client');
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/klasr';
const wrongKey = 'wrong-synthetic-fixture-token';
const validKey = 'synthetic-fixture-token';
const dashboardDestinations = ['Tableau de bord', 'Arborescence', 'Historique', 'Règles', 'Membres', 'Templates', 'Paramètres IA'];

test.beforeEach(async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const membership = await prisma.membership.findFirst({ where: { user: { email: 'camille.local@klasr.test' } }, select: { organizationId: true, userId: true } });
    if (!membership) return;
    const organizationId = membership.organizationId; const rules = await prisma.classificationRule.findMany({ where: { organizationId }, select: { id: true } });
    await prisma.$executeRawUnsafe('DELETE FROM pgboss.job WHERE name = $1', 'analysis').catch(() => undefined);
    await prisma.actionHistory.deleteMany({ where: { organizationId } }); await prisma.classificationProposal.deleteMany({ where: { organizationId } }); await prisma.document.deleteMany({ where: { organizationId } });
    await prisma.ruleCondition.deleteMany({ where: { ruleId: { in: rules.map((rule: { id: string }) => rule.id) } } }); await prisma.classificationRule.deleteMany({ where: { organizationId } });
    await prisma.folder.deleteMany({ where: { organizationId } }); await prisma.usageMetric.deleteMany({ where: { organizationId } }); await prisma.driveConnection.deleteMany({ where: { organizationId } });
    await prisma.membership.deleteMany({ where: { organizationId } }); await prisma.organization.delete({ where: { id: organizationId } }); await prisma.user.delete({ where: { id: membership.userId } });
  } finally { await prisma.$disconnect(); }
});

/** Awaits the settings BFF round trip so a stale alert can never stand in for a real submission. */
function settingsCall(page: Page, method: 'POST' | 'PUT' | 'DELETE'): Promise<Response> {
  return page.waitForResponse((response) => response.url().endsWith('/api/llm-settings') && response.request().method() === method);
}

/** Next.js renders its own `#__next-route-announcer__` with role="alert", so target the form's own alert element. */
function settingsAlert(page: Page) {
  return page.locator('p[role="alert"]');
}

test('rejects a wrong key, then configures a tenant provider, drives analysis with its model, and removes it', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await page.goto('/login'); await page.getByText('Mode local').click(); await expect(page).toHaveURL(/\/dashboard/);
    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();
    expect(await nav.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(await nav.evaluate((element) => element.clientWidth));
    for (const label of dashboardDestinations) {
      const destination = nav.getByRole('link', { name: label, exact: true });
      await expect(destination).toBeVisible();
      const box = await destination.boundingBox();
      expect(box, `${label} must have a rendered box`).not.toBeNull();
      expect(box!.x, `${label} must not clip the nav's left edge`).toBeGreaterThanOrEqual(navBox!.x);
      expect(box!.x + box!.width, `${label} must not clip the nav or viewport's right edge`).toBeLessThanOrEqual(Math.min(navBox!.x + navBox!.width, page.viewportSize()!.width));
    }
    await nav.getByRole('link', { name: 'Paramètres IA', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings/);
    await expect(page.getByRole('heading', { name: 'Paramètres IA' })).toBeVisible();
    const membership = await prisma.membership.findFirstOrThrow({ where: { user: { email: 'camille.local@klasr.test' } } });
    const organizationId = membership.organizationId;

    // 1. A wrong synthetic key must fail against the real fixture socket, with redacted French feedback and no row.
    await page.getByLabel('Fournisseur').selectOption('openai-compatible');
    await page.getByLabel('Adresse de base').fill('http://127.0.0.1:4310/v1');
    await page.getByLabel('Clé API').fill(wrongKey);
    const rejectedDiscovery = settingsCall(page, 'POST');
    await page.getByRole('button', { name: 'Découvrir les modèles' }).click();
    const discoveryResponse = await rejectedDiscovery;
    expect(discoveryResponse.status()).toBe(400);
    expect(await discoveryResponse.json()).toEqual({ error: 'Clé API refusée par le fournisseur.' });
    await expect(settingsAlert(page)).toContainText('Clé API refusée par le fournisseur.');
    await expect(page.getByLabel('Modèle').locator('option')).toHaveCount(0);

    await page.getByLabel('Modèle').fill('fixture-z');
    const rejectedSave = settingsCall(page, 'PUT');
    await page.getByRole('button', { name: 'Valider et enregistrer' }).click();
    const rejectedSaveResponse = await rejectedSave;
    expect(rejectedSaveResponse.status()).toBe(400);
    expect(await rejectedSaveResponse.json()).toEqual({ error: 'Clé API refusée par le fournisseur.' });
    await expect(settingsAlert(page)).toContainText('Clé API refusée par le fournisseur.');
    expect(await page.locator('body').innerText()).not.toContain(wrongKey);
    expect(await prisma.llmSetting.count({ where: { organizationId } })).toBe(0);
    await expect(page.locator('section[aria-label="Configuration active"]')).toHaveCount(0);

    // 2. A valid key with a model the provider refuses is actionable, not "endpoint unavailable", and still saves nothing.
    await page.getByLabel('Clé API').fill(validKey);
    await page.getByLabel('Modèle').fill('fixture-legacy');
    const incompatibleSave = settingsCall(page, 'PUT');
    await page.getByRole('button', { name: 'Valider et enregistrer' }).click();
    const incompatibleResponse = await incompatibleSave;
    expect(incompatibleResponse.status()).toBe(400);
    expect((await incompatibleResponse.json()).error).toContain('pas compatible');
    await expect(settingsAlert(page)).toContainText('pas compatible');
    expect(await prisma.llmSetting.count({ where: { organizationId } })).toBe(0);

    // 3. The valid key discovers models, a non-default one is selected, validated and stored encrypted.
    await page.getByRole('button', { name: 'Découvrir les modèles' }).click();
    await expect(page.getByLabel('Modèle').locator('option')).toHaveCount(2);
    await page.getByLabel('Modèle').selectOption('fixture-z');
    await page.getByRole('button', { name: 'Valider et enregistrer' }).click();
    await expect(page.getByRole('status')).toContainText('Configuration validée');
    await expect(page.getByLabel('Clé API')).toHaveValue('');
    await expect(page.getByText('Compatible OpenAI · fixture-z')).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(validKey);
    await page.screenshot({ path: path.resolve(process.cwd(), `../../.tmp/hermes/BYOK-20260816/settings-${testInfo.project.name}.sanitized.png`), fullPage: true });

    const stored = await prisma.llmSetting.findUniqueOrThrow({ where: { organizationId } });
    expect(stored.encryptedApiKey).not.toContain(validKey);
    expect(stored.model).toBe('fixture-z');

    // 4. A real queued Drive analysis must run through the selected provider and model.
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Choisir Cabinet de démonstration/ }).click();
    await expect(page.getByText('/Comptabilité/Électricité')).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Élément Drive existant').selectOption('local_input_folder');
    const launch = page.waitForResponse((response) => response.url().endsWith('/api/drive/launch'));
    await page.getByRole('button', { name: /Lancer l'organisation/ }).click();
    expect((await launch).status()).toBe(200);
    await expect(page.locator('[data-testid^="proposal-"]')).toHaveCount(4, { timeout: 30_000 });
    await expect.poll(async () => prisma.classificationProposal.count({ where: { organizationId, modelUsed: { contains: 'openai-compatible/fixture-z' } } }), { timeout: 30_000 }).toBeGreaterThan(0);

    // 5. Reload discloses no key, and removal clears the UI and the row.
    await page.goto('/dashboard/settings');
    await expect(page.getByText('Compatible OpenAI · fixture-z')).toBeVisible();
    await expect(page.getByLabel('Clé API')).toHaveValue('');
    await page.getByRole('button', { name: 'Supprimer la configuration' }).click();
    await expect(page.getByRole('status')).toContainText('Configuration supprimée');
    await expect.poll(async () => prisma.llmSetting.count({ where: { organizationId } })).toBe(0);
  } finally { await prisma.$disconnect(); }
});
