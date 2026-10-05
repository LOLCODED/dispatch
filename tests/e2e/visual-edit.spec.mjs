import { test, expect } from './fixtures.mjs';
import { exportRun, openTimeline } from './ui-helpers.mjs';

const drag = async (page, from, to, { x, y }) => {
  const source = await from.boundingBox(), target = await to.boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + target.width * x, target.y + target.height * y, { steps: 6 }); await page.mouse.move(target.x + target.width * x + 1, target.y + target.height * y + 1, { steps: 2 });
  await page.mouse.up();
};

test('browser step screenshots can be edited visually and the edits become reply lines', { tag: '@run' }, async ({ page, request }) => {
  const projects = await (await request.get('/api/projects')).json(), project = projects.find(item => item.name === 'Browser tool repository');
  const run = await (await request.post('/api/runs', { data: { mode: 'live', projectId: project.id, input: 'Drive the dispatch browser' } })).json();
  await expect.poll(async () => (await exportRun(request, run.id)).status, { timeout: 60000 }).toBe('ready');
  const steps = (await (await request.get(`/api/runs/${run.id}/steps?limit=500`)).json()).steps.filter(step => step.kind === 'browser.step');
  expect(steps[0].elements.map(element => [element.tag, element.text, element.selector])).toEqual([['h1', 'Browser tool fixture', 'h1'], ['button', 'Count', '#count']]);
  expect(steps[0].elements.every(element => element.box.width > 0 && element.box.height > 0)).toBeTruthy();
  expect((await (await request.get(`/api/runs/${run.id}/components`)).json()).components).toEqual([{ name: 'Hero', path: 'components/Hero.jsx' }]);

  await page.goto(`/runs/${run.id}`);
  const timeline = await openTimeline(page);
  await timeline.getByRole('button', { name: /^navigate / }).click();
  await timeline.getByLabel('Step detail').getByRole('button', { name: 'Open Browser step 1.jpg' }).click();
  const preview = page.getByRole('dialog', { name: 'Preview of Browser step 1.jpg' });
  await preview.getByRole('button', { name: 'Edit the page' }).click();
  const heading = preview.getByRole('button', { name: '<h1> “Browser tool fixture” (h1)' }), button = preview.getByRole('button', { name: '<button> “Count” (#count)' });
  await expect(heading).toBeVisible(); await expect(button).toBeVisible();
  const chip = preview.getByRole('list', { name: 'Repository components' }).getByRole('button', { name: 'Hero', exact: true });
  await expect(chip).toBeVisible();

  const edits = preview.getByRole('list', { name: 'Edits' });
  await drag(page, heading, button, { x: 0.5, y: 0.8 });
  await expect(edits).toContainText('Move <h1> “Browser tool fixture” (h1) to after <button> “Count” (#count) on /.');
  await drag(page, chip, heading, { x: 0.5, y: 0.2 });
  await expect(edits).toContainText('Insert the Hero component (components/Hero.jsx) before <h1> “Browser tool fixture” (h1) on /.');
  await heading.focus(); await page.keyboard.press('m'); await button.focus(); await page.keyboard.press('b');
  await expect(edits).toContainText('Move <h1> “Browser tool fixture” (h1) to before <button> “Count” (#count) on /.');
  await button.click();
  await expect(edits).toContainText('Selected <button> “Count” (#count) on /.');
  await preview.getByRole('button', { name: 'Remove last edit' }).click();
  await expect(edits).not.toContainText('Selected');
  await preview.getByRole('button', { name: 'Add 3 edits to the reply' }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByLabel('Continue this ticket')).toHaveValue(/^Move <h1> “Browser tool fixture” \(h1\) to after <button> “Count” \(#count\) on \/\.\nInsert the Hero component \(components\/Hero\.jsx\) before <h1> .*\nMove <h1> .* to before <button> .*\n$/);
  await page.getByLabel('Continue this ticket').fill('');
});
