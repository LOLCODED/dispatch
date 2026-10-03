import { exportRun, view } from './ui-helpers.mjs';
import { test, expect } from '@playwright/test';

test('the harness-owned browser smoke check starts the app, keeps a screenshot, and fails on page errors', { tag: '@smoke' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json(), project = name => state.projects.find(item => item.name === name).id;
  const run = await (await request.post('/api/runs', { data: { mode: 'live', projectId: project('Smoke repository'), input: 'Smoke test the fixture app' } })).json();
  await page.goto(`/runs/${run.id}`); await expect(page.locator('.run-state')).toContainText('Ready for review', { timeout: 30000 });
  await view(page, 'Checks');
  const smoke = page.locator('.check-result').filter({ hasText: 'browser-smoke' });
  await expect(smoke).toContainText('passed'); await smoke.locator('summary').click(); await expect(smoke.locator('pre')).toContainText(/Started npm run dev on http:\/\/127\.0\.0\.1:\d+\/.*0 page errors, 0 console errors/s);
  await view(page, 'Checks'); await expect(page.getByRole('region', { name: 'Checks', exact: true })).toContainText(/\d files? recorded/);
  const final = await exportRun(request, run.id), shot = final.artifacts.find(artifact => artifact.name === 'browser-smoke.png');
  expect(shot.check).toBe('browser-smoke'); expect(shot.revision).toBe(final.revision);
  const broken = await (await request.post('/api/runs', { data: { mode: 'live', projectId: project('Broken smoke repository'), input: 'Smoke test the broken app' } })).json();
  await expect.poll(async () => (await exportRun(request, broken.id)).status, { timeout: 40000 }).toBe('failed');
  const record = await exportRun(request, broken.id);
  expect(record.checks.map(check => check.status)).toEqual(['failed', 'failed']); expect(record.checks[0].output).toMatch(/Page error: fixture page error/); expect(record.handoff).toBeNull();
});

test('a repository created at a missing path starts with the smoke check, and a run naming it scaffolds and smoke-tests the app', { tag: '@smoke' }, async ({ page, request }) => {
  const state = await (await request.get('/api/state')).json(), path = state.projects[0].repositoryPath.replace(/repository$/, `created-${Date.now()}`);
  const project = await (await request.post('/api/projects/create', { data: { repositoryPath: path, confirmed: true, access: 'full', git: true } })).json();
  expect(project.access).toBe('full'); expect(project.validation.map(step => step.kind)).toEqual(['browser-smoke']);
  await page.goto('/');
  await page.getByLabel('Ticket or instructions').fill(`Scaffold a small app somewhere new in ${project.name}`);
  const [created] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/api/runs') && response.status() === 201), page.getByRole('button', { name: 'dispatch', exact: true }).click()]);
  const run = await created.json(); expect(run.access).toBe('full');
  await expect(page.locator('.run-state')).toContainText('Ready for review', { timeout: 30000 });
  await expect(page.getByLabel('Conversation history')).toContainText('scripts are now the protected baseline');
  await view(page, 'Checks');
  await expect(page.locator('.check-result').filter({ hasText: 'browser-smoke' })).toContainText('passed');
  const offered = page.locator('.offered-step').filter({ hasText: 'npm run test' }); await expect(offered).toContainText('not in this repository');
  await offered.getByRole('button', { name: 'Add', exact: true }).click(); await expect(offered).toContainText('added for the next run');
  expect((await (await request.get('/api/projects')).json()).find(item => item.id === project.id).validation.map(step => step.id)).toEqual(['browser-smoke', 'test']);
});
