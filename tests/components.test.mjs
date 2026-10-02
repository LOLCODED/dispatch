import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listComponents } from '../src/components.mjs';
import { createServer } from '../src/server.mjs';
import { liveFixture, settle } from './live-double.mjs';

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'dispatch-components-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };
  return { root, write };
}

test('components are the exported PascalCase names under components folders, in a stable order', t => {
  const { root, write } = repository(t);
  write('src/components/Hero.tsx', 'export default function Hero() { return null; }\nexport const HeroBadge = () => null;\nexport function helper() {}\n');
  write('src/components/ui/button.tsx', 'const Button = () => null;\nconst buttonVariants = {};\nexport { Button, buttonVariants };\n');
  write('src/components/ui/card.tsx', 'class CardFrame {}\nexport { CardFrame as Card };\nexport class CardTitle {}\n');
  write('src/components/Footer.jsx', 'function Footer() {}\nexport default Footer;\n');
  write('src/components/Hero.test.tsx', 'export function Broken() {}\n');
  write('src/components/Hero.stories.tsx', 'export const Story = {};\n');
  write('src/components/notes.ts', 'export const Notes = 1;\n');
  write('src/pages/Home.tsx', 'export default function Home() {}\n');
  write('node_modules/lib/components/Thing.tsx', 'export function Thing() {}\n');
  write('packages/site/components/Pricing.tsx', 'export async function Pricing() {}\n');
  assert.deepEqual(listComponents(root), [
    { name: 'Button', path: 'src/components/ui/button.tsx' }, { name: 'Card', path: 'src/components/ui/card.tsx' }, { name: 'CardTitle', path: 'src/components/ui/card.tsx' },
    { name: 'Footer', path: 'src/components/Footer.jsx' }, { name: 'Hero', path: 'src/components/Hero.tsx' }, { name: 'HeroBadge', path: 'src/components/Hero.tsx' }, { name: 'Pricing', path: 'packages/site/components/Pricing.tsx' },
  ]);
  assert.deepEqual(listComponents(join(root, 'missing')), []); assert.deepEqual(listComponents(''), []);
});

test('GET /api/runs/:id/components lists the components in the run worktree', async t => {
  const fixture = await liveFixture(t);
  const server = createServer(fixture.engine); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = await settle(fixture.engine, await fixture.live.create({ projectId: fixture.project.id, input: 'Change the value' }));
  mkdirSync(join(run.workspace, 'components'), { recursive: true }); writeFileSync(join(run.workspace, 'components', 'Hero.tsx'), 'export function Hero() {}\n');
  assert.deepEqual(await (await fetch(`${base}/api/runs/${run.id}/components`)).json(), { components: [{ name: 'Hero', path: 'components/Hero.tsx' }] });
  assert.equal((await fetch(`${base}/api/runs/00000000-0000-4000-8000-000000000000/components`)).status, 404);
});
