import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://127.0.0.1:3000/demo', { waitUntil: 'networkidle' });
const result = await page.evaluate(() => {
  const width = window.innerWidth;
  return [...document.querySelectorAll('body *')]
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        className: typeof el.className === 'string' ? el.className : '',
        left: r.left,
        right: r.right,
        width: r.width,
        overflowX: getComputedStyle(el).overflowX,
      };
    })
    .filter((x) => x.right > width + 0.5 || x.left < -0.5)
    .sort((a, b) => b.right - a.right)
    .slice(0, 30);
});
console.log(JSON.stringify({ viewport: 390, scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth), offenders: result }, null, 2));
await page.screenshot({ path: '../hermes/one-shot-app/screenshots/demo-mobile-overflow.png', fullPage: true });
await browser.close();
