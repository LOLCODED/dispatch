import { mkdirSync, existsSync, readdirSync, readFileSync, lstatSync, realpathSync, copyFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, extname, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { contextImageLimits } from './context-images.mjs';
import { contextFileTypes } from './context-files.mjs';

const extensions = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webm': 'video/webm', '.zip': 'application/zip', '.patch': 'text/x-patch' };
const artifactExtensions = { ...extensions, ...contextFileTypes };
const under = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep); };
function files(root, max = 300) {
  const found = [];
  const walk = path => {
    if (found.length >= max || !existsSync(path)) return;
    const stat = lstatSync(path); if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) { for (const name of readdirSync(path).slice(0, max)) { if (found.length >= max) break; walk(join(path, name)); } }
    else if (stat.isFile() && extensions[extname(path).toLowerCase()]) found.push({ path, size: stat.size, modified: stat.mtimeMs });
  };
  walk(root); return found;
}
const maxArtifacts = 80, maxTotalBytes = 80000000, maxStepArtifacts = 400, maxStepBytes = 60000000;
const checkArtifacts = run => run.artifacts.filter(artifact => artifact.source !== 'browser');
const totalBytes = run => checkArtifacts(run).reduce((sum, artifact) => sum + (artifact.size ?? 0), 0);
function decodeImage(image, maxBytes = 1000000) {
  const extension = image?.mimeType === 'image/png' ? '.png' : image?.mimeType === 'image/jpeg' ? '.jpg' : null;
  if (!extension || typeof image.data !== 'string' || image.data.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) return null;
  const bytes = Buffer.from(image.data, 'base64');
  if (bytes.length > maxBytes || bytes.toString('base64') !== image.data || (extension === '.png' ? !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)) return null;
  return { extension, bytes };
}
export function decodeContextImages(images) {
  if (!Array.isArray(images) || images.length > contextImageLimits.count) return null;
  const decoded = images.map(image => decodeImage(image, contextImageLimits.bytes));
  return decoded.every(Boolean) ? decoded : null;
}
export class BrowserEvidence {
  constructor(dataDir) { this.root = join(resolve(dataDir), 'live-artifacts'); this.pointers = new Map(); mkdirSync(this.root, { recursive: true }); }
  directory(run) { return join(this.root, run.id); }
  shouldCapture(step) { return step.browser === true || /browser|playwright|e2e/i.test([step.id, step.command, ...step.args].join(' ')); }
  scanWorkspace(run) { return ['test-results', 'playwright-report'].flatMap(name => files(join(run.workspace, name))).filter(file => under(realpathSync(run.workspace), realpathSync(file.path))); }
  start(run, step) {
    if (!this.shouldCapture(step)) return null;
    return { check: step.id, before: new Map(this.scanWorkspace(run).map(file => [file.path, `${file.modified}:${file.size}`])) };
  }
  observeAgent(run, observation, { stepId = null } = {}) {
    if (observation.pointer) this.pointers.set(run.id, observation.pointer);
    const pointer = this.pointers.get(run.id);
    let saved = false;
    for (const image of (observation.images ?? []).slice(0, 4)) {
      const decoded = decodeImage(image);
      if (!decoded || checkArtifacts(run).length >= maxArtifacts || totalBytes(run) + decoded.bytes.length > maxTotalBytes) continue;
      const { extension, bytes } = decoded, id = randomUUID(), number = run.artifacts.filter(artifact => artifact.source === 'agent').length + 1;
      mkdirSync(this.directory(run), { recursive: true });
      writeFileSync(join(this.directory(run), id + extension), bytes, { flag: 'wx', mode: 0o600 });
      // Captures are observations, not proof that a mandatory check passed.
      run.artifacts.push({ id, name: `Agent browser ${number}${extension}`, extension, mimeType: image.mimeType, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), attempt: run.attempt, revision: null, source: 'agent', check: 'Agent browser', capturedAt: new Date().toISOString(), ...(stepId && { stepId }), ...(pointer && { pointer }) });
      saved = true;
    }
    return saved;
  }
  keepStep(run, { data, mimeType = 'image/jpeg', stepId = null }) {
    const decoded = decodeImage({ data, mimeType });
    const kept = run.artifacts.filter(artifact => artifact.source === 'browser'), bytes = kept.reduce((sum, artifact) => sum + (artifact.size ?? 0), 0);
    if (!decoded || kept.length >= maxStepArtifacts || bytes + decoded.bytes.length > maxStepBytes) return null;
    const id = randomUUID(); mkdirSync(this.directory(run), { recursive: true });
    writeFileSync(join(this.directory(run), id + decoded.extension), decoded.bytes, { flag: 'wx', mode: 0o600 });
    const artifact = { id, name: `Browser step ${kept.length + 1}${decoded.extension}`, extension: decoded.extension, mimeType, size: decoded.bytes.length, sha256: createHash('sha256').update(decoded.bytes).digest('hex'), attempt: run.attempt, revision: null, source: 'browser', check: 'dispatch browser', capturedAt: new Date().toISOString(), ...(stepId && { stepId }) };
    run.artifacts.push(artifact); return artifact;
  }
  attach(run, { images, files }, origin) { return images.length || files.length ? [...this.attachContext(run, images, origin), ...this.attachFiles(run, files, origin)] : []; }
  attachContext(run, decoded, { check = 'Ticket', attempt = 0 } = {}) {
    mkdirSync(this.directory(run), { recursive: true });
    const earlier = run.artifacts.filter(artifact => artifact.source === 'context').length;
    return decoded.map(({ extension, bytes }, index) => {
      const id = randomUUID(), mimeType = extensions[extension];
      writeFileSync(join(this.directory(run), id + extension), bytes, { flag: 'wx', mode: 0o600 });
      const artifact = { id, name: `Pasted image ${earlier + index + 1}${extension}`, extension, mimeType, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), attempt, revision: null, source: 'context', check, capturedAt: new Date().toISOString() };
      run.artifacts.push(artifact); return artifact;
    });
  }
  contextPaths(run) { return run.artifacts.filter(artifact => artifact.source === 'context').map(artifact => this.artifact(run, artifact.id)?.path).filter(Boolean); }
  attachFiles(run, decoded, { check = 'Ticket', attempt = 0 } = {}) {
    mkdirSync(this.directory(run), { recursive: true });
    return decoded.map(({ name, extension, mimeType, bytes }) => {
      const id = randomUUID();
      writeFileSync(join(this.directory(run), id + extension), bytes, { flag: 'wx', mode: 0o600 });
      const artifact = { id, name, extension, mimeType, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), attempt, revision: null, source: 'context-file', check, capturedAt: new Date().toISOString() };
      run.artifacts.push(artifact); return artifact;
    });
  }
  forget(run) { this.pointers.delete(run.id); }
  finish(run, observation, options = {}) {
    if (!observation) return 0;
    const fresh = this.scanWorkspace(run).filter(file => observation.before.get(file.path) !== `${file.modified}:${file.size}`);
    return this.keep(run, fresh.map(file => ({ ...file, name: relative(run.workspace, file.path) })), observation.check, copyFileSync, options);
  }
  adopt(run, artifacts, check, options = {}) {
    const files = artifacts.filter(item => existsSync(item.path) && !lstatSync(item.path).isSymbolicLink()).map(item => ({ path: item.path, name: item.name, size: lstatSync(item.path).size }));
    return this.keep(run, files, check, renameSync, options);
  }
  keep(run, files, check, move, { stepId = null } = {}) {
    const directory = this.directory(run); mkdirSync(directory, { recursive: true });
    let bytes = totalBytes(run), skipped = 0;
    for (const file of files) {
      const extension = extname(file.path).toLowerCase(), id = randomUUID();
      if (!extensions[extension] || checkArtifacts(run).length >= maxArtifacts || file.size > 20000000 || bytes + file.size > maxTotalBytes) { skipped++; continue; }
      move(file.path, join(directory, id + extension)); bytes += file.size;
      run.artifacts.push({ id, name: file.name, extension, mimeType: extensions[extension], size: file.size,
        sha256: createHash('sha256').update(readFileSync(join(directory, id + extension))).digest('hex'), attempt: run.attempt, revision: run.revision, check, capturedAt: new Date().toISOString(), ...(stepId && { stepId }) });
    }
    return skipped;
  }
  artifact(run, id) {
    const item = run.artifacts.find(a => a.id === id); if (!item || !Object.hasOwn(artifactExtensions, item.extension) || !/^[a-f0-9-]{36}$/.test(id)) return null;
    const path = join(this.directory(run), id + item.extension);
    if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !under(realpathSync(this.directory(run)), realpathSync(path))) return null;
    return { ...item, path };
  }
}
