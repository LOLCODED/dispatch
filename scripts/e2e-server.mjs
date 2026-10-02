import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '../src/engine.mjs';
import { LiveService } from '../src/live.mjs';
import { root } from '../src/app-assets.mjs';
import { git } from '../src/local-tools.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from '../src/server.mjs';
import { forgeDouble } from '../tests/forge-double.mjs';
import { exampleTracker } from '../tests/tracker-double.mjs';
const dataDir = mkdtempSync(join(tmpdir(), 'dispatch-e2e-'));
const engine = new Engine({ dataDir });
const serveScript = throwing => `import { createServer } from 'node:http';
createServer((request, response) => { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>Smoke fixture</title><h1>Smoke fixture</h1>${throwing ? '<script>throw new Error("fixture page error")</script>' : ''}'); }).listen(Number(process.env.PORT) || 0, '127.0.0.1');
setInterval(() => {}, 1000);
`;
const linkedPaths = prompt => new Map([...(prompt.split('LINKED REPOSITORIES')[1] ?? '').split('\n\n')[0].matchAll(/^- (.+?): (\S+)/gm)].map(([, name, path]) => [name, path]));
// Controlled CLI double for browser tests; never invokes provider credentials.
const worker = {
  contract: { writableRoots: true },
  models: async () => ({ available: true, message: 'Test model catalog', models: [
    { model: 'test-sol', displayName: 'Test Sol', isDefault: true, defaultReasoningEffort: 'high', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] },
    { model: 'test-luna', displayName: 'Test Luna', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }] },
  ] }),
  capabilities: async () => ({ available: true, authenticated: true, version: 'browser-test-double' }),
  limits: async () => ({ available: true, source: 'live', plan: 'test-plan', windows: [{ label: 'Weekly', usedPercent: 42, resetsAt: '2026-10-03T12:00:00.000Z' }], limited: false, observedAt: new Date().toISOString(), message: 'Reported by the test double.' }),
  run: async options => {
    if (options.readOnly && options.prompt.includes('QUESTION:')) { options.onSession('browser-answer-session'); return { outcome: 'completed', sessionId: 'browser-answer-session', summary: 'The value is stored in value.txt:1 and read nowhere else.', usage: { input_tokens: 20, cached_input_tokens: 0, output_tokens: 5 } }; }
    if (!options.readOnly && !options.sessionId && options.prompt.includes('Where is the value stored?')) { options.onSession('browser-session'); return { outcome: 'completed', sessionId: 'browser-session', summary: 'The value is stored in value.txt:1 and read nowhere else.\nDISPATCH_ANSWERED', usage: { input_tokens: 20, cached_input_tokens: 0, output_tokens: 5 } }; }
    if (options.readOnly) { options.onSession('browser-review-session'); return { outcome: 'completed', sessionId: 'browser-review-session', summary: '{"approved":true,"findings":[]}', usage: { input_tokens: 20, cached_input_tokens: 0, output_tokens: 5 } }; }
    if (options.prompt.includes('Ask for the value policy') && !options.sessionId) { options.onSession('browser-session'); return { outcome: 'blocked', sessionId: 'browser-session', summary: 'DISPATCH_BLOCKED: Which value policy should I use? <script>unsafe</script>' }; }
    if (/numbered choices/i.test(options.prompt) && !options.sessionId) { options.onSession('browser-session'); return { outcome: 'blocked', sessionId: 'browser-session', summary: 'DISPATCH_BLOCKED: Which status code should expired tokens return?\n1. Return 401 (Recommended)\n2. Redirect to login' }; }
    if (options.prompt.includes('Wait for an interruption')) {
      options.onSession('browser-session'); options.onProgress('Reading the repository and planning the change');
      await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      return { outcome: 'cancelled', sessionId: 'browser-session' };
    }
    if (options.prompt.includes('Change only one of them') && !options.sessionId) { options.onSession('browser-session'); writeFileSync(join(linkedPaths(options.prompt).get('Frontend repository'), 'value.txt'), 'changed'); return { outcome: 'completed', sessionId: 'browser-session', summary: 'Changed one repository only.' }; }
    options.onSession('browser-session'); options.onEvent('message', 'Browser test worker is editing.');
    if (options.prompt.includes('Change all three')) for (const path of linkedPaths(options.prompt).values()) writeFileSync(join(path, 'value.txt'), 'changed');
    if (options.prompt.includes('Use the agent browser')) {
      options.onBrowser({ phase: 'started', label: 'browser/computer', pointer: { x: 0, y: 0, action: 'left_click' } });
      options.onBrowser({ phase: 'started', label: 'browser/take_screenshot' });
      options.onBrowser({ phase: 'completed', label: 'browser/take_screenshot', images: [{ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jcEIAAAAASUVORK5CYII=' }] });
    }
    options.onEvent('tool', 'node inspect.mjs\nCollapsed tool output');
    if (options.prompt.includes('Scaffold a small app')) { writeFileSync(join(options.workspace, 'package.json'), JSON.stringify({ scripts: { dev: 'node serve.mjs', test: 'node -e 0' } })); writeFileSync(join(options.workspace, 'serve.mjs'), serveScript(false)); }
    if (options.prompt.includes('Drive the dispatch browser') && options.tools) {
      const call = async (name, args) => { const result = await options.tools.call(name, args); if (result.isError) throw new Error(result.content[0].text); return result; };
      await call('dispatch_browser_navigate', { url: 'app:/' });
      const snapshot = await call('dispatch_browser_snapshot', {});
      const ref = snapshot.content[0].text.match(/button "Count" \[ref=(e\d+)\]/)?.[1];
      if (ref) await call('dispatch_browser_click', { ref });
      await call('dispatch_browser_screenshot', {});
      await call('dispatch_browser_console', {});
    }
    if (options.prompt.includes('Ask a scope question')) await options.onQuestion([{ id: 'scope', question: 'Which scope should I implement?', options: [{ label: 'Small', description: 'A focused change.' }, { label: 'Full', description: 'The whole task.' }] }]);
    try { await sleep(400, undefined, { signal: options.signal }); } catch { return { outcome: 'cancelled' }; }
    writeFileSync(join(options.workspace, 'value.txt'), 'changed');
    if (options.prompt.includes('Add a table and a test')) { mkdirSync(join(options.workspace, 'db'), { recursive: true }); writeFileSync(join(options.workspace, 'db', '001_table.sql'), 'CREATE TABLE widgets (id int);\n'); writeFileSync(join(options.workspace, 'value.test.js'), 'test'); }
    if (!existsSync(join(options.workspace, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(options.workspace, 'node_modules'));
    return { outcome: 'completed', sessionId: 'browser-session', summary: 'Local change complete.', usage: { input_tokens: 120, cached_input_tokens: 80, output_tokens: 30 } };
  }
};
const provider = models => ({ ...worker, models: async () => ({ available: models.length > 0, message: 'Test provider catalog', models }) });
// Tracker and code-host doubles: no tracker or code-host process ever runs in the browser suite.
const trackerDouble = exampleTracker(), forge = forgeDouble({ checks: [{ name: 'ci', status: 'completed', conclusion: 'success' }] });
const live = new LiveService(engine, { adapter: worker, createRoot: dataDir, connectors: [trackerDouble.connector, forge.connector], adapters: {
  claude: provider([{ model: 'opus', displayName: 'Opus', defaultReasoningEffort: null, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }]),
  'local-models': provider([{ model: 'ollama/qwen3.6:latest', displayName: 'qwen3.6:latest · Ollama', defaultReasoningEffort: null, supportedReasoningEfforts: [] }]),
} });
const connected = { available: true, authenticated: true, detail: 'Test connection', version: 'browser-test-double' };
live.connections = async () => ({ ...Object.fromEntries(live.providers.enabledIds().map(id => [id, id === 'local-models' ? { ...connected, endpoints: live.localEndpoints.map(endpoint => ({ id: endpoint.id, reachable: true, version: 'Ollama test' })) } : connected])), connectors: { forge: { enabled: false, available: false }, example: { enabled: false, available: false, detail: 'Test tracker unavailable' } } });
for (const name of ['repository', 'second']) {
  const repo = join(dataDir, name); mkdirSync(repo); writeFileSync(join(repo, 'value.txt'), 'original');
  writeFileSync(join(repo, '.gitignore'), 'node_modules\ntest-results/\n');
  writeFileSync(join(repo, 'browser-check.mjs'), `import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const browser = await chromium.launch();
const context = await browser.newContext();
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
await page.setContent('<html><head><title>dispatch browser fixture</title></head><body><h1>Browser check in progress</h1><button>Test button</button></body></html>');
await page.getByRole('button').click();
mkdirSync('test-results', { recursive: true });
await page.screenshot({ path: 'test-results/result.png' });
await context.tracing.stop({ path: 'test-results/trace.zip' });
await browser.close();
`);
  if (name === 'second') writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node -e 0', dev: 'node -e "setInterval(() => {}, 1000)"' } }));
  await git(repo, ['init', '-b', 'main']); await git(repo, ['add', '.']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
  if (name === 'repository') await live.saveProject({ name: 'Browser test repository', repositoryPath: repo, baseBranch: 'main', confirmed: true, validation: [{ id: 'unit', command: process.execPath, args: ['-e', 'if(require("fs").readFileSync("value.txt","utf8")!=="changed")process.exit(1)'] }, { id: 'browser', command: process.execPath, args: ['browser-check.mjs'], timeoutSeconds: 30 }] });
}
{
  const repo = join(dataDir, 'tracker'); mkdirSync(repo); writeFileSync(join(repo, 'value.txt'), 'original');
  await git(repo, ['init', '-b', 'main']); await git(repo, ['add', '.']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
  await live.saveProject({ name: 'Tracker repository', repositoryPath: repo, baseBranch: 'main', confirmed: true, validation: [{ id: 'unit', command: process.execPath, args: ['-e', 'if(require("fs").readFileSync("value.txt","utf8")!=="changed")process.exit(1)'] }], connectors: { example: { enabled: true, actions: { state: true } }, forge: { enabled: true, actions: { push: true, openPullRequest: true } } } });
}
{
  const repo = join(dataDir, 'browser-tool'); mkdirSync(repo); writeFileSync(join(repo, 'value.txt'), 'original');
  writeFileSync(join(repo, 'serve.mjs'), `import { createServer } from 'node:http';
createServer((request, response) => {
  const visits = Number((request.headers.cookie ?? '').match(/visits=(\\d+)/)?.[1] ?? 0) + 1;
  response.setHeader('set-cookie', 'visits=' + visits + '; Path=/; Max-Age=86400');
  response.setHeader('content-type', 'text/html');
  response.end('<!doctype html><title>Browser tool fixture visit ' + visits + '</title><h1>Browser tool fixture</h1><button id="count" onclick="this.textContent=\\'Clicked\\'">Count</button>');
}).listen(Number(process.env.PORT) || 0, '127.0.0.1');
setInterval(() => {}, 1000);
`);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { dev: 'node serve.mjs' } }));
  mkdirSync(join(repo, 'components')); writeFileSync(join(repo, 'components', 'Hero.jsx'), 'export function Hero() { return null; }\n');
  await git(repo, ['init', '-b', 'main']); await git(repo, ['add', '.']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
  await live.saveProject({ name: 'Browser tool repository', repositoryPath: repo, baseBranch: 'main', confirmed: true, validation: [{ id: 'unit', command: process.execPath, args: ['-e', 'if(require("fs").readFileSync("value.txt","utf8")!=="changed")process.exit(1)'] }], browser: { enabled: true, headed: false } });
}
for (const [name, label, baseBranch] of [['frontend', 'Frontend repository', 'main'], ['service', 'Service repository', 'staging']]) {
  const repo = join(dataDir, name); mkdirSync(repo); writeFileSync(join(repo, 'value.txt'), 'original');
  await git(repo, ['init', '-b', 'main']); await git(repo, ['add', '.']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
  if (baseBranch !== 'main') await git(repo, ['branch', baseBranch, 'main']);
  await live.saveProject({ name: label, repositoryPath: repo, baseBranch, confirmed: true, validation: [{ id: 'unit', command: process.execPath, args: ['-e', 'if(require("fs").readFileSync("value.txt","utf8")!=="changed")process.exit(1)'] }] });
}
for (const name of ['smoke', 'smoke-broken']) {
  const repo = join(dataDir, name); mkdirSync(repo); writeFileSync(join(repo, 'value.txt'), 'original');
  writeFileSync(join(repo, 'serve.mjs'), serveScript(name === 'smoke-broken'));
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { dev: 'node serve.mjs' } }));
  await git(repo, ['init', '-b', 'main']); await git(repo, ['add', '.']); await git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'Initial']);
  await live.saveProject({ name: name === 'smoke' ? 'Smoke repository' : 'Broken smoke repository', repositoryPath: repo, baseBranch: 'main', confirmed: true, validation: [{ id: 'browser-smoke', kind: 'browser-smoke' }] });
}
{
  const folder = join(dataDir, 'plain-folder'); mkdirSync(folder); writeFileSync(join(folder, 'value.txt'), 'original');
  await live.saveProject({ name: 'Plain folder', repositoryPath: folder, baseBranch: null, confirmed: true, validation: [{ id: 'unit', command: process.execPath, args: ['-e', 'if(require("fs").readFileSync("value.txt","utf8")!=="changed")process.exit(1)'] }] });
}
const server = createServer(engine);
const port = Number(process.env.DISPATCH_E2E_PORT ?? 4318);
server.listen(port, '127.0.0.1', () => console.log(`dispatch e2e server ready on ${port}`));
process.on('SIGTERM', async () => { server.close(); await engine.shutdown(); rmSync(dataDir, { recursive: true, force: true }); });
