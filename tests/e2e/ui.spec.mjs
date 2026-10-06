import { test, expect } from './fixtures.mjs';
import { exportRun, openTimeline, readyRun, selectChoice, view } from './ui-helpers.mjs';

async function bounded(page) {
  expect(await page.evaluate(() => document.documentElement.scrollHeight === innerHeight && document.documentElement.scrollWidth === innerWidth)).toBeTruthy();
}
const stream = (page, run) => page.route(`/api/runs/${run.id}/events`, route => route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(run)}\n\n` }));
const tile = (page, name) => page.getByRole('region', { name, exact: true });

test('dark and light modes persist and mobile composer has no overflow', { tag: '@ui' }, async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' }); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Switch to light mode' }).click(); await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click(); await page.getByRole('link', { name: 'All work', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('dispatch-v1-mobile.png'), fullPage: true });
});

test('composer keeps only essential pickers and keyboard shortcuts preserve typing', { tag: '@ui' }, async ({ page }) => {
  await page.goto('/');
  const task = page.getByLabel('Ticket or instructions');
  await expect(page.getByLabel('Model', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Repository', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Execution mode', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Repository options', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Parallel workers', { exact: true })).toHaveCount(0);
  await page.locator('h1').click(); await page.keyboard.press('/'); await expect(task).toBeFocused();
  await task.fill('Path'); await task.press('/'); await expect(task).toHaveValue('Path/');
  await page.keyboard.press('Escape'); await expect(task).toHaveValue('Path/');
});

test('shortcuts are rebound from the Keyboard settings, refuse conflicts and apply on home', { tag: '@ui' }, async ({ page }) => {
  await page.goto('/setup/keyboard');
  await page.getByRole('button', { name: 'Change shortcut: Tile full screen' }).click();
  await page.keyboard.press('/'); await expect(page.getByRole('alert')).toContainText('Focus the composer');
  await page.getByRole('button', { name: 'Change shortcut: Focus the composer' }).click();
  await page.keyboard.press('Alt+K'); await expect(page.locator('.shortcut-row').filter({ hasText: 'Focus the composer' })).toContainText('AltK');
  await page.getByRole('link', { name: 'All work' }).click();
  const task = page.getByLabel('Ticket or instructions');
  await expect(page.locator('.hints')).toContainText('Alt + K');
  await page.locator('h1').click(); await page.keyboard.press('/'); await expect(task).not.toBeFocused();
  await page.keyboard.press('Alt+K'); await expect(task).toBeFocused();
  await page.goto('/setup/keyboard'); await page.getByRole('button', { name: 'Reset all shortcuts' }).click();
  await expect(page.locator('.shortcut-row').filter({ hasText: 'Focus the composer' }).locator('kbd')).toHaveText('/');
});

test('tiles stack, promote, resize and persist their layout, and the default layout opens the diff once a task is ready', { tag: '@ui' }, async ({ page, request }) => {
  const run = await readyRun(request, 'Minimal interface check');
  await page.goto(`/runs/${run.id}`);
  await expect(tile(page, 'Chat')).toBeVisible(); await expect(tile(page, 'Diff')).toBeVisible();
  await page.keyboard.press('Alt+3'); await expect(tile(page, 'Checks')).toBeVisible();
  await page.getByRole('button', { name: 'Make Checks primary', exact: true }).click();
  await expect(page.locator('.tile.is-primary')).toHaveClass(/tile-checks/);
  const gutter = page.getByRole('separator', { name: 'Resize tiles' }), before = Number(await gutter.getAttribute('aria-valuenow'));
  await gutter.focus(); await page.keyboard.press('ArrowRight');
  await expect(gutter).toHaveAttribute('aria-valuenow', String(before + 4));
  await page.getByRole('button', { name: 'Close Diff', exact: true }).click(); await expect(tile(page, 'Diff')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.tile.is-primary')).toHaveClass(/tile-checks/); await expect(tile(page, 'Diff')).toBeVisible();
  await page.getByRole('button', { name: 'Close Diff', exact: true }).click(); await expect(tile(page, 'Diff')).toHaveCount(0);
  await view(page, 'Diff'); await view(page, 'Chat');
  await page.getByRole('button', { name: 'Make Chat primary', exact: true }).click();
  await page.getByRole('button', { name: 'Close Checks', exact: true }).click();
  await bounded(page);
});

test('dragging a tile by its title bar onto another tile swaps them', { tag: '@ui' }, async ({ page, request }) => {
  const run = await readyRun(request, 'Minimal interface check');
  await page.goto(`/runs/${run.id}`);
  await expect(tile(page, 'Chat')).toBeVisible(); await expect(tile(page, 'Diff')).toBeVisible();
  await expect(page.locator('.tile.is-primary')).toHaveClass(/tile-chat/);
  await tile(page, 'Diff').locator('.tile-bar').dragTo(tile(page, 'Chat'));
  await expect(page.locator('.tile.is-primary')).toHaveClass(/tile-diff/);
  await tile(page, 'Diff').locator('.tile-bar').dragTo(tile(page, 'Chat'));
  await expect(page.locator('.tile.is-primary')).toHaveClass(/tile-chat/);
});

test('long diffs and check output scroll inside their tiles, and diff lines become chat references', { tag: '@ui' }, async ({ page, request }, testInfo) => {
  const run = await readyRun(request, 'Minimal interface long diff'), lines = Array.from({ length: 160 }, (_, i) => `+page-line-${String(i).padStart(3, '0')} ${'x'.repeat(i === 159 ? 600 : 12)}`);
  await page.route(`/api/runs/${run.id}/diff`, route => route.fulfill({ json: { diff: `diff --git a/large.txt b/large.txt\n--- a/large.txt\n+++ b/large.txt\n@@ -0,0 +1,160 @@\n${lines.join('\n')}\n`, stale: false } }));
  const output = Array.from({ length: 200 }, (_, i) => `check-output-${String(i).padStart(3, '0')}`).join('\n');
  await stream(page, { ...run, artifacts: [], checks: [{ ...run.checks[0], output }] });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(viewport); await page.goto(`/runs/${run.id}`); await view(page, 'Diff');
    await expect(page.getByLabel('Changes in large.txt')).toBeVisible();
    const last = page.locator('.diff-line.after').last();
    await last.scrollIntoViewIfNeeded(); await expect(last).toBeInViewport();
    expect(await last.locator('code').textContent()).toBe(`page-line-159 ${'x'.repeat(600)}`);
    expect(await page.locator('.diff-output').evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
    await view(page, 'Checks'); await page.locator('.check-result summary').click();
    const tail = page.locator('.check-result pre'); await tail.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(tail).toContainText('check-output-199');
    await bounded(page); await page.screenshot({ path: testInfo.outputPath(`tiles-${viewport.width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(`/runs/${run.id}`); await view(page, 'Diff');
  const line3 = page.getByLabel('Reference large.txt line 3 in chat', { exact: true });
  await line3.click(); await expect(page.getByLabel('Continue this ticket')).toHaveValue('');
  await line3.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Continue this ticket')).toHaveValue('large.txt:3\n> page-line-002 xxxxxxxxxxxx\n');
  await expect(page.getByLabel('Continue this ticket')).toBeFocused();
  await page.reload(); await expect(page.getByLabel('Continue this ticket')).toHaveValue(/large\.txt:3/);
  await page.getByLabel('Continue this ticket').fill('');
  await expect(page.locator('.diff-output')).toHaveClass(/diff-split/);
  await page.getByLabel('Reference large.txt line 4 in chat', { exact: true }).locator('code').dragTo(page.getByLabel('Continue this ticket'));
  await expect(page.getByLabel('Continue this ticket')).toHaveValue('large.txt:4\n> page-line-003 xxxxxxxxxxxx\n');
  await page.getByLabel('Continue this ticket').fill('');
  const line = number => page.getByLabel(`Reference large.txt line ${number} in chat`, { exact: true });
  await line(7).click(); await line(5).click({ modifiers: ['Shift'] });
  await expect(page.locator('.diff-line.after.is-selected')).toHaveCount(3);
  await line(6).locator('code').dragTo(page.getByLabel('Continue this ticket'));
  await expect(page.getByLabel('Continue this ticket')).toHaveValue('large.txt:5-7\n> page-line-004 xxxxxxxxxxxx\n> page-line-005 xxxxxxxxxxxx\n> page-line-006 xxxxxxxxxxxx\n');
  await page.getByLabel('Continue this ticket').fill('');
  await line(6).focus(); await page.keyboard.press('Escape'); await expect(page.locator('.diff-line.is-selected')).toHaveCount(0);
});

