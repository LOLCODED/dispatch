import { answerRepository, exportRun, readyRun, selectChoice, view } from './ui-helpers.mjs';
import { test, expect } from '@playwright/test';

test('central composer drives a real worktree, streams checks, shows diff and continues the session', { tag: '@run' }, async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Give it somewhere to go.' })).toBeVisible();
  await page.getByLabel('Ticket or instructions').fill('Update the value <script>throw new Error("unsafe")</script>');
  await answerRepository(page, 'Browser test repository');
  const [created] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/runs') && response.status() === 201), page.getByRole('button', { name: 'dispatch', exact: true }).click()]);
  expect((await created.json()).execution).toMatchObject({ provider: 'codex', mode: 'auto' });
  await expect(page).toHaveURL(/\/runs\/[a-f0-9-]+$/);
  const runPage = page.locator('main.run-page');
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.locator('.run-state')).toContainText('Ready for review');
  await expect(page.getByRole('region', { name: 'Chat', exact: true })).toBeVisible();
  await expect(page.getByLabel('Conversation history')).toContainText('Mandatory check');
  await expect(page.getByLabel('Conversation history')).toContainText('passed');
  await view(page, 'Checks');
  await expect(page.locator('.check-result').first()).toContainText('passed');
  await view(page, 'Diff'); await expect(page.locator('.diff-line.before')).toContainText('original'); await expect(page.locator('.diff-line.after')).toContainText('changed');
  await page.getByLabel('Continue this ticket').fill('Check this once more');
  const [followupResponse] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/followup') && response.status() === 201), page.getByRole('button', { name: 'Continue', exact: true }).click()]);
  const followup = await followupResponse.json(); await expect(runPage).toHaveAttribute('data-run-id', followup.id);
  await expect(page.locator('.run-state')).toContainText('Ready for review');
  await page.reload(); await expect(page.locator('.run-state')).toContainText('Ready for review');
  await expect(page.getByLabel('Turn 1', { exact: true })).toContainText('Historical evidence');
  await expect(page.getByLabel('Turn 2', { exact: true })).toContainText('Check this once more');
  await expect(page.getByLabel('Turn 1', { exact: true })).toContainText('Mandatory check');
  await page.screenshot({ path: testInfo.outputPath('dispatch-run-desktop.png'), fullPage: true });
  await page.getByRole('link', { name: 'All work', exact: true }).click();
  await page.getByRole('button', { name: /^Tasks/ }).click();
  const row = page.locator('.board-row').filter({ hasText: 'Update the value' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('a')).toHaveAttribute('href', `/runs/${followup.id}`);
  await page.screenshot({ path: testInfo.outputPath('dispatch-v1-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('a working turn shows live progress and can be interrupted with new instructions', { tag: '@run' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json();
  const first = await (await request.post('/api/runs', { data: { mode: 'live', projectId: state.projects[0].id, input: 'Wait for an interruption' } })).json();
  await page.goto(`/runs/${first.id}`);
  await expect(page.getByRole('status', { name: 'Codex is working' })).toBeVisible();
  await expect(page.locator('.streaming-message')).toContainText('planning the change');
  await expect(page.getByRole('region', { name: 'Diff', exact: true })).toHaveCount(0);
  await page.getByLabel('Continue this ticket').fill('Use changed instead');
  const [response] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/interrupt') && response.status() === 201), page.getByRole('button', { name: 'Interrupt', exact: true }).click()]);
  const next = await response.json(); expect(next.sessionId).toBe('browser-session');
  await expect(page.locator('main.run-page')).toHaveAttribute('data-run-id', next.id);
  await expect(page.locator('.run-state')).toContainText('Ready for review');
  await expect(page.getByRole('region', { name: 'Diff', exact: true })).toBeVisible();
  const previous = await exportRun(request, first.id);
  expect(previous.status).toBe('cancelled'); expect(previous.handoff).toBeNull();
});

test('retains screenshots and traces from browser checks', { tag: '@run' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json();
  const response = await request.post('/api/runs', { data: { mode: 'live', projectId: state.projects[0].id, input: 'Watch a browser check' } }); const run = await response.json();
  await page.goto('/'); await page.getByRole('button', { name: /^Tasks/ }).click(); await page.getByRole('link', { name: /Watch a browser check/ }).click();
  await expect(page.locator('.run-state')).toContainText('Ready for review', { timeout: 20000 });
  await expect(page.getByRole('group', { name: 'Tiles' }).getByRole('button', { name: 'Browser', exact: true })).toHaveCount(0);
  const history = page.getByLabel('Conversation history');
  await expect(history).toContainText(/Browser evidence · .+ · attempt 1 · 2 files/);
  await expect(history.getByRole('button', { name: 'Preview test-results/result.png', includeHidden: true })).toBeAttached();
  await expect(history.getByRole('link', { name: /Download .*trace\.zip/, includeHidden: true })).toBeAttached();
  await page.reload();
  await expect(history.getByRole('link', { name: /Download .*trace\.zip/, includeHidden: true })).toBeAttached();
  await view(page, 'Checks');
  await page.getByRole('button', { name: 'Open in Timeline', exact: true }).click();
  const timeline = page.getByRole('region', { name: 'Timeline', exact: true });
  await timeline.getByRole('button', { name: 'Check browser · passed' }).click();
  const detail = timeline.getByLabel('Step detail');
  await expect(detail).toContainText('Check browser · passed');
  await expect(detail.getByRole('button', { name: 'Open trace' })).toBeVisible(); await expect(detail.getByRole('link', { name: 'Download trace' })).toBeVisible();
  await detail.getByRole('button', { name: 'Open test-results/result.png' }).click();
  const preview = page.getByRole('dialog', { name: 'Preview of test-results/result.png' });
  await expect(preview.locator('img')).toBeVisible(); expect(page.url()).toContain(`/runs/${run.id}`);
  await expect(preview.getByRole('button', { name: 'Next screenshot' })).toHaveCount(0);
  await preview.getByRole('button', { name: 'Reference in chat' }).click(); await expect(preview).toHaveCount(0);
  await expect(page.getByLabel('Continue this ticket')).toHaveValue(/Screenshot: test-results\/result\.png/);
  await page.getByLabel('Continue this ticket').fill('');
  await view(page, 'Result');
  await expect(page.locator('.run-metrics')).toContainText('150');
  const current = await exportRun(request, run.id);
  const screenshot = current.artifacts.find(a => a.name === 'test-results/result.png');
  const image = await request.get(`/api/runs/${run.id}/artifacts/${screenshot.id}?inline`); expect(image.ok()).toBeTruthy(); expect(image.headers()['content-type']).toBe('image/png');
  expect((await request.get(`/api/runs/${run.id}/artifacts/does-not-exist`)).status()).toBe(404);
});

test('run pages support direct links, back/forward and mobile without dialogs', { tag: '@run' }, async ({ page, request }, testInfo) => {
  const run = await readyRun(request, 'Open this run directly');
  await page.goto(`/runs/${run.id}`); await expect(page.locator('.run-state')).toContainText('Ready for review');
  await page.getByRole('link', { name: 'All work', exact: true }).click();
  await page.goBack(); await expect(page).toHaveURL(`/runs/${run.id}`);
  await page.goForward(); await expect(page).toHaveURL('/');
  await page.goto(`/runs/${run.id}`); await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('group', { name: 'Tiles', exact: true })).toBeVisible();
  await expect.poll(async () => (await page.locator('.tile-chat').boundingBox()).width).toBe(390);
  await view(page, 'Result');
  await expect(page.getByRole('complementary', { name: 'Result' })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.run-page').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await expect(page.locator('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(page.getByRole('complementary', { name: 'Result' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('dispatch-run-mobile.png'), fullPage: true });
});

test('follow-up drafts survive reload and a follow-up that changes nothing reuses the checks that passed on the same tree', { tag: '@run' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json();
  await page.goto('/');
  await page.getByLabel('Ticket or instructions').fill('Update the value for a draft'); await answerRepository(page, state.projects[0].name); await page.getByRole('button', { name: 'dispatch', exact: true }).click();
  await expect(page.locator('.run-state')).toContainText('Ready for review');
  await page.getByLabel('Continue this ticket').fill('Tighten the change'); await page.reload(); await expect(page.getByLabel('Continue this ticket')).toHaveValue('Tighten the change');
  await expect(page.getByLabel('Follow-up mode', { exact: true })).toHaveCount(0);
  const [followupResponse] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/followup') && response.status() === 201), page.getByRole('button', { name: 'Continue', exact: true }).click()]);
  const followup = await followupResponse.json(); await expect(page.locator('main.run-page')).toHaveAttribute('data-run-id', followup.id);
  await expect(page.locator('.run-state')).toContainText('Ready for review');
  const result = await exportRun(request, followup.id);
  expect(result.previousRunId).toBeTruthy(); expect(result.checks.length).toBeGreaterThan(0); expect(result.checks.every(check => check.status === 'passed' && check.revision === result.revision)).toBeTruthy();
  expect(result.checks.every(check => check.reusedFrom?.runId === result.previousRunId)).toBeTruthy();
  await view(page, 'Checks'); await expect(page.locator('.check-result').first()).toContainText('passed (reused)');
});

test('the chat composer shows the model, and a switch changes the next turn’s model', { tag: '@run' }, async ({ page, request }) => {
  await request.post('/api/models/refresh', { data: {} });
  const run = await readyRun(request, 'Show and switch the model');
  const target = run.execution.model === 'test-luna' ? 'test-sol' : 'test-luna';
  await page.goto(`/runs/${run.id}`);
  await expect(page.getByLabel('Next turn model', { exact: true })).toBeEnabled();
  const [switched] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/model') && response.status() === 200), selectChoice(page, 'Next turn model', `codex:${target}`)]);
  const { nextExecution } = await switched.json(); expect(nextExecution).toMatchObject({ provider: 'codex', model: target, mode: 'manual' });
  await page.getByLabel('Continue this ticket').fill('Once more on the other model');
  const [response] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/followup') && response.status() === 201), page.getByRole('button', { name: 'Continue', exact: true }).click()]);
  const next = await response.json(); expect(next.execution).toMatchObject({ provider: 'codex', model: target, effort: nextExecution.effort, mode: 'manual' });
  await expect(page.locator('main.run-page')).toHaveAttribute('data-run-id', next.id);
  await expect(page.locator('.run-state')).toContainText('Ready for review');
  const steps = (await (await request.get(`/api/runs/${next.id}/steps?limit=500`)).json()).steps;
  expect(steps.find(step => step.kind === 'turn.start')?.model).toBe(target);
  expect(steps.find(step => step.kind === 'model')).toMatchObject({ change: 'switch' });
});

test('questions take focus and stop stays visible while waiting', { tag: '@run' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json();
  const response = await request.post('/api/runs', { data: { mode: 'live', projectId: state.projects[0].id, input: 'Ask a scope question' } }), run = await response.json();
  await page.goto(`/runs/${run.id}`);
  await expect(page.getByLabel('Answer Codex')).toBeVisible(); await expect(page.getByRole('button', { name: 'Cancel run', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Small/ }).click(); await page.getByRole('button', { name: 'Send answer', exact: true }).click();
  await expect(page.locator('.run-state')).toContainText('Ready for review');
});

test('focused run has no document scrolling, keeps history position and compares diffs on mobile', { tag: '@run' }, async ({ page, request }, testInfo) => {
  const state = await (await request.get('/api/state')).json();
  const run = state.runs.filter(run => run.mode === 'live' && run.status === 'ready' && !(run.linked ?? []).some(member => member.changedPaths?.length)).sort((a, b) => b.events.length - a.events.length)[0] ?? await readyRun(request, 'Focus on this run');
  await page.goto(`/runs/${run.id}`); await expect(page.getByRole('group', { name: 'Tiles', exact: true })).toBeVisible();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 640 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await view(page, 'Diff'); await expect(page.locator('.diff-line.after')).toContainText('changed');
    await expect.poll(() => page.locator('.diff-output').evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy();
    await view(page, 'Chat');
  }
  const conversation = page.getByLabel('Task conversation');
  for (const summary of await page.locator('.activity-bundle > summary').all()) await summary.click();
  await expect.poll(() => conversation.evaluate(element => element.scrollHeight > element.clientHeight)).toBeTruthy();
  await conversation.evaluate(element => { element.scrollTop = element.scrollHeight; }); await page.waitForTimeout(150);
  await conversation.evaluate(element => { element.scrollTop = 0; }); await page.waitForTimeout(150);
  await expect(page.getByRole('button', { name: 'Latest', exact: true })).toBeVisible();
  await page.waitForTimeout(1200); expect(await conversation.evaluate(element => element.scrollTop)).toBe(0);
  const tool = page.locator('details.history-tool.tool').first(); await expect(tool).not.toHaveAttribute('open', '');
  if (!await tool.locator('xpath=ancestor::details[contains(@class,"activity-bundle")]').getAttribute('open').then(value => value !== null)) await tool.locator('xpath=ancestor::details[contains(@class,"activity-bundle")]').locator(':scope > summary').click(); await tool.locator('summary').click(); await expect(tool).toHaveAttribute('open', ''); await expect(tool.locator('pre')).toContainText('Collapsed tool output');
  await page.getByRole('button', { name: 'Latest', exact: true }).click(); await expect.poll(() => conversation.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(65);
  await page.screenshot({ path: testInfo.outputPath('dispatch-focused-mobile.png') });
});

test('blocked worker questions survive reload and answers continue the original session', { tag: '@run' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json();
  const response = await request.post('/api/runs', { data: { mode: 'live', projectId: state.projects[0].id, input: 'Ask for the value policy' } });
  const first = await response.json(); await page.goto(`/runs/${first.id}`);
  await expect(page.getByLabel('Agent question')).toContainText('Which value policy');
  await page.reload(); await expect(page.getByLabel('Agent question')).toContainText('<script>unsafe</script>');
  await page.getByLabel('Your answer').fill('Use changed');
  const [nextResponse] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/followup') && response.status() === 201), page.getByRole('button', { name: 'Send answer', exact: true }).click()]);
  const next = await nextResponse.json(); expect(next.sessionId).toBe('browser-session'); expect(next.workspace).toBe(first.workspace);
  await expect(page.locator('.run-state')).toContainText('Ready for review');
  await expect(page.getByLabel('Turn 1', { exact: true })).toContainText('Which value policy');
  await expect(page.getByLabel('Turn 2', { exact: true })).toContainText('Use changed');
  await expect(page.getByRole('group', { name: 'Tiles', exact: true })).toBeVisible();
});

test('agent browser screenshots are retained with their observation label', { tag: '@run' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json();
  const run = await (await request.post('/api/runs', { data: { mode: 'live', projectId: state.projects[0].id, input: 'Use the agent browser' } })).json();
  await page.goto(`/runs/${run.id}`); await expect(page.locator('.run-state')).toContainText('Ready for review');
  const history = page.getByLabel('Conversation history');
  const thumb = history.locator('button[aria-label="Preview Agent browser 1.png"]').first();
  await expect(thumb).toBeAttached(); await thumb.evaluate(element => element.click());
  await expect(page.getByRole('dialog', { name: 'Preview of Agent browser 1.png' })).toContainText('left click at 0, 0');
  await expect(page.locator('.lightbox .agent-cursor')).toBeAttached(); await page.keyboard.press('Escape');
  const final = await exportRun(request, run.id);
  const observation = final.artifacts.find(artifact => artifact.source === 'agent'); expect(observation.revision).toBeNull(); expect(observation.check).toBe('Agent browser'); expect(observation.pointer).toEqual({ x: 0, y: 0, action: 'left_click' }); expect(final.checks.every(check => check.status === 'passed' && check.revision === final.revision)).toBeTruthy();
});

test('the follow-up placeholder suggests a reply from the run state, Tab takes it only into an empty field, and the follow-up continues', { tag: '@run' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json(), project = state.projects[0];
  const run = await (await request.post('/api/runs', { data: { mode: 'live', projectId: project.id, input: 'Wait for an interruption before suggesting' } })).json();
  await expect.poll(async () => (await exportRun(request, run.id)).status).toBe('implementing');
  await request.post(`/api/runs/${run.id}/cancel`, { data: {} });
  await expect.poll(async () => (await exportRun(request, run.id)).status).toBe('cancelled');
  await page.goto(`/runs/${run.id}`);
  const composer = page.getByLabel('Continue this ticket');
  await expect(composer).toHaveAttribute('placeholder', 'Continue.');
  await expect(page.getByRole('group', { name: 'Suggested replies' })).toHaveCount(0); await expect(page.getByLabel('Remember for this repository')).toHaveCount(0);
  await composer.fill('Keep going but skip the docs.'); await composer.press('Tab'); await expect(composer).toHaveValue('Keep going but skip the docs.');
  await composer.fill(''); await composer.focus(); await page.keyboard.press('Tab'); await expect(composer).toHaveValue('Continue.');
  const [response] = await Promise.all([page.waitForResponse(item => item.url().endsWith('/followup') && item.status() === 201), page.getByRole('button', { name: 'Continue', exact: true }).click()]);
  const followup = await response.json(); await expect(page.locator('main.run-page')).toHaveAttribute('data-run-id', followup.id);
  await expect(page.locator('.run-state')).toContainText('Ready for review');
});

test('the verdict leads with the outcome, flags test and SQL changes, shows the SQL to run, and removes the worktree on request', { tag: '@run' }, async ({ page, request }) => {
  const run = await readyRun(request, 'Add a table and a test');
  expect(run.flags.testsChanged).toEqual(['value.test.js']); expect(run.flags.sqlChanged).toEqual(['db/001_table.sql']);
  await page.goto(`/runs/${run.id}`);
  const verdict = page.getByRole('complementary', { name: 'Result' }).getByRole('region', { name: 'Verdict' });
  await expect(verdict.getByRole('heading', { name: 'Ready to hand off' })).toBeVisible();
  await expect(verdict).toContainText('2 passed against'); await expect(verdict).toContainText('Review'); await expect(verdict).toContainText('3 files changed');
  await expect(verdict.getByRole('list', { name: 'Warnings' })).toContainText('Test files changed: value.test.js. Review the test diff before merging.');
  await expect(verdict.locator('.verdict-sql pre')).toContainText('-- db/001_table.sql\nCREATE TABLE widgets (id int);');
  await verdict.getByRole('button', { name: 'Remove worktree', exact: true }).click();
  await expect(verdict).toContainText('Worktree removed; branch dispatch/');
  expect((await exportRun(request, run.id)).worktreeRemovedAt).toBeTruthy();
});

test('the worker decides a question needs no change: the task ends as an answer with no diff or checks, and the suggested follow-up makes the change', { tag: '@run' }, async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByLabel('Answer only')).toHaveCount(0);
  await page.getByLabel('Ticket or instructions').fill('Where is the value stored?');
  await answerRepository(page, 'Browser test repository');
  const [created] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/runs') && response.status() === 201), page.getByRole('button', { name: 'dispatch', exact: true }).click()]);
  const run = await created.json(); expect(run.kind).toBe('change');
  await expect(page.locator('.run-state')).toContainText('Ready for review');
  await expect(page.getByRole('region', { name: 'Verdict' }).getByRole('heading', { name: 'Answer ready' })).toBeVisible();
  await expect(page.getByLabel('Conversation history')).toContainText('value.txt:1'); await expect(page.getByLabel('Conversation history')).not.toContainText('DISPATCH_ANSWERED');
  await expect(page.getByRole('group', { name: 'Tiles', exact: true })).toHaveCount(0);
  const exported = await exportRun(request, run.id); expect(exported.answered).toBe(true); expect(exported.handoff).toBeNull(); expect(exported.checks).toEqual([]); expect(exported.changedPaths).toEqual([]);
  const composer = page.getByLabel('Continue this ticket');
  await expect(composer).toHaveAttribute('placeholder', 'Make this change.'); await composer.focus(); await page.keyboard.press('Tab'); await expect(composer).toHaveValue('Make this change.');
  const [response] = await Promise.all([page.waitForResponse(item => item.url().endsWith('/followup') && item.status() === 201), page.getByRole('button', { name: 'Continue', exact: true }).click()]);
  const change = await response.json(); await expect(page.locator('main.run-page')).toHaveAttribute('data-run-id', change.id);
  await expect(page.getByRole('region', { name: 'Verdict' }).getByRole('heading', { name: 'Ready to hand off' })).toBeVisible();
  expect((await exportRun(request, change.id)).checks.length).toBeGreaterThan(0);
});

test('pasting a tracker link offers to enable the connector, and a ready run with a PR offers to move the work item', { tag: '@run' }, async ({ page, request }) => {
  const projects = await (await request.get('/api/projects')).json();
  const browser = projects.find(project => project.name === 'Browser test repository'), tracker = projects.find(project => project.name === 'Tracker repository');
  await page.goto('/');
  await page.getByLabel('Ticket or instructions').fill('https://tracker.example/demo/issues/31');
  await answerRepository(page, 'Browser test repository');
  await page.getByRole('button', { name: 'dispatch', exact: true }).click();
  const card = page.getByLabel('Connector question');
  await expect(card).toContainText('does not read Example Tracker for Browser test repository');
  await card.getByRole('button', { name: 'Paste the ticket text instead' }).click();
  await expect(card).toBeHidden(); await expect(page.getByLabel('Ticket or instructions')).toHaveValue('');
  expect((await (await request.get('/api/projects')).json()).find(project => project.id === browser.id).connectors.example?.enabled).not.toBe(true);
  await page.getByLabel('Ticket or instructions').fill('https://tracker.example/demo/issues/32');
  await answerRepository(page, 'Browser test repository');
  await page.getByRole('button', { name: 'dispatch', exact: true }).click();
  await page.getByLabel('Connector question').getByRole('button', { name: 'Read Example Tracker tickets for Browser test repository' }).click();
  await expect(page).toHaveURL(/\/runs\//);
  const started = await exportRun(request, page.url().split('/runs/')[1]);
  expect(started.ticketId).toBe('EXAMPLE-32'); expect(started.ticket.tracker).toBe('example'); expect(started.project.connectors.example.enabled).toBe(true);
  expect((await (await request.get('/api/projects')).json()).find(project => project.id === browser.id).connectors.example.enabled).toBe(true);
  await request.post(`/api/projects/${browser.id}/connectors`, { data: { example: { enabled: false } } });
  const run = await (await request.post('/api/runs', { data: { mode: 'live', projectId: tracker.id, input: 'https://tracker.example/demo/issues/400' } })).json();
  await expect.poll(async () => (await exportRun(request, run.id)).status, { timeout: 20000 }).toBe('ready');
  await page.goto(`/runs/${run.id}`);
  const offer = page.getByLabel('Move the work item');
  await expect(offer).toContainText('Move EX-400 from Active to');
  await offer.getByRole('button', { name: 'Resolved', exact: true }).click();
  const moved = page.getByLabel('Work item moved');
  await expect(moved).toContainText('moved from Active to Resolved');
  const brain = await (await request.get(`/api/brain?projectId=${tracker.id}&kind=preference`)).json();
  expect(brain.entries.some(entry => entry.trigger === 'delivery.pr-opened' && entry.value === 'Resolved')).toBe(true);
  await moved.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Verdict' })).toContainText('EX-400 moved back to Active');
  await page.goto('/brain');
  await page.getByLabel('Filter').fill('delivery.pr-opened');
  await page.getByRole('navigation', { name: 'Matches' }).getByRole('button', { name: /When delivery\.pr-opened/ }).first().click();
  await expect(page.locator('.brain-entry').filter({ hasText: 'When delivery.pr-opened' })).toBeVisible();
});

test('the dispatch browser drives the worktree app through recorded steps and keeps its profile between runs', { tag: '@run' }, async ({ request }) => {
  const projects = await (await request.get('/api/projects')).json();
  const project = projects.find(item => item.name === 'Browser tool repository');
  const drive = async () => {
    const run = await (await request.post('/api/runs', { data: { mode: 'live', projectId: project.id, input: 'Drive the dispatch browser' } })).json();
    await expect.poll(async () => (await exportRun(request, run.id)).status, { timeout: 60000 }).toBe('ready');
    return exportRun(request, run.id);
  };
  const first = await drive();
  const steps = (await (await request.get(`/api/runs/${first.id}/steps?limit=500`)).json()).steps;
  const browserSteps = steps.filter(step => step.kind === 'browser.step');
  expect(browserSteps.map(step => step.tool)).toEqual(['dispatch_browser_navigate', 'dispatch_browser_snapshot', 'dispatch_browser_click', 'dispatch_browser_screenshot', 'dispatch_browser_console']);
  expect(browserSteps[0].title).toBe('Browser tool fixture visit 1'); expect(browserSteps[2].target).toBeTruthy(); expect(browserSteps[0].screenshotAfter).toBeTruthy();
  expect(steps.filter(step => step.kind === 'dev-server').map(step => step.phase)).toEqual(['started', 'stopped']);
  const shots = first.artifacts.filter(item => item.source === 'browser');
  expect(shots.length).toBeGreaterThanOrEqual(4); expect(shots[0].stepId).toBe(browserSteps[0].id);
  const image = await request.get(`/api/runs/${first.id}/artifacts/${shots[0].id}?inline`);
  expect(image.headers()['content-type']).toBe('image/jpeg');
  const second = await drive();
  const again = (await (await request.get(`/api/runs/${second.id}/steps?limit=500`)).json()).steps.filter(step => step.kind === 'browser.step');
  expect(again[0].title).toBe('Browser tool fixture visit 2');
});
