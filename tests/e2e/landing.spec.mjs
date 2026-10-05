import { execFileSync } from 'node:child_process';
import { exportRun, selectChoice } from './ui-helpers.mjs';
import { test, expect } from './fixtures.mjs';

async function readyRun(request, input) {
  const project = (await (await request.get('/api/projects')).json()).find(item => item.name === 'Browser tool repository');
  const run = await (await request.post('/api/runs', { data: { mode: 'live', projectId: project.id, input } })).json();
  await expect.poll(async () => (await exportRun(request, run.id)).status, { timeout: 20000 }).toBe('ready');
  return exportRun(request, run.id);
}

test('ready tasks selected on the task list land on a chosen branch and leave the board as completed', { tag: '@tasks' }, async ({ page, request }) => {
  const first = await readyRun(request, `Land first ${Date.now()}`), second = await readyRun(request, `Land second ${Date.now()}`);
  const project = (await (await request.get('/api/projects')).json()).find(item => item.id === first.projectId), target = `land-${Date.now()}`;
  const git = (...args) => execFileSync('git', ['-C', project.repositoryPath, ...args], { encoding: 'utf8' }).trim();
  git('branch', target, 'main'); const main = git('rev-parse', 'main');
  await page.goto('/'); await page.getByRole('button', { name: /^Tasks/ }).click();
  for (const run of [second, first]) await page.getByRole('button', { name: `Select ${run.title} to land`, exact: true, pressed: false }).click();
  await page.getByRole('button', { name: 'Land 2 selected', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Land 2 tasks' });
  await expect(dialog).toContainText(first.title); await expect(dialog.getByLabel('Target branch', { exact: true })).toContainText('main');
  await selectChoice(page, 'Target branch', target);
  await dialog.getByRole('button', { name: `Land on ${target}`, exact: true }).click();
  await expect(page).toHaveURL(/\/runs\/[a-f0-9-]+$/);
  await expect(page.getByRole('region', { name: 'Verdict' })).toContainText(`Landed on ${target}`, { timeout: 30000 });
  const landing = await exportRun(request, page.url().split('/').at(-1)), landed = git('log', '--format=%s', `main..${target}`).split('\n');
  // The double may make both tasks identical, in which case the second squash is empty and adds no commit.
  expect(landed.at(-1), JSON.stringify(landing.events.map(event => event.message))).toBe(first.title);
  expect(landed.every(subject => [first, second].some(run => subject === run.title))).toBe(true);
  expect(landing.landing.items.map(item => item.status)).toEqual(['landed', 'landed']);
  expect(git('rev-parse', 'main')).toBe(main);
  await page.goto('/'); await page.getByRole('button', { name: /^Tasks/ }).click();
  await page.getByRole('button', { name: /^\d+ completed/ }).click();
  await expect(page.getByRole('link', { name: first.title, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: `Land 2 tasks on ${target}` })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Select ${first.title} to land`, exact: true })).toHaveCount(0);
});
