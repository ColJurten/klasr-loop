import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const axeSource = readFileSync(path.resolve(process.cwd(), '../../node_modules/.pnpm/axe-core@4.12.1/node_modules/axe-core/axe.min.js'), 'utf8');
const evidence = path.resolve(process.cwd(), '../../.tmp/hermes/ux-clarity/evidence/item-5');

test('Corriger opens the measured accessible overlay and validates only explicitly', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/demo');
  const trigger = page.locator('[data-testid="proposal-prop_demo_1"]').getByRole('button', { name: 'Corriger' });
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: 'Éditer la proposition' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog).toHaveCSS('width', '1120px');
  await expect(dialog).toHaveCSS('height', '800px');
  await expect(dialog.getByLabel('Nom du fichier proposé')).toBeFocused();
  await expect(dialog).toContainText('facture (12).pdf');
  await expect(dialog.getByLabel('Nom du fichier proposé')).toHaveValue('Facture_AWS_2026-07.pdf');
  await expect(dialog.getByLabel('Confiance 94 %, source IA')).toBeVisible();
  await expect(dialog).toContainText('Motif de l’analyse');
  await expect(dialog.getByRole('button', { name: 'Enregistrer sans valider' })).toHaveCount(0);

  const actions = await dialog.locator('footer button').allTextContents();
  expect(actions.map((value) => value.trim())).toEqual(['Restaurer la proposition', 'Annuler', 'Valider']);
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => (await (window as unknown as { axe: { run(): Promise<{ violations: Array<{ id: string }> }> } }).axe.run()).violations);
  expect(violations).toEqual([]);
  await page.screenshot({ path: `${evidence}/implementation-open-1280.png` });

  await dialog.getByLabel('Nom du fichier proposé').fill('bad/name.pdf');
  await expect(dialog.getByRole('alert')).toBeVisible();
  const invalidViolations = await page.evaluate(async () => (await (window as unknown as { axe: { run(): Promise<{ violations: Array<{ id: string }> }> } }).axe.run()).violations);
  expect(invalidViolations).toEqual([]);
  await dialog.getByRole('button', { name: 'Restaurer la proposition' }).click();

  const last = dialog.getByRole('button', { name: 'Valider' });
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Fermer' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.getByRole('button', { name: 'Fermer la correction par l’arrière-plan' }).click({ position: { x: 20, y: 20 } });
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
