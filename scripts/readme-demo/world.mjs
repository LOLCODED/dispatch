import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Engine } from '../../src/engine.mjs';
import { LiveService } from '../../src/live.mjs';
import { git } from '../../src/local-tools.mjs';
import { createServer } from '../../src/server.mjs';
import { baseFiles, filterFiles } from './todo-app.mjs';

export const tickets = {
  filters: 'Add All / Active / Done filters under the todo list',
  sort: 'Sort todos so the important ones come first',
  storage: 'Keep todos after a page reload',
  shortcut: 'Press N anywhere to focus the new todo field',
  count: 'Show how many todos are left in the footer',
  strike: 'Grey out and strike through completed todos',
  empty: 'Fix: a blank todo can be added by pressing Enter',
  clear: 'Add a Clear completed button',
  reorder: 'Drag to reorder todos',
  dark: 'Dark mode that follows the system setting',
};

const writeFiles = (root, files) => {
  for (const [path, content] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); }
};
const usage = (input, output) => ({ input_tokens: input, cached_input_tokens: Math.round(input * 0.7), output_tokens: output });
const done = (summary, input = 18400, output = 2100) => ({ outcome: 'completed', sessionId: 'demo-session', summary, usage: usage(input, output) });

function browser(options) {
  const call = async (name, args = {}) => { const result = await options.tools.call(name, args); if (result.isError) throw new Error(result.content[0].text); return result; };
  const ref = (snapshot, pattern) => snapshot.content[0].text.match(pattern)?.[1];
  const shot = async () => (await call('dispatch_browser_screenshot')).content.find(item => item.type === 'text')?.text.match(/Screenshot ID: ([^.\s]+)/)?.[1];
  return { call, ref, shot };
}

async function addTodo({ call, ref }, text, pause) {
  await call('dispatch_browser_navigate', { url: 'app:/' });
  await call('dispatch_browser_resize', { width: 720, height: 520 });
  const page = await call('dispatch_browser_snapshot');
  await sleep(pause);
  await call('dispatch_browser_type', { ref: ref(page, /textbox "New todo" \[ref=(e\d+)\]/), text, submit: true });
  await sleep(pause);
}

async function reviewFilters(options) {
  options.onProgress?.('Reading public/app.mjs and public/todos.mjs');
  writeFiles(options.workspace, filterFiles);
  const tools = browser(options);
  await addTodo(tools, 'Renew passport', 200);
  const all = await tools.shot();
  const page = await tools.call('dispatch_browser_snapshot');
  await tools.call('dispatch_browser_click', { ref: tools.ref(page, /button "Done" \[ref=(e\d+)\]/) });
  const doneOnly = await tools.shot();
  const answer = await tools.call('dispatch_browser_review', {
    assessment: 'Filters sit in the footer beside the count, matching the existing spacing. Active and Done update the list without a reload; the count still shows every todo left.',
    steps: 'Add a todo, tick it, then switch between All, Active and Done.',
    screenshots: [{ id: all, caption: 'All todos' }, { id: doneOnly, caption: 'Done filter' }],
    appPath: '/',
  });
  return done(`Added All / Active / Done filters. Operator feedback: ${answer.content[0].text}`, 31200, 3400);
}

async function showCount(options) {
  const tools = browser(options);
  options.onProgress?.('Checking the footer in the running app');
  await addTodo(tools, 'Call the plumber', 1400);
  const page = await tools.call('dispatch_browser_snapshot');
  await sleep(1200);
  await tools.call('dispatch_browser_click', { ref: tools.ref(page, /checkbox "Buy oat milk" \[ref=(e\d+)\]/) });
  await sleep(1400);
  await tools.shot();
  writeFiles(options.workspace, { 'test/count.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add, remaining, toggle } from '../public/todos.mjs';\n\ntest('counts todos left', () => {\n  const list = add(add([], 'a'), 'b');\n  assert.equal(remaining(toggle(list, list[0].id)), 1);\n});\n" });
  return done('The footer already counts todos left; ticking one updates it. Added a test for the count.', 22800, 1800);
}

async function waitForAbort(options) {
  options.onProgress?.('Adding localStorage load and save to public/app.mjs');
  await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
  return { outcome: 'cancelled', sessionId: 'demo-session' };
}

const behaviors = [
  [tickets.filters, reviewFilters],
  [tickets.count, showCount],
  [tickets.storage, waitForAbort],
  [tickets.shortcut, waitForAbort],
  [tickets.sort, () => ({ outcome: 'blocked', sessionId: 'demo-session', summary: 'DISPATCH_BLOCKED: What should "important" mean?\n1. Starred todos first (Recommended) — adds a star toggle to each row\n2. Oldest todos first — no new controls', usage: usage(9100, 600) })],
  [tickets.strike, ({ workspace }) => { writeFileSync(join(workspace, 'public/style.css'), baseFiles['public/style.css'].replace('color: #a8a29e;', 'color: #a8a29e; opacity: .8;')); return done('Completed todos are grey and struck through.'); }],
  [tickets.empty, ({ workspace }) => { writeFileSync(join(workspace, 'test/blank.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../public/todos.mjs';\n\ntest('ignores blank todos', () => assert.deepEqual(add([], '  '), []));\n"); return done('add() already ignored blank text; added a regression test.'); }],
  [tickets.clear, ({ workspace }) => { writeFileSync(join(workspace, 'public/todos.mjs'), `${baseFiles['public/todos.mjs']}export const clearCompleted = list => list.filter(todo => !todo.done);\n`); return done('Added clearCompleted() and a footer button.'); }],
];

// Scripted stand-in for a coding CLI so the README media is reproducible; it never touches provider credentials.
export const agentDouble = {
  contract: { writableRoots: true },
  capabilities: async () => ({ available: true, authenticated: true, version: 'readme-demo' }),
  models: async () => ({ available: true, message: 'Demo catalog', models: [{ model: 'gpt-5.5-codex', displayName: 'GPT-5.5 Codex', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }] }),
  run: async options => {
    options.onSession('demo-session');
    if (options.readOnly) return done('{"approved":true,"findings":[]}', 6000, 200);
    const behavior = behaviors.find(([ticket]) => options.prompt.includes(ticket))?.[1];
    return behavior ? behavior(options) : done('Done.');
  },
};

async function todoRepository(dataDir) {
  const repo = join(dataDir, 'todo-app');
  writeFiles(repo, baseFiles);
  await git(repo, ['init', '-b', 'main']); await git(repo, ['add', '.']);
  await git(repo, ['-c', 'user.name=demo', '-c', 'user.email=demo@localhost', 'commit', '-m', 'Todo app']);
  return repo;
}

export async function startWorld(port = 0) {
  const dataDir = mkdtempSync(join(tmpdir(), 'dispatch-readme-demo-'));
  const engine = new Engine({ dataDir });
  const live = new LiveService(engine, { adapter: agentDouble });
  const project = await live.saveProject({ name: 'todo-app', repositoryPath: await todoRepository(dataDir), baseBranch: 'main', confirmed: true, validation: [{ id: 'test', command: process.execPath, args: ['--test'] }], browser: { enabled: true, headed: false }, memory: false });
  const server = createServer(engine);
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const stop = async () => { server.close(); await engine.shutdown(); rmSync(dataDir, { recursive: true, force: true }); };
  return { url: `http://127.0.0.1:${server.address().port}`, project, engine, stop };
}
