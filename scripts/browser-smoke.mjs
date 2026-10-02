import { chromium } from 'playwright';

const option = name => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : undefined; };
const url = option('url'), screenshot = option('screenshot'), timeout = Number(option('timeout') ?? 15000);
const report = { status: null, title: '', pageErrors: [], consoleErrors: [], screenshot: false };
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => report.pageErrors.push(String(error?.message ?? error).slice(0, 500)));
  page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push({ text: message.text().slice(0, 500), url: message.location()?.url ?? '' }); });
  const response = await page.goto(url, { waitUntil: 'load', timeout });
  report.status = response?.status() ?? null;
  try { await page.waitForLoadState('networkidle', { timeout: 5000 }); } catch {}
  await page.waitForTimeout(500);
  report.title = await page.title();
  if (screenshot) { await page.screenshot({ path: screenshot }); report.screenshot = true; }
} catch (error) {
  report.error = String(error?.message ?? error).slice(0, 2000);
} finally {
  await browser?.close().catch(() => {});
}
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.error ? 1 : 0);
