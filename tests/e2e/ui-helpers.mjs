import { expect } from '@playwright/test';
export async function reveal(page, locator) {
  await locator.scrollIntoViewIfNeeded();
}
export async function selectChoice(page, label, value) {
  const control = page.getByLabel(label, { exact: true });
  await control.scrollIntoViewIfNeeded(); await control.click();
  const target = typeof value === 'object' ? page.getByRole('option', { name: value.label, exact: true }) : page.locator(`.select-option[data-value="${value}"]`);
  for (let i = 0; i < 30 && !await target.count(); i++) await page.locator('.select-pages').getByRole('button', { name: 'Next page', exact: true }).click();
  await target.click();
}
const drawers = ['Result'];
export async function view(page, name) {
  if (drawers.includes(name)) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
    return;
  }
  const toggle = page.getByRole('group', { name: 'Tiles', exact: true }).getByRole('button', { name, exact: true });
  const compact = await page.evaluate(() => matchMedia('(max-width: 899px)').matches);
  if (compact || await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
}

export async function openTimeline(page) {
  await view(page, 'Result');
  const drawer = page.getByRole('complementary', { name: 'Result' }), timeline = drawer.getByRole('region', { name: 'Timeline', exact: true });
  if (!await timeline.count()) await drawer.locator('.drawer-timeline > summary').click();
  return timeline;
}

export async function answerRepository(page, name) {
  const question = page.getByLabel('Repository question'), picker = page.getByLabel('Repository', { exact: true });
  await expect(question.or(picker).first()).toBeVisible();
  if (await question.count()) await question.getByRole('button', { name, exact: true }).click();
  else if (!(await picker.textContent()).includes(name)) { await selectChoice(page, 'Repository', { label: name }); await page.keyboard.press('Escape'); }
  await expect(picker).toContainText(name);
}

export async function tickRepositories(page, names) {
  const picker = page.getByLabel('Repository', { exact: true });
  await picker.click();
  for (const name of names) await page.getByRole('option', { name, exact: true }).click();
  await page.keyboard.press('Escape');
  for (const name of names) await expect(picker).toContainText(name);
}

export const exportRun = async (request, id) => (await (await request.get(`/api/runs/${id}/export`)).json()).run;

export async function readyRun(request, input = `Ready run ${Date.now()}`) {
  const state = await (await request.get('/api/state')).json();
  const project = state.projects.find(project => project.name === 'Browser test repository');
  const run = await (await request.post('/api/runs', { data: { mode: 'live', projectId: project.id, input } })).json();
  await expect.poll(async () => (await exportRun(request, run.id)).status, { timeout: 20000 }).toBe('ready');
  return exportRun(request, run.id);
}

export async function ensureSecondRepository(request) {
  const projects = await (await request.get('/api/projects')).json();
  const existing = projects.find(project => project.name === 'Second repository');
  if (existing) return existing;
  const repositoryPath = projects[0].repositoryPath.replace(/repository$/, 'second');
  const response = await request.post('/api/projects', { data: { name: 'Second repository', repositoryPath, baseBranch: 'main', confirmed: true, validation: [{ id: 'unit', command: 'node', args: ['-e', 'process.exit(0)'] }], textOnly: { paths: ['*.md', 'docs/**'], checks: ['unit'] } } });
  expect(response.status()).toBe(200);
  return response.json();
}
