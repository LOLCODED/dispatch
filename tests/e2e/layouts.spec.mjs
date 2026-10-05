import { test, expect } from './fixtures.mjs';
import { readyRun, view } from './ui-helpers.mjs';

const useLayout = (page, mode) => page.request.post('/api/settings', { data: { key: 'runs.layout', value: mode } });
const tile = (page, name) => page.getByRole('region', { name, exact: true });
const stream = (page, run) => page.route(`/api/runs/${run.id}/events`, route => route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(run)}\n\n` }));

test('vibe leaves the diff unloaded until asked, hides tool activity, and pauses games when focus leaves', { tag: '@ui' }, async ({ page, request }) => {
  const run = await readyRun(request, 'Vibe layout check'), diffs = [];
  page.on('request', item => { if (item.url().endsWith(`/api/runs/${run.id}/diff`)) diffs.push(item.url()); });
  await useLayout(page, 'vibe'); await page.goto(`/runs/${run.id}`);
  await expect(tile(page, 'Games')).toBeVisible(); await expect(tile(page, 'Chat')).toBeVisible();
  await expect(tile(page, 'Diff')).toHaveCount(0); await expect(page.locator('.activity-bundle')).toHaveCount(0);
  expect(diffs).toHaveLength(0);
  const arena = page.getByLabel(/^Snake\./);
  await arena.focus(); await page.keyboard.press('ArrowUp'); await expect(page.locator('.game-overlay')).toHaveCount(0);
  await tile(page, 'Chat').click(); await expect(page.locator('.game-overlay')).toContainText('Paused');
  await expect(page.getByRole('group', { name: 'Play something else' })).toBeVisible();
  await view(page, 'Diff'); await expect(tile(page, 'Diff')).toBeVisible(); await expect.poll(() => diffs.length).toBeGreaterThan(0);
});

test('vibe pins a question above the tiles without moving a full-screen game', { tag: '@ui' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json(), project = state.projects.find(item => item.name === 'Browser test repository');
  const run = await (await request.post('/api/runs', { data: { mode: 'live', projectId: project.id, input: 'Ask a scope question with Other' } })).json();
  await useLayout(page, 'vibe'); await page.goto(`/runs/${run.id}`);
  const bar = page.getByRole('region', { name: 'Codex needs your call' });
  await expect(bar.getByLabel('Answer Codex')).toBeVisible(); await expect(page.getByLabel('Answer Codex')).toHaveCount(1);
  await tile(page, 'Games').hover(); await page.keyboard.press('Alt+F'); await expect(page.locator('.tile')).toHaveCount(1); await expect(tile(page, 'Games')).toBeVisible();
  await page.getByLabel(/^Snake\./).focus(); await page.keyboard.press('ArrowUp');
  await expect(page.locator('.game-overlay')).toContainText('Answer the question to keep playing.');
  await bar.getByRole('button', { name: /Small/ }).click(); await bar.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(page.locator('.run-state')).toContainText('Ready for review'); await expect(bar).toHaveCount(0);
  await expect(tile(page, 'Games')).toBeVisible();
});

test('technical puts the diff first and keeps a live browser beside the chat', { tag: '@ui' }, async ({ page, request }) => {
  const ready = await readyRun(request, 'Technical layout check');
  await useLayout(page, 'technical'); await page.goto(`/runs/${ready.id}`);
  await expect(page.locator('.tile.is-primary')).toHaveClass(/tile-diff/); await expect(tile(page, 'Chat')).toBeVisible();
  const driving = await readyRun(request, 'Technical browser check');
  await stream(page, { ...driving, status: 'implementing', stepSummary: { ...driving.stepSummary, browser: 1 } });
  await page.goto(`/runs/${driving.id}`);
  await expect(page.getByRole('figure', { name: 'Live browser' })).toBeVisible(); await expect(tile(page, 'Chat')).toBeVisible();
  await expect(page.locator('.tiles')).not.toHaveClass(/is-full/);
});

test('settings preview each layout and save the choice', { tag: '@ui' }, async ({ page }) => {
  await page.goto('/setup#tiles');
  const cards = page.getByRole('group', { name: 'Run page layout' });
  await expect(cards.getByRole('button', { name: /^Default/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('group', { name: 'Preview step' }).getByRole('button', { name: /Asks a question/ }).click();
  await expect(cards.locator('.layout-mini-bar')).toHaveCount(1);
  await cards.getByRole('button', { name: /^Vibe/ }).click();
  await expect(cards.getByRole('button', { name: /^Vibe/ })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('dispatch-run-layout'))).toBe('vibe');
});
