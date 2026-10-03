import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { exportRun, selectChoice } from './ui-helpers.mjs';

const git = (project, ...args) => execFileSync('git', ['-C', project.repositoryPath, ...args], { encoding: 'utf8' }).trim();
const projectsByName = async request => { const projects = await (await request.get('/api/projects')).json(); return name => projects.find(project => project.name === name); };
const dispatch = async (request, data) => (await request.post('/api/runs', { data: { mode: 'live', ...data } })).json();

test('one task changes three repositories, and landing moves each onto the branch chosen for it', { tag: '@tasks' }, async ({ page, request }) => {
  const byName = await projectsByName(request), primary = byName('Browser tool repository'), frontend = byName('Frontend repository'), service = byName('Service repository');
  const target = `land-${Date.now()}`;
  for (const project of [primary, frontend]) git(project, 'branch', target, 'main');
  const before = { frontendMain: git(frontend, 'rev-parse', 'main'), serviceMain: git(service, 'rev-parse', 'main'), serviceStaging: git(service, 'rev-parse', 'staging') };
  const run = await dispatch(request, { input: `Change all three ${Date.now()}`, projectId: primary.id, projectIds: [primary.id, frontend.id, service.id] });
  expect(run.repositorySelection.projectIds).toEqual([primary.id, frontend.id, service.id]);
  await expect.poll(async () => ['ready', 'blocked', 'failed', 'cancelled', 'interrupted'].includes((await exportRun(request, run.id)).status), { timeout: 30000 }).toBe(true);
  const ready = await exportRun(request, run.id);
  expect(ready.status, JSON.stringify(ready.events.map(event => event.message))).toBe('ready');
  expect(ready.linked.map(member => [member.name, member.baseBranch, Boolean(member.headSha) && member.headSha !== member.baseSha])).toEqual([["Frontend repository", "main", true], ["Service repository", "staging", true]]);
  expect(ready.checks.map(check => check.name)).toEqual(['unit', 'Frontend repository: unit', 'Service repository: unit']);
  await page.goto(`/runs/${run.id}`);
  const verdict = page.getByRole('complementary', { name: 'Result' }).getByRole('region', { name: 'Verdict' });
  await expect(verdict).toContainText('Frontend repository · 1 file'); await expect(verdict).toContainText('Service repository · 1 file'); await expect(verdict).toContainText('onto staging');
  await page.getByRole('button', { name: 'Land on a branch', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Land this task' });
  await expect(dialog.getByLabel('Target branch', { exact: true })).toContainText('main');
  await expect(dialog.getByLabel('Target branch for Frontend repository', { exact: true })).toContainText('main');
  await expect(dialog.getByLabel('Target branch for Service repository', { exact: true })).toContainText('staging');
  await selectChoice(page, 'Target branch', target); await selectChoice(page, 'Target branch for Frontend repository', target);
  await expect(dialog).toContainText(`Service repository on staging`);
  await dialog.getByRole('button', { name: `Land on ${target}`, exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/[a-f0-9-]+$/);
  await expect(page.getByRole('region', { name: 'Verdict' })).toContainText(`Landed on ${target}`, { timeout: 30000 });
  expect(git(primary, 'show', `${target}:value.txt`)).toBe('changed'); expect(git(frontend, 'show', `${target}:value.txt`)).toBe('changed'); expect(git(service, 'show', 'staging:value.txt')).toBe('changed');
  expect(git(frontend, 'rev-parse', 'main')).toBe(before.frontendMain); expect(git(service, 'rev-parse', 'main')).toBe(before.serviceMain); expect(git(service, 'rev-parse', 'staging')).not.toBe(before.serviceStaging);
  const landed = await exportRun(request, run.id);
  expect(landed.landed.linked.map(lane => [lane.name, lane.target])).toEqual([['Frontend repository', target], ['Service repository', 'staging']]);
});

test('Agent decides puts every saved repository in reach and commits only the one the agent changed', { tag: '@tasks' }, async ({ request }) => {
  const byName = await projectsByName(request);
  const run = await dispatch(request, { input: `Change only one of them ${Date.now()}`, projectIds: 'all' });
  expect(run.repositorySelection.mode).toBe('agent'); expect(run.projectId).toBe(byName('Browser test repository').id);
  await expect.poll(async () => (await exportRun(request, run.id)).status, { timeout: 30000 }).toBe('ready');
  const ready = await exportRun(request, run.id);
  expect(ready.headSha).toBe(ready.baseSha);
  expect(ready.linked.filter(member => member.headSha && member.headSha !== member.baseSha).map(member => member.name)).toEqual(['Frontend repository']);
  expect(ready.checks.map(check => check.name)).toEqual(['Frontend repository: unit']);
  expect(ready.repositories.map(item => item.name)).toEqual([ready.project.name, 'Frontend repository']);
});
