import { longRunningScript, npmScript } from './recipe-roles.mjs';

export const commandLine = step => [step.command, ...step.args].join(' ');
export const recipeText = steps => steps.map(commandLine).join('\n');

export function parseRecipeText(text, existing = []) {
  const known = new Map(existing.map(step => [commandLine(step), step]));
  return text.split('\n').map(line => line.trim()).filter(Boolean).map((line, index) => {
    if (known.has(line)) return known.get(line);
    if (line === 'dispatch browser-smoke') return { id: 'browser-smoke', kind: 'browser-smoke' };
    const [command, ...args] = line.split(/\s+/);
    return { id: npmScript({ command, args }) ?? `check-${index + 1}`, command, args };
  });
}

export const longRunningSteps = steps => steps.filter(step => longRunningScript(npmScript(step)));

export const confirmLongRunning = steps => steps.map(step => longRunningScript(npmScript(step)) ? { ...step, confirmedLongRunning: true } : step);
