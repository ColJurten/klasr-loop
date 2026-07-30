import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = 'http://127.0.0.1:3000';
const evidenceDir = path.resolve('../hermes/one-shot-app');
const screenshotDir = path.join(evidenceDir, 'screenshots');
await fs.mkdir(screenshotDir, { recursive: true });

const result = {
  base,
  browser: null,
  pages: {},
  interactions: {},
  consoleErrors: [],
  pageErrors: [],
  failedResponses: [],
  externalRequests: [],
  screenshots: [],
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ headless: true });
result.browser = await browser.version();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'light',
  locale: 'fr-FR',
});
const page = await context.newPage();

page.on('console', (message) => {
  if (message.type() === 'error') result.consoleErrors.push(message.text());
});
page.on('pageerror', (error) => result.pageErrors.push(error.message));
page.on('response', (response) => {
  if (response.status() >= 400) {
    result.failedResponses.push({ status: response.status(), url: response.url() });
  }
});
page.on('request', (request) => {
  const url = new URL(request.url());
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    result.externalRequests.push(request.url());
  }
});

await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { level: 1 }).waitFor();
const landingShot = path.join(screenshotDir, 'landing-desktop.png');
await page.screenshot({ path: landingShot, fullPage: true });
result.screenshots.push(landingShot);
result.pages.landing = {
  title: await page.title(),
  h1: await page.getByRole('heading', { level: 1 }).innerText(),
  hasDemoLink: await page.getByRole('link', { name: 'Ouvrir la démo locale' }).isVisible(),
  noHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
};

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Se connecter' }).waitFor();
const loginShot = path.join(screenshotDir, 'login-desktop.png');
await page.screenshot({ path: loginShot, fullPage: true });
result.screenshots.push(loginShot);
result.pages.login = {
  heading: await page.getByRole('heading', { level: 1 }).innerText(),
  googleOAuthAction: await page.getByRole('button', { name: /Google/i }).isVisible(),
  microsoftOAuthAction: await page.getByRole('button', { name: /Microsoft/i }).isVisible(),
  noHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
};

await page.goto(`${base}/demo`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Validation de classement' }).waitFor();
const initialCards = await page.locator('[data-testid^="proposal-"]').count();
assert(initialCards === 4, `Expected 4 demo proposals, got ${initialCards}`);
assert(await page.getByRole('button', { name: 'Tout valider' }).isVisible(), 'Missing Tout valider action');
const bodyFont = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
const monoFont = await page.locator('.font-mono').first().evaluate((el) => getComputedStyle(el).fontFamily);
assert(bodyFont.includes('Inter'), `Body did not resolve Inter: ${bodyFont}`);
assert(monoFont.includes('JetBrains Mono'), `Mono text did not resolve JetBrains Mono: ${monoFont}`);

const demoInitialShot = path.join(screenshotDir, 'demo-initial-desktop.png');
await page.screenshot({ path: demoInitialShot, fullPage: true });
result.screenshots.push(demoInitialShot);

const firstCard = page.locator('[data-testid^="proposal-"]').first();
await firstCard.getByRole('button', { name: 'Corriger' }).click();
const dialog = firstCard.getByRole('dialog');
await dialog.waitFor();
assert(await dialog.getByLabel('Dossier de destination').isVisible(), 'Correction destination field missing');
const correctionShot = path.join(screenshotDir, 'demo-correction-dialog.png');
await page.screenshot({ path: correctionShot, fullPage: true });
result.screenshots.push(correctionShot);
await dialog.getByRole('button', { name: /fermer/i }).click();
assert(!(await dialog.isVisible()), 'Correction dialog did not close');

const retryCard = page.getByTestId('proposal-prop_demo_retry');
await retryCard.getByRole('button', { name: /valider/i }).click();
await retryCard.getByText(/classement a échoué/i).waitFor();
assert(await retryCard.getByRole('button', { name: /réessayer/i }).isVisible(), 'Retry action missing after simulated failure');
result.interactions.retryFailureShown = true;
await retryCard.getByRole('button', { name: /réessayer/i }).click();
await retryCard.waitFor({ state: 'detached' });
result.interactions.retrySucceeded = true;

await page.getByRole('button', { name: 'Tout valider' }).click();
await page.getByRole('heading', { name: 'File terminée' }).waitFor();
result.interactions.bulkValidationReachedEmptyState = true;
const finalShot = path.join(screenshotDir, 'demo-complete-desktop.png');
await page.screenshot({ path: finalShot, fullPage: true });
result.screenshots.push(finalShot);

result.pages.demoDesktop = {
  initialCards,
  bodyFont,
  monoFont,
  hasRGPDBanner: await page.getByRole('heading', { name: /RGPD et contrôle utilisateur/i }).isVisible(),
  noHorizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
};

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/demo`, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: 'Validation de classement' }).waitFor();
const mobileOverflow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
  ok: document.documentElement.scrollWidth <= window.innerWidth,
}));
assert(mobileOverflow.ok, `Mobile horizontal overflow: ${JSON.stringify(mobileOverflow)}`);
const mobileShot = path.join(screenshotDir, 'demo-mobile.png');
await page.screenshot({ path: mobileShot, fullPage: true });
result.screenshots.push(mobileShot);
result.pages.demoMobile = mobileOverflow;

result.externalRequests = [...new Set(result.externalRequests)];
assert(result.consoleErrors.length === 0, `Console errors: ${result.consoleErrors.join(' | ')}`);
assert(result.pageErrors.length === 0, `Page errors: ${result.pageErrors.join(' | ')}`);
assert(result.failedResponses.length === 0, `Failed responses: ${JSON.stringify(result.failedResponses)}`);
assert(result.externalRequests.length === 0, `External runtime requests: ${result.externalRequests.join(', ')}`);

await browser.close();
await fs.writeFile(path.join(evidenceDir, 'VISUAL_VERIFICATION.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
