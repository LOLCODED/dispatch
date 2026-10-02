import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { startWorld, tickets } from './world.mjs';
import { client, seed } from './seed.mjs';

const assets = resolve(import.meta.dirname, '../../docs/assets');

// Playwright videos have no pointer, so each frame draws its own while the mouse is over it.
const cursorScript = () => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:2147483647;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(28,25,23,.35);border:2px solid #fff;box-shadow:0 0 0 1px rgba(28,25,23,.5);pointer-events:none;display:none;transition:transform .12s';
    document.body.append(dot);
    addEventListener('mousemove', event => { dot.style.display = 'block'; dot.style.left = `${event.clientX}px`; dot.style.top = `${event.clientY}px`; }, true);
    addEventListener('mouseover', event => { if (event.target.tagName === 'IFRAME') dot.style.display = 'none'; }, true);
    document.addEventListener('mouseleave', () => { dot.style.display = 'none'; });
    addEventListener('mousedown', () => { dot.style.transform = 'scale(.7)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = ''; }, true);
  });
};

export async function glide(page, locator, { click = true, steps = 24 } = {}) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
  await page.waitForTimeout(250);
  if (click) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

function toGif(video, out, startSeconds) {
  const filter = 'fps=10,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', startSeconds.toFixed(2), '-i', video, '-vf', filter, '-loop', '0', out]);
}

async function capture(browser, name, viewport, scene) {
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-readme-video-'));
  const context = await browser.newContext({ viewport, recordVideo: { dir, size: viewport } });
  await context.addInitScript(cursorScript);
  const opened = Date.now(), page = await context.newPage();
  let started = opened;
  await scene(page, () => { started = Date.now(); });
  await page.waitForTimeout(1200);
  await context.close();
  toGif(await page.video().path(), join(assets, `${name}.gif`), (started - opened) / 1000);
  rmSync(dir, { recursive: true, force: true });
  console.log(`docs/assets/${name}.gif`);
}

const scenes = {
  'dispatch-tasks': { viewport: { width: 1200, height: 980 }, scene: tasksScene },
  'dispatch-review': { viewport: { width: 1200, height: 860 }, scene: reviewScene },
  'dispatch-live-browser': { viewport: { width: 1200, height: 760 }, scene: liveBrowserScene },
};

async function tasksScene(page, begin, { url }) {
  await page.goto(url);
  await page.getByRole('button', { name: /^Tasks/ }).first().waitFor();
  begin();
  await page.waitForTimeout(600);
  await glide(page, page.getByRole('button', { name: /^Tasks/ }).first());
  await page.waitForTimeout(1600);
  for (const folder of ['Launch', 'Ideas']) {
    await glide(page, page.getByRole('button', { name: /All tasks|Launch|Ideas/ }).first());
    await page.waitForTimeout(500);
    await glide(page, page.getByRole('menuitem', { name: folder }));
    await page.waitForTimeout(1500);
  }
  await glide(page, page.getByRole('button', { name: /Ideas/ }).first());
  await glide(page, page.getByRole('menuitem', { name: 'All tasks' }));
  await page.waitForTimeout(900);
  await glide(page, page.getByRole('button', { name: 'Starred todos first' }));
  await page.waitForTimeout(1800);
  await glide(page, page.getByRole('button', { name: /completed/ }).last());
  await page.waitForTimeout(1500);
}

async function reviewScene(page, begin, { url, review }) {
  await page.goto(`${url}/runs/${review.id}`);
  await page.getByRole('button', { name: 'Try it yourself' }).waitFor();
  begin();
  await page.waitForTimeout(1200);
  await page.mouse.wheel(0, 380);
  await page.waitForTimeout(1400);
  await glide(page, page.getByRole('button', { name: 'Try it yourself' }));
  const app = page.frameLocator('.decision-app iframe');
  await app.getByLabel('New todo').waitFor();
  await page.waitForTimeout(800);
  await glide(page, app.getByLabel('New todo'));
  await page.keyboard.type('Pay the rent', { delay: 70 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await glide(page, app.getByLabel('Pay the rent'));
  await page.waitForTimeout(500);
  for (const filter of ['Done', 'Active', 'All']) { await glide(page, app.getByRole('button', { name: filter })); await page.waitForTimeout(900); }
  await glide(page, page.getByRole('link', { name: /Open app in a new tab/ }), { click: false });
  await page.waitForTimeout(1600);
  await glide(page, page.getByRole('group', { name: 'Answer choices' }).getByRole('button', { name: /Looks good/ }));
  await glide(page, page.getByRole('button', { name: 'Send answer' }));
  await page.getByText(/Ready|ready/).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
}

async function liveBrowserScene(page, begin, { url, project }) {
  const api = client(url);
  await api.call('/api/concurrency', { concurrency: 4 });
  const run = await api.start(project.id, tickets.count);
  await page.goto(`${url}/runs/${run.id}`);
  begin();
  await api.until(run.id, current => ['ready', 'failed', 'blocked'].includes(current.status));
  await page.waitForTimeout(2500);
}

const world = await startWorld();
const browser = await chromium.launch();
try {
  const context = { ...world, ...await seed(world.url, world.project) };
  const chosen = process.argv.slice(2);
  for (const [name, { viewport, scene }] of Object.entries(scenes)) {
    if (!chosen.length || chosen.includes(name)) await capture(browser, name, viewport, (page, begin) => scene(page, begin, context));
  }
} finally {
  await browser.close();
  await world.stop();
}
