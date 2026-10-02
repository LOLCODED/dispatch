import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { root } from './app-assets.mjs';
import { InputError } from './engine.mjs';
import { zipEntries } from './zip.mjs';
import { listComponents } from './components.mjs';

const types = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webm': 'video/webm', '.zip': 'application/zip', '.patch': 'text/x-patch; charset=utf-8' };
const viewerTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.png': 'image/png' };
const viewerRoot = join(root, 'node_modules', 'playwright-core', 'lib', 'vite', 'traceViewer');
// Playwright ships its trace viewer as static files; serving them same-origin lets a check's trace.zip open in place.
export function snapshotTraceViewer(directory = viewerRoot) {
  const files = new Map();
  if (!existsSync(directory)) return files;
  const read = (folder, prefix) => { for (const entry of readdirSync(folder, { withFileTypes: true })) { if (entry.isDirectory()) { if (entry.name === 'assets' && !prefix) read(join(folder, entry.name), 'assets/'); continue; } if (viewerTypes[extname(entry.name)]) files.set(`${prefix}${entry.name}`, readFileSync(join(folder, entry.name))); } };
  read(directory, '');
  return files;
}
const inlineTypes = /^(?:image\/|video\/webm|application\/zip|text\/x-patch)/;
const safeName = name => name.split('/').at(-1).replace(/[^a-zA-Z0-9._-]/g, '_');
const json = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };

function exportZip(live, run) {
  const entries = [{ name: 'run.json', data: JSON.stringify({ exportedAt: new Date().toISOString(), run }, null, 2) }];
  const steps = live.steps.path(run.id); if (existsSync(steps)) entries.push({ name: 'steps.jsonl', data: readFileSync(steps) });
  for (const suffix of ['', '.1']) { const log = `${live.logRoot}/${run.id}${suffix}.jsonl`; if (existsSync(log)) entries.push({ name: `live-log${suffix}.jsonl`, data: readFileSync(log) }); }
  const artifacts = [];
  for (const item of run.artifacts ?? []) { const file = live.browserEvidence.artifact(run, item.id); if (file) { entries.push({ name: `artifacts/${item.id}${item.extension}`, data: readFileSync(file.path) }); artifacts.push({ ...item, file: `artifacts/${item.id}${item.extension}` }); } }
  entries.push({ name: 'artifacts.json', data: JSON.stringify(artifacts, null, 2) });
  return zipEntries(entries);
}

// Evidence routes: steps, exports and artifacts. Returns true when the request was handled.
export async function evidenceRoute({ live, engine, viewRun, traceViewer }, req, res, url, path) {
  if (req.method !== 'GET') return false;
  const viewer = path.match(/^\/trace-viewer\/((?:assets\/)?[A-Za-z0-9_.-]+)$/);
  if (viewer) { const file = traceViewer?.get(viewer[1]); if (!file) throw new InputError('Not found', 404); res.writeHead(200, { 'Content-Type': viewerTypes[extname(viewer[1])] }); res.end(file); return true; }
  const steps = path.match(/^\/api\/runs\/([a-f0-9-]+)\/steps$/);
  if (steps) { engine.get(steps[1]); json(res, 200, await live.steps.read(steps[1], { after: Number(url.searchParams.get('after') ?? 0) || 0, limit: Number(url.searchParams.get('limit') ?? 200) || 200 })); return true; }
  const components = path.match(/^\/api\/runs\/([a-f0-9-]+)\/components$/);
  if (components) { const run = engine.get(components[1]); json(res, 200, { components: run.workspace && existsSync(run.workspace) ? listComponents(run.workspace) : [] }); return true; }
  const exportRun = path.match(/^\/api\/runs\/([a-f0-9-]+)\/export$/);
  if (exportRun) {
    const run = engine.get(exportRun[1]), name = `dispatch-${run.ticketId}-${run.id.slice(0, 8)}`;
    if (url.searchParams.get('format') === 'zip') { const zip = exportZip(live, run); res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': zip.length, 'Content-Disposition': `attachment; filename="${name}.zip"` }); res.end(zip); return true; }
    res.setHeader('Content-Disposition', `attachment; filename="${name}.json"`); json(res, 200, { exportedAt: new Date().toISOString(), run: viewRun(run) }); return true;
  }
  const artifact = path.match(/^\/api\/runs\/([a-f0-9-]+)\/artifacts\/([a-f0-9-]+)$/);
  if (artifact) {
    const run = engine.get(artifact[1]), file = live.browserEvidence.artifact(run, artifact[2]);
    if (!file) throw new InputError('Artifact not found', 404);
    const type = file.mimeType ?? types[extname(file.name)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Disposition': `${url.searchParams.has('inline') && inlineTypes.test(type) ? 'inline' : 'attachment'}; filename="${safeName(file.name)}"` });
    res.end(readFileSync(file.path)); return true;
  }
  return false;
}
