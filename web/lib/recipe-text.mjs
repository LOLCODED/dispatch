import { longRunningScript, npmScript, stepFromLine } from './recipe-roles.mjs';

export const commandLine = step => [step.command, ...step.args].join(' ');
export const recipeText = steps => steps.map(commandLine).join('\n');

export function parseRecipeText(text, existing = []) {
  const known = new Map(existing.map(step => [commandLine(step), step]));
  return text.split('\n').map(line => line.trim()).filter(Boolean).map((line, index) => known.get(line) ?? stepFromLine(line, index));
}

export const longRunningSteps = steps => steps.filter(step => longRunningScript(npmScript(step)));

export const confirmLongRunning = steps => steps.map(step => longRunningScript(npmScript(step)) ? { ...step, confirmedLongRunning: true } : step);
