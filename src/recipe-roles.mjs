export const longRunningScript = name => typeof name === 'string' && /^(?:start|dev|serve|watch|preview)$|^dev:/.test(name);
export function npmScript(step) {
  if (step?.command !== 'npm' || !Array.isArray(step.args)) return null;
  return (['run', 'run-script'].includes(step.args[0]) ? step.args[1] : step.args[0]) ?? null;
}
export function stepFromLine(line, index) {
  if (line === 'dispatch browser-smoke') return { id: 'browser-smoke', kind: 'browser-smoke' };
  const [command, ...args] = line.split(/\s+/);
  return { id: npmScript({ command, args }) ?? `check-${index + 1}`, command, args };
}