test('question choices offer a typed answer beside the options and resume the same owner', { tag: '@ui' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json(), project = state.projects.find(project => project.name === 'Browser test repository');
  const run = await (await request.post('/api/runs', { data: { mode: 'live', projectId: project.id, input: 'Ask a scope question with Other' } })).json();
  await page.goto(`/runs/${run.id}`); await page.setViewportSize({ width: 360, height: 640 });
  await expect(page.getByLabel('Answer Codex')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Other answer', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Other', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send answer', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /Small/ }).focus(); await page.keyboard.press('b'); await expect(page.getByRole('button', { name: /Full/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Other answer', { exact: true }).fill('A focused custom scope');
  await page.reload(); await expect(page.getByLabel('Other answer', { exact: true })).toHaveValue('A focused custom scope'); await expect(page.getByRole('button', { name: 'Send answer', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Cancel run', exact: true })).toBeVisible();
  await bounded(page);
  await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(page.locator('.run-state')).toContainText('Ready for review');
  const result = await exportRun(request, run.id);
  expect(result.sessionId).toBe('browser-session'); expect(result.interactions[0].status).toBe('answered');
});

test('scrolling down moves the composer up and lists tasks below it, one row per conversation; scrolling up at the top hides them', { tag: '@ui' }, async ({ page, request }, testInfo) => {
  let workspace = await (await request.get('/api/workspace')).json();
  if (!workspace.runs.some(run => run.mode === 'live')) { await readyRun(request, 'Seed the task list'); workspace = await (await request.get('/api/workspace')).json(); }
  const template = workspace.runs.find(run => run.mode === 'live');
  const runs = Array.from({ length: 40 }, (_, index) => ({ ...template, id: `history-${index}`, title: `History task ${index}`, request: `Follow-up ${index}`, previousRunId: index % 4 ? `history-${index - 1}` : null, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), supersededBy: index % 4 === 3 ? null : `history-${index + 1}` }));
  await page.route('/api/workspace', route => route.fulfill({ json: { ...workspace, tasks: [], runs } }));
  await page.setViewportSize({ width: 360, height: 640 }); await page.goto('/');
  const composer = page.locator('form.composer');
  await expect(page.getByRole('region', { name: 'Tasks' })).toHaveCount(0); await expect(page.getByRole('button', { name: /^Tasks/ })).toBeVisible();
  let before = null;
  await expect.poll(async () => { const previous = before; await page.waitForTimeout(150); before = (await composer.boundingBox()).y; return before === previous; }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await page.mouse.move(180, 320); await page.mouse.wheel(0, 120);
  const tree = page.getByRole('region', { name: 'Tasks' }); await expect(tree).toBeVisible();
  await expect.poll(async () => (await composer.boundingBox()).y).toBeLessThan(before);
  expect((await tree.boundingBox()).y).toBeGreaterThan((await composer.boundingBox()).y);
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300); await page.mouse.wheel(0, -120);
  await expect(tree).toHaveCount(0);
  await expect.poll(async () => (await composer.boundingBox()).y).toBeCloseTo(before, 0);
  await page.keyboard.press('PageDown'); await expect(tree).toBeVisible();
  await expect(tree.locator('.board-row')).toHaveCount(10);
  await expect(tree.getByRole('link', { name: 'History task 36', exact: true })).toHaveAttribute('href', '/runs/history-39');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  for (const path of ['/setup', '/admin', '/admin/projects']) {
    await page.goto(path); await expect(page.getByRole('navigation', { name: 'Settings', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`${path.replaceAll('/', '-')}-mobile.png`) });
  }
});

test('the model picker links to provider setup while providers remain unconnected', { tag: '@ui' }, async ({ page }) => {
  await page.goto('/');
  await selectChoice(page, 'Model', '__add_provider__');
  await expect(page).toHaveURL(/\/setup\/integrations#providers$/);
  await expect(page.locator('#providers')).toBeInViewport();
});

test('the result drawer timeline steps through browser steps with visible controls and the keyboard, expands them inline, filters to browser steps, links a step, and fits a phone', { tag: '@ui' }, async ({ page, request }) => {
  const projects = await (await request.get('/api/projects')).json();
  const project = projects.find(item => item.name === 'Browser tool repository');
  const created = await (await request.post('/api/runs', { data: { mode: 'live', projectId: project.id, input: 'Drive the dispatch browser' } })).json();
  await expect.poll(async () => (await exportRun(request, created.id)).status, { timeout: 60000 }).toBe('ready');
  await page.goto(`/runs/${created.id}`);
  await expect(page.getByRole('group', { name: 'Tiles', exact: true }).getByRole('button', { name: 'Browser', exact: true })).toHaveCount(0);
  const timeline = await openTimeline(page);
  await expect(timeline.getByRole('list', { name: 'Steps' })).toBeVisible();
  await timeline.getByRole('button', { name: 'Browser only' }).click();
  const rows = timeline.locator('.step-row');
  await expect(rows).toHaveCount(5);
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  const before = await timeline.locator('.step-shot img').getAttribute('src');
  await timeline.getByRole('button', { name: 'Next step' }).click();
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true');
  await timeline.locator('.timeline-tile').focus(); await page.keyboard.press('ArrowRight');
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true');
  await expect(timeline.getByLabel('Step detail')).toContainText('click');
  await expect(timeline.locator('.target-box')).toBeAttached();
  expect(await timeline.locator('.step-shot img').getAttribute('src')).not.toBe(before);
  expect(page.url()).toMatch(/#step=\d+$/);
  await expect(timeline.getByLabel('Step detail')).toHaveCount(1);
  const detail = await timeline.getByLabel('Step detail').boundingBox(), row = await rows.nth(2).boundingBox(), next = await rows.nth(3).boundingBox();
  expect(detail.y).toBeGreaterThan(row.y); expect(detail.y).toBeLessThan(next.y);
  await timeline.getByRole('button', { name: 'Play browser steps' }).click();
  await expect(rows.nth(3)).toHaveAttribute('aria-current', 'true', { timeout: 15000 });
  await expect(timeline.getByRole('button', { name: 'Play browser steps' })).toHaveAttribute('aria-pressed', 'false');
  await rows.first().click();
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await timeline.getByLabel('Step detail').getByRole('button', { name: 'Reference in chat' }).click();
  await expect(page.getByLabel('Continue this ticket')).toHaveValue(/Step \d+: navigate/);
  await page.setViewportSize({ width: 390, height: 844 });
  await view(page, 'Result');
  await expect(timeline.getByRole('button', { name: 'Next step' })).toBeVisible();
  await expect(timeline.getByLabel('Step detail')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('a live browser run takes the run area with the latest action followed, and tiles take focus from the mouse and keyboard', { tag: '@ui' }, async ({ page, request }) => {
  const project = (await (await request.get('/api/projects')).json()).find(item => item.name === 'Browser tool repository');
  const created = await (await request.post('/api/runs', { data: { mode: 'live', projectId: project.id, input: 'Drive the dispatch browser live' } })).json();
  await expect.poll(async () => (await exportRun(request, created.id)).status, { timeout: 60000 }).toBe('ready');
  const run = await exportRun(request, created.id);
  expect(run.events.some(event => event.kind === 'browser')).toBe(true);
  await stream(page, { ...run, status: 'implementing' });
  await page.goto(`/runs/${run.id}`);
  const live = page.getByRole('figure', { name: 'Live browser' });
  await expect(live).toBeVisible(); await expect(page.locator('.tile')).toHaveCount(1);
  await expect(live.locator('img')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Scrub steps' })).toHaveCount(0);
  const feed = page.getByRole('list', { name: 'Browser actions' }), captions = feed.getByRole('listitem');
  await expect(captions).toHaveCount(5); await expect(captions.last()).toHaveAttribute('aria-current', 'step');
  await expect.poll(() => feed.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(36);
  await feed.evaluate(element => element.scrollTo({ top: 0 }));
  const latest = page.getByRole('button', { name: 'Latest', exact: true });
  await latest.click(); await expect(latest).toHaveCount(0);
  await bounded(page);
  await page.keyboard.press('Escape'); await expect(page.locator('.tile')).not.toHaveCount(1); await expect(live).toBeVisible();
  await tile(page, 'Chat').hover(); await expect(tile(page, 'Chat')).toHaveClass(/is-focused/);
  await page.keyboard.press('Alt+F'); await expect(page.locator('.tile')).toHaveCount(1); await expect(tile(page, 'Chat')).toBeVisible();
  await page.getByRole('group', { name: 'Tiles', exact: true }).getByRole('button', { name: 'Browser', exact: true }).click(); await expect(page.locator('.tile')).toHaveCount(1); await expect(live).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('.tile')).not.toHaveCount(1);
  await page.keyboard.press('Alt+1'); await expect(tile(page, 'Chat')).toHaveClass(/is-focused/);
});

test('release notes open after an update, not on a first visit', { tag: '@ui' }, async ({ page }) => {
  const release = { version: '9.9.9', date: '2026-10-01', groups: [{ label: 'Fixes', entries: [{ sha: 'abc1234', scope: 'demo', description: 'a fixed thing', breaking: false }] }] };
  await page.route(/\/api\/changelog/, route => route.fulfill({ json: { version: '9.9.9', releases: [release] } }));
  await page.goto('/'); await expect(page.getByLabel('Ticket or instructions')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Release Notes' })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('dispatch-seen-version', '0.0.1')); await page.reload();
  const notes = page.getByRole('dialog', { name: 'Release Notes' });
  await expect(notes).toContainText('a fixed thing'); await notes.getByRole('button', { name: 'Close' }).click();
  await page.reload(); await expect(page.getByLabel('Ticket or instructions')).toBeVisible(); await expect(notes).toHaveCount(0);
});

test('a setting changed through the settings API, as a task or the CLI would, shows on an open page without a reload', { tag: '@ui' }, async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await request.post('/api/settings', { data: { key: 'appearance.theme', value: 'dark' } });
  await page.evaluate(() => window.dispatchEvent(new Event('dispatch-refresh')));
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('dispatch-theme'))).toBe('dark');
});

test('the update alert names a newer release, copies dispatch update and waits until tomorrow', { tag: '@ui' }, async ({ page }) => {
  await page.route('/api/update', route => route.fulfill({ json: { current: '1.2.0', latest: '1.3.0', checkedAt: '2026-10-06T00:00:00.000Z', error: null, installed: true } }));
  await page.goto('/');
  const alert = page.getByRole('complementary', { name: 'Update alert' });
  await expect(alert).toContainText('dispatch 1.3.0 is available'); await expect(alert).toContainText('You have 1.2.0. Run dispatch update in a terminal');
  await expect(alert.getByRole('button', { name: 'Copy dispatch update' })).toBeVisible();
  await alert.getByRole('button', { name: 'Remind me tomorrow' }).click();
  await expect(alert).toBeHidden();
  await page.reload(); await expect(page.getByRole('complementary', { name: 'Update alert' })).toBeHidden();
});
