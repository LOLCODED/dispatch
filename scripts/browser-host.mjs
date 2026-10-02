import { chromium } from 'playwright';
import { createInterface } from 'node:readline';

const option = name => { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : undefined; };
const profile = option('profile'), headless = !process.argv.includes('--headed');
const viewport = { width: 1280, height: 800 }, actionTimeout = 15_000, consoleLimit = 200, elementLimit = 120;
let context = null, page = null, consoleEntries = [];

// Runs inside the page: the visible building blocks with their viewport boxes, in document order, so a screenshot can be edited later.
function pageElements(limit) {
  const containers = 'header,nav,main,section,footer,aside,article,form,ul,ol,figure,table';
  const selector = `${containers},h1,h2,h3,h4,h5,h6,p,a,button,img,picture,video,li,input,textarea,select,label,blockquote,[role]`;
  const text = node => (node.getAttribute('aria-label') || node.alt || node.placeholder || (node.matches(containers) ? node.querySelector('h1,h2,h3,h4,h5,h6,legend,figcaption,caption')?.innerText : node.innerText) || node.title || node.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const path = node => {
    const parts = [];
    for (let current = node; current && current !== document.body && parts.length < 8; current = current.parentElement) {
      if (current.id) { parts.unshift(`#${CSS.escape(current.id)}`); break; }
      const same = [...current.parentElement?.children ?? []].filter(sibling => sibling.localName === current.localName);
      parts.unshift(same.length > 1 ? `${current.localName}:nth-of-type(${same.indexOf(current) + 1})` : current.localName);
    }
    return parts.join(' > ').slice(0, 160);
  };
  const found = [];
  for (const node of document.querySelectorAll(selector)) {
    if (found.length >= limit) break;
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    if (box.width < 4 || box.height < 4 || box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth || style.visibility === 'hidden' || style.display === 'none' || node.closest('[aria-hidden="true"]')) continue;
    found.push({ tag: node.localName, role: node.getAttribute('role') || undefined, text: text(node), selector: path(node), box: { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) } });
  }
  return found;
}

