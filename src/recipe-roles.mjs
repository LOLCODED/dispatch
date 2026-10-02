export const longRunningScript = name => typeof name === 'string' && /^(?:start|dev|serve|watch|preview)$|^dev:/.test(name);
export function npmScript(step) {
  if (step?.command !== 'npm' || !Array.isArray(step.args)) return null;
  return (['run', 'run-script'].includes(step.args[0]) ? step.args[1] : step.args[0]) ?? null;
}
