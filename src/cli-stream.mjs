import { StringDecoder } from 'node:string_decoder';

const maxBuffer = 2_000_000;

// Runs a CLI that prints one JSON event per line. Malformed or oversized output
// is reported, never guessed at; the caller decides the turn outcome.
export async function runJsonLines(execute, command, args, { onEvent, ...options }) {
  let buffer = '', malformed = false;
  const decoder = new StringDecoder('utf8');
  const consume = line => {
    if (!line.trim()) return;
    let event; try { event = JSON.parse(line); } catch { malformed = true; return; }
    onEvent(event);
  };
  const result = await execute(command, args, { ...options, onStdout: chunk => {
    buffer += decoder.write(chunk);
    if (buffer.length > maxBuffer) { malformed = true; buffer = ''; return; }
    let index; while ((index = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
  } });
  buffer += decoder.end(); if (buffer.trim()) consume(buffer);
  return { ...result, malformed };
}

export function blockedOutcome(summary) {
  return /^DISPATCH_BLOCKED:/m.test(summary) ? 'blocked' : 'completed';
}

export const browserTool = name => /browser|playwright|puppeteer|chrom(e|ium)/i.test(String(name));

const coordinate = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 20000 ? Math.round(value) : null;
export function browserPointer(name, input) {
  if (!input || typeof input !== 'object') return null;
  const [x, y] = Array.isArray(input.coordinate) ? input.coordinate.map(coordinate) : [coordinate(input.x), coordinate(input.y)];
  if (x == null || y == null) return null;
  const action = typeof input.action === 'string' ? input.action : String(name).match(/(click|move|drag|hover)/i)?.[1]?.toLowerCase() ?? 'pointer';
  return { x, y, action: action.slice(0, 40) };
}
