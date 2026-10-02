const refPattern = /^(?:f\d{1,5})?e\d{1,5}$/;
const stepLimits = { args: 2000, snapshot: 40_000 };
const elementLimits = { count: 120, characters: 12_000, text: 60, selector: 160, tag: 32 };
const coordinate = value => Number.isFinite(value) && Math.abs(value) <= 100_000;

function pageElement(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.tag !== 'string' || !raw.box || !['x', 'y', 'width', 'height'].every(key => coordinate(raw.box[key]))) return null;
  const role = typeof raw.role === 'string' && raw.role ? { role: raw.role.slice(0, elementLimits.tag) } : {};
  return { tag: raw.tag.slice(0, elementLimits.tag), ...role, text: String(raw.text ?? '').slice(0, elementLimits.text), selector: String(raw.selector ?? '').slice(0, elementLimits.selector), box: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(raw.box[key])])) };
}

// Fewer elements rather than a truncated step line: the step log caps each record at 32 KB.
export function boundElements(list) {
  if (!Array.isArray(list)) return null;
  const elements = list.slice(0, elementLimits.count).map(pageElement).filter(Boolean);
  while (elements.length && JSON.stringify(elements).length > elementLimits.characters) elements.pop();
  return elements;
}

export function validateBrowserArgs(name, args = {}) {
  const op = name.replace(/^dispatch_browser_/, '');
  if (op === 'navigate') {
    const url = String(args.url ?? '').trim();
    if (!/^(?:https?:\/\/\S+|app:[\w.-]*(?:\/\S*)?)$/i.test(url)) throw new Error('Navigate to an http(s) URL, app:/path, or app:<linked repository>/path.');
    return { op, args: { url } };
  }
  if (['click', 'hover', 'type', 'select'].includes(op) && !refPattern.test(String(args.ref ?? ''))) throw new Error('Give an element ref like e12 from the last snapshot.');
  if (op === 'resize' && (!Number.isInteger(args.width) || args.width < 320 || args.width > 2560 || !Number.isInteger(args.height) || args.height < 240 || args.height > 1600)) throw new Error('Viewport width must be 320–2560 and height 240–1600 CSS pixels.');
  if (op === 'type' && (typeof args.text !== 'string' || args.text.length > 4000)) throw new Error('Text must be a string under 4,000 characters.');
  if (op === 'select' && (!Array.isArray(args.values) || args.values.length > 10)) throw new Error('Select needs up to 10 values.');
  if (op === 'press' && !/^[A-Za-z0-9+]{1,32}$/.test(String(args.key ?? ''))) throw new Error('Key names are letters, digits and + only.');
  if (op === 'wait' && args.ms !== undefined && !(Number.isInteger(args.ms) && args.ms > 0 && args.ms <= 30_000)) throw new Error('Wait up to 30,000 ms.');
  if (['scroll', 'wait'].includes(op) && args.ref !== undefined && !refPattern.test(String(args.ref))) throw new Error('Element ref must look like e12 or f1e12.');
  return { op, args };
}

const resultText = (op, reply) => {
  const head = `${reply.url ?? ''}${reply.title ? ` — ${reply.title}` : ''}`;
  const errors = reply.consoleErrors?.length ? `\nConsole errors: ${reply.consoleErrors.map(entry => entry.text).join(' | ').slice(0, 2000)}` : '';
  if (op === 'console') return JSON.stringify(reply.entries ?? []);
  if (op === 'snapshot') return `${head}\n${reply.snapshot ?? ''}`;
  return `${head}${errors}\n${reply.snapshot ?? ''}`.trim();
};

// Runs one browser tool call through the session and records it as a replayable step with its screenshot.
export async function browserCall({ run, name, args, session, resolveUrl, evidence, steps, log }) {
  const { op, args: clean } = validateBrowserArgs(name, args);
  if (op === 'navigate' && /^app:/i.test(clean.url)) clean.url = await resolveUrl(clean.url);
  const started = Date.now();
  let reply, error = null;
  try { reply = await session.call(op, clean); } catch (failure) { error = String(failure.message ?? failure).slice(0, 2000); reply = failure.observed ?? {}; }
  const screenshot = reply.screenshot ? evidence.keepStep(run, { data: reply.screenshot, mimeType: 'image/jpeg' }) : null;
  const step = steps.append(run, { kind: 'browser.step', tool: name, args: clean, url: reply.url ?? null, title: reply.title ?? null, target: reply.target ?? null, screenshotAfter: screenshot?.id ?? null, screenshotSkipped: reply.screenshot && !screenshot ? 'budget' : null, elements: boundElements(reply.elements), consoleErrors: (reply.consoleErrors ?? []).slice(-20), durationMs: Date.now() - started, error, bytes: screenshot?.size ?? 0 });
  if (screenshot) screenshot.stepId = step.id;
  if (reply.screenshot && !screenshot) log?.('browser', 'Browser step screenshots reached their budget; later steps keep no pixels.');
  if (error) throw new Error(error);
  if (op === 'screenshot' && reply.image) {
    const image = evidence.keepStep(run, { data: reply.image, mimeType: 'image/jpeg', stepId: step.id });
    return { content: [{ type: 'image', data: reply.image, mimeType: 'image/jpeg' }, { type: 'text', text: image ? `Screenshot ID: ${image.id}. Use it in dispatch_browser_review with a caption.` : 'Screenshot was not retained (image or storage limit); no review ID is available.' }], artifactIds: image ? [image.id] : [] };
  }
  return { content: [{ type: 'text', text: resultText(op, reply).slice(0, stepLimits.snapshot) }] };
}
