import { stepFromLine } from './recipe-roles.mjs';

export const installStep = () => ({ id: 'install', command: 'npm', args: ['ci'] });
export const scriptCheck = script => ({ id: script, command: 'npm', args: ['run', script] });
export const suggestedTextOnlyPaths = ['*.md', 'docs/**'];

const textOnlyScopes = (paths, validation) => paths.length ? [{ id: 'text-only', paths, checks: validation.some(step => step.id === 'check') ? ['check'] : [] }] : [];

export function suggestedRecipe(info) {
  const validation = info.suggestedChecks.map(scriptCheck);
  return { validation, setup: [...(info.suggestInstall ? [installStep()] : []), ...(info.suggestedSetup ?? [])], browser: info.suggestBrowser === true, checkScopes: textOnlyScopes(suggestedTextOnlyPaths, validation) };
}

const commandSteps = lines => {
  const steps = lines.map(stepFromLine), seen = new Map();
  return steps.map(step => { const count = (seen.get(step.id) ?? 0) + 1; seen.set(step.id, count); return count > 1 ? { ...step, id: `${step.id}-${count}` } : step; });
};

// The repository a CLI or agent saves gets the settings the setup form would suggest, overridden by each option given.
export function repositoryInput(info, options = {}) {
  const suggested = suggestedRecipe(info), git = info.git !== false;
  const validation = options.checks ? commandSteps(options.checks) : suggested.validation;
  return {
    repositoryPath: info.repositoryPath, name: options.name || info.name, baseBranch: git ? options.baseBranch ?? info.baseBranch : null, confirmed: true,
    validation, setup: options.setup ? commandSteps(options.setup) : suggested.setup, checkScopes: textOnlyScopes(options.textOnlyPaths ?? suggestedTextOnlyPaths, validation),
    risk: { mode: 'agent', minimumChecks: { low: [], medium: [], high: [] }, guidance: '' }, browser: { enabled: options.browser ?? suggested.browser, headed: false },
    review: options.review ?? false, memory: true, instructions: options.instructions ?? [], trackRemote: git, dispatchCoAuthor: git,
  };
}

const commands = steps => steps.map(step => step.kind === 'browser-smoke' ? 'browser smoke check' : [step.command, ...step.args].join(' ')).join(', ') || 'none';

export function setupSummary(input) {
  return [
    `${input.name} at ${input.repositoryPath}${input.baseBranch ? `, base branch ${input.baseBranch}` : ', a plain folder without Git'}`,
    `Checks: ${commands(input.validation)}`, `Setup: ${commands(input.setup)}`,
    ...(input.checkScopes.length ? [`Text-only paths (${input.checkScopes[0].paths.join(', ')}) run: ${input.checkScopes[0].checks.join(', ') || 'no checks'}`] : []),
    `Browser preview: ${input.browser.enabled ? 'on' : 'off'}; independent review: ${input.review ? 'on' : 'off'}`,
    ...(input.instructions.length ? [`Instructions: ${input.instructions.join(' | ')}`] : []),
  ];
}
