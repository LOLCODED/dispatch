import { exportRun, readyRun } from './ui-helpers.mjs';
import { test, expect } from '@playwright/test';

test('live cancellation stays cancelled and does not produce handoff', { tag: '@tasks' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json();
  const response = await request.post('/api/runs', { data: { mode: 'live', projectId: state.projects[0].id, input: 'Cancel this live task' } }); const run = await response.json();
  await request.post(`/api/runs/${run.id}/cancel`, { data: {} }); await page.goto('/');
  await page.getByRole('button', { name: /^Tasks/ }).click(); await page.getByRole('link', { name: /Cancel this live task/ }).click(); await expect(page.locator('.run-state')).toContainText('Cancelled');
  expect((await exportRun(request, run.id)).handoff).toBeNull();
});

test('saves a request without running it, survives reload, and starts it once from the task list', { tag: '@tasks' }, async ({ page, request }) => {
  const before = await (await request.get('/api/state')).json();
  await page.goto('/');
  await page.getByLabel('Ticket or instructions').fill('/todo Build a site <script>not executable</script>');
  await page.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Task saved' })).toBeVisible();
  expect((await (await request.get('/api/state')).json()).runs.length).toBe(before.runs.length);
  await page.reload();
  await page.getByRole('button', { name: /^Tasks/ }).click();
  await expect(page.getByRole('region', { name: 'Todo' })).toContainText('Build a site <script>not executable</script>');
  await page.getByRole('button', { name: 'Change state: Build a site <script>not executable</script>', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Start', exact: true }).click();
  await page.getByRole('link', { name: 'Build a site <script>not executable</script>', exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/[a-f0-9-]+$/);
  await expect(page.locator('.run-state')).toContainText('Ready for review');
  const tasks = await (await request.get('/api/tasks')).json(), saved = tasks.find(task => task.title.startsWith('Build a site'));
  expect(saved.runId).toBe(page.url().split('/').at(-1));
  const retry = await (await request.post(`/api/tasks/${saved.id}/start`, { data: {} })).json(); expect(retry.id).toBe(saved.runId);
  expect((await (await request.get('/api/state')).json()).runs.length).toBe(before.runs.length + 1);
});

test('answers, pauses, files and archives tasks from the task list', { tag: '@tasks' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json(), projectId = state.projects[0].id;
  const status = id => exportRun(request, id);
  const blocked = await (await request.post('/api/runs', { data: { mode: 'live', projectId, input: 'Offer numbered choices' } })).json();
  await expect.poll(async () => (await status(blocked.id)).status).toBe('blocked');
  await page.goto('/'); await page.getByRole('button', { name: /^Tasks/ }).click();
  await page.getByRole('button', { name: 'All tasks' }).click(); await page.getByRole('menuitem', { name: 'New folder…' }).click();
  await page.getByLabel('New folder name').fill('Sprint 42'); await page.getByLabel('New folder name').press('Enter');
  await expect(page.getByRole('button', { name: 'Sprint 42', exact: true })).toBeVisible(); await expect(page.getByText('Nothing needs you')).toBeVisible();
  await page.getByRole('button', { name: 'Sprint 42', exact: true }).click(); await page.getByRole('menuitem', { name: 'All tasks' }).click();
  await page.getByRole('button', { name: 'Change state: Offer numbered choices' }).click();
  await page.getByRole('menuitem', { name: 'Move to folder' }).click(); await page.getByRole('menuitem', { name: 'Sprint 42' }).click();
  await page.getByRole('button', { name: 'All tasks' }).click(); await page.getByRole('menuitem', { name: 'Sprint 42' }).click();
  const decisions = page.getByRole('region', { name: /Needs decision · 1/ });
  await expect(decisions).toContainText('Which status code should expired tokens return?');
  await decisions.getByRole('button', { name: 'Reply…' }).click();
  await expect(decisions.getByLabel('Reply to Offer numbered choices')).toBeFocused();
  await expect(decisions.getByRole('button', { name: 'Return 401' })).toBeVisible();
  await decisions.getByLabel('Reply to Offer numbered choices').press('Escape');
  await decisions.getByRole('button', { name: 'Return 401' }).click();
  await expect(page.getByRole('region', { name: 'Ready for review' })).toContainText('Offer numbered choices', { timeout: 20000 });
  await expect(page.getByText('Nothing needs you')).toBeHidden();
  expect((await status(blocked.id)).supersededBy).toBeTruthy();
  const done = page.getByRole('region', { name: 'Ready for review' }).locator('.board-row').filter({ hasText: 'Offer numbered choices' });
  await done.hover(); await expect(done.locator('.board-row-time')).toBeVisible();
  await done.getByRole('button', { name: 'Change state: Offer numbered choices' }).click(); await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('button', { name: '1 archived' }).click(); await expect(page.locator('.board-archived')).toContainText('Offer numbered choices');
  await expect(page.getByText('Nothing needs you')).toBeVisible();

  const running = await (await request.post('/api/runs', { data: { mode: 'live', projectId, input: 'Wait for an interruption' } })).json();
  await expect.poll(async () => { const run = await status(running.id); return run.status === 'implementing' && Boolean(run.sessionId); }).toBe(true);
  const folders = (await (await request.get('/api/workspace')).json()).board.folders;
  await request.post(`/api/board/items/${running.id}`, { data: { folderId: folders.find(folder => folder.name === 'Sprint 42').id } });
  await page.getByRole('button', { name: 'Change state: Wait for an interruption' }).click(); await page.getByRole('menuitem', { name: 'Pause' }).click();
  const paused = page.getByRole('region', { name: /Needs decision/ });
  await expect(paused).toContainText('Paused'); expect((await status(running.id)).handoff).toBeNull();
  await paused.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('region', { name: 'Active' })).toContainText('Wait for an interruption');
  await page.getByRole('button', { name: 'Change state: Wait for an interruption' }).click(); await page.getByRole('menuitem', { name: 'Stop' }).click();
  await expect(page.getByRole('region', { name: 'Ready for review' })).toContainText('Wait for an interruption');
});

test('/todo in a run saves a Todo task that links back to the run, and /todo on home saves without starting', { tag: '@tasks' }, async ({ page, request }) => {
  const run = await readyRun(request, `Source run ${Date.now()}`), title = `Deferred header spacing ${Date.now()}`;
  await page.goto(`/runs/${run.id}`);
  await page.getByLabel('Continue this ticket').fill(`/todo ${title}\nKeep the mobile layout unchanged.`);
  await page.getByRole('button', { name: 'Save task to Todo', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: `Saved to Todo: ${title}` })).toBeVisible();
  await expect(page.getByLabel('Continue this ticket')).toHaveValue('');
  const saved = (await (await request.get('/api/tasks')).json()).find(task => task.title === title);
  expect(saved.sourceRunId).toBe(run.id); expect(saved.input).toContain('Keep the mobile layout unchanged.'); expect(saved.status).toBe('saved');
  await page.goto('/'); await page.getByRole('button', { name: /^Tasks/ }).click();
  const row = page.getByRole('region', { name: 'Tasks' }).locator('.board-row').filter({ hasText: title });
  await row.getByRole('link', { name: 'Open the run this task came from' }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${run.id}$`));
  const runs = (await (await request.get('/api/state')).json()).runs.length;
  await page.goto('/');
  await page.getByLabel('Ticket or instructions').fill(`/todo Update Browser test repository later ${Date.now()}`);
  await page.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Task saved to Todo.' })).toBeVisible();
  expect((await (await request.get('/api/state')).json()).runs.length).toBe(runs);
});