const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const remember = entry => { consoleEntries.push(entry); if (consoleEntries.length > consoleLimit) consoleEntries.shift(); };
function watch(target) {
  target.on('console', message => remember({ type: message.type(), text: message.text().slice(0, 500), at: new Date().toISOString() }));
  target.on('pageerror', error => remember({ type: 'pageerror', text: String(error?.message ?? error).slice(0, 500), at: new Date().toISOString() }));
}
async function launch() {
  context = await chromium.launchPersistentContext(profile, { headless, viewport, deviceScaleFactor: 1, serviceWorkers: 'allow' });
  context.on('page', watch);
  page = context.pages()[0] ?? await context.newPage();
  watch(page);
  return { ok: true };
}
const current = () => { if (!page || page.isClosed()) page = context.pages().at(-1) ?? null; if (!page) throw new Error('The browser has no open page; navigate first.'); return page; };
const locate = ref => { if (!/^(?:f\d{1,5})?e\d{1,5}$/.test(String(ref))) throw new Error('Element refs look like e12 or f1e12; take a snapshot first.'); return current().locator(`aria-ref=${ref}`); };
const snapshot = async () => (await current().ariaSnapshot({ mode: 'ai' })).slice(0, 40_000);
async function observe(withScreenshot) {
  const target = current(), errors = consoleEntries.filter(entry => ['error', 'pageerror'].includes(entry.type)).slice(-20);
  const screenshot = withScreenshot ? (await target.screenshot({ type: 'jpeg', quality: 70, scale: 'css' })).toString('base64') : null;
  const elements = withScreenshot ? await target.evaluate(pageElements, elementLimit).catch(() => []) : undefined;
  return { url: target.url(), title: await target.title().catch(() => ''), consoleErrors: errors, screenshot, elements };
}
const accessibleLabel = element => (element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.innerText || element.getAttribute('placeholder') || element.getAttribute('title') || element.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
async function box(ref) {
  try {
    const element = locate(ref), bounds = await element.boundingBox({ timeout: 2000 });
    return bounds && { ...bounds, label: await element.evaluate(accessibleLabel, undefined, { timeout: 2000 }).catch(() => '') || null };
  } catch { return null; }
}
async function act(op, args = {}) {
  const target = op === 'launch' ? null : current();
  switch (op) {
    case 'navigate': await target.goto(String(args.url), { waitUntil: 'load', timeout: actionTimeout }); await target.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {}); return {};
    case 'click': { const targetBox = await box(args.ref); await locate(args.ref).click({ timeout: actionTimeout }); return { target: targetBox }; }
    case 'hover': { const targetBox = await box(args.ref); await locate(args.ref).hover({ timeout: actionTimeout }); return { target: targetBox }; }
    case 'resize': await target.setViewportSize({ width: args.width, height: args.height }); return {};
    case 'type': { const targetBox = await box(args.ref); await locate(args.ref).fill(String(args.text ?? ''), { timeout: actionTimeout }); if (args.submit) await target.keyboard.press('Enter'); return { target: targetBox }; }
    case 'press': await target.keyboard.press(String(args.key)); return {};
    case 'select': { const targetBox = await box(args.ref); await locate(args.ref).selectOption((args.values ?? []).map(String), { timeout: actionTimeout }); return { target: targetBox }; }
    case 'scroll': { const amount = Number(args.amount ?? 600) * (args.direction === 'up' ? -1 : 1); if (args.ref) await locate(args.ref).evaluate((element, delta) => element.scrollBy(0, delta), amount); else await target.mouse.wheel(0, amount); return {}; }
    case 'wait': {
      if (args.text) await target.getByText(String(args.text)).first().waitFor({ timeout: Math.min(Number(args.ms ?? 30_000), 30_000) });
      else if (args.ref) await locate(args.ref).waitFor({ timeout: Math.min(Number(args.ms ?? 30_000), 30_000) });
      else await target.waitForTimeout(Math.min(Number(args.ms ?? 1000), 30_000));
      return {};
    }
    case 'back': await target.goBack({ timeout: actionTimeout }).catch(() => {}); return {};
    case 'snapshot': return { snapshot: await snapshot() };
    case 'screenshot': return { image: (await target.screenshot({ type: 'jpeg', quality: 70, scale: 'css', fullPage: args.fullPage === true })).toString('base64') };
    case 'console': { const entries = consoleEntries.slice(-50); if (args.clear) consoleEntries = []; return { entries }; }
    default: throw new Error(`Unknown browser operation ${op}.`);
  }
}
const withSnapshot = new Set(['navigate', 'click', 'hover', 'resize', 'type', 'press', 'select', 'scroll', 'wait', 'back']);
async function handle(request) {
  try {
    if (request.op === 'launch') return send({ id: request.id, ok: true, result: await launch() });
    if (request.op === 'close') { await context?.close().catch(() => {}); send({ id: request.id, ok: true, result: {} }); process.exit(0); }
    const result = await act(request.op, request.args);
    const extra = withSnapshot.has(request.op) ? { snapshot: await snapshot().catch(() => '') } : {};
    send({ id: request.id, ok: true, result: { ...result, ...extra, ...await observe(request.op !== 'snapshot' && request.op !== 'console') } });
  } catch (error) {
    let observed = {}; try { observed = await observe(true); } catch { /* No page to observe. */ }
    send({ id: request.id, ok: false, error: String(error?.message ?? error).slice(0, 2000), result: observed });
  }
}
let queue = Promise.resolve();
createInterface({ input: process.stdin }).on('line', line => { let request; try { request = JSON.parse(line); } catch { return; } queue = queue.then(() => handle(request)); });
process.stdin.on('end', async () => { await context?.close().catch(() => {}); process.exit(0); });
process.on('SIGTERM', async () => { await context?.close().catch(() => {}); process.exit(0); });
