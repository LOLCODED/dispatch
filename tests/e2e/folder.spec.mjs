import { test, expect } from '@playwright/test';
import { exportRun, view } from './ui-helpers.mjs';

test('a plain folder task works in place: the diff and checks show, and there is nothing to land, publish or remove', { tag: '@run' }, async ({ page, request }) => {
  const projects = await (await request.get('/api/projects')).json(), project = projects.find(item => item.name === 'Plain folder');
  expect(project.git).toBe(false); expect(project.baseBranch).toBeNull();
  const created = await (await request.post('/api/runs', { data: { mode: 'live', projectId: project.id, input: 'Change the value in the plain folder' } })).json();
  await expect.poll(async () => (await exportRun(request, created.id)).status, { timeout: 20000 }).toBe('ready');
  const run = await exportRun(request, created.id);
  expect(run.branch).toBeNull(); expect(run.headSha).toBeNull(); expect(run.workspace).toBe(project.repositoryPath); expect(run.handoff.folder).toBe(project.repositoryPath); expect(run.baseSource).toBe('folder');
  expect(run.checks.map(check => [check.name, check.status, check.revision])).toEqual([['unit', 'passed', run.revision]]);
  await page.goto(`/runs/${run.id}`);
  await expect(page.locator('.run-state')).toContainText('Ready for review');
  const verdict = page.getByRole('complementary', { name: 'Result' }).getByRole('region', { name: 'Verdict' });
  await expect(verdict.getByRole('heading', { name: 'Ready in the folder' })).toBeVisible();
  await expect(verdict).toContainText('folder snapshot'); await expect(verdict).toContainText('1 passed against');
  await expect(verdict.getByRole('group', { name: 'Folder' })).toContainText(project.repositoryPath);
  await expect(verdict.getByRole('button', { name: 'Open folder', exact: true })).toBeVisible();
  await expect(verdict.getByRole('button', { name: 'Remove worktree', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Land on a branch', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open draft pull request', exact: true })).toHaveCount(0);
  await view(page, 'Diff'); await expect(page.locator('.diff-line.before')).toContainText('original'); await expect(page.locator('.diff-line.after')).toContainText('changed');
  const second = await request.post('/api/runs', { data: { mode: 'live', projectId: project.id, input: 'A second task in the same folder' } });
  expect(second.status()).toBe(201);
  await page.goto('/admin/projects');
  await expect(page.locator('.project-row').filter({ hasText: 'Plain folder' })).toContainText('Folder');
});
