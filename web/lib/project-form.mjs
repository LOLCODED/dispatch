import { longRunningScript, npmScript } from './recipe-roles.mjs';
import { commandLine, confirmLongRunning, parseRecipeText } from './recipe-text.mjs';
import { riskSettings } from './risk-policy.mjs';
import { projectScopes } from './check-scope.mjs';

export const smokeStep = step => step.kind === 'browser-smoke';
export const installStep = () => ({ id: 'install', command: 'npm', args: ['ci'] });
export const isInstall = step => step.command === 'npm' && step.args.join(' ') === 'ci';
export const scriptCheck = script => ({ id: script, command: 'npm', args: ['run', script] });
export const suggestedTextOnlyPaths = ['*.md', 'docs/**'];

const lines = values => values.map(value => value.trim()).filter(Boolean);

export function formFromProject(project) {
  return {
    path: project.repositoryPath, name: project.name, base: project.baseBranch ?? '', git: project.git !== false,
    validation: project.validation.filter(step => !smokeStep(step)), smoke: project.validation.find(smokeStep) ?? null, setup: project.setup,
    risk: riskSettings(project.risk, project.validation), scopes: projectScopes(project), instructions: project.instructions ?? [], protectedPaths: project.protectedPaths ?? [], linked: project.linked ?? [], linkedEnv: project.linkedEnv ?? {},
    review: project.review === true, browser: project.browser?.enabled === true, headed: project.browser?.headed === true, memory: project.memory !== false, trackRemote: project.trackRemote !== false, dispatchCoAuthor: project.dispatchCoAuthor !== false,
    connectors: structuredClone(project.connectors ?? {}),
  };
}

export function blankForm(path = '') {
  return { risk: { mode: 'agent', minimumChecks: { low: [], medium: [], high: [] }, guidance: '' }, path, name: '', base: '', git: true, validation: [], smoke: null, setup: [], scopes: [], instructions: [], protectedPaths: [], linked: [], linkedEnv: {}, review: false, browser: false, headed: false, memory: true, trackRemote: true, dispatchCoAuthor: true, connectors: {} };
}

export function formFromInspect(info) {
  const validation = info.suggestedChecks.map(scriptCheck);
  return { ...blankForm(info.repositoryPath), name: info.name, base: info.baseBranch ?? '', git: info.git !== false, validation, setup: info.suggestInstall ? [installStep()] : [], browser: info.suggestBrowser === true,
    scopes: [{ id: 'text-only', paths: suggestedTextOnlyPaths, checks: validation.some(step => step.id === 'check') ? ['check'] : [] }] };
}

export const checkIds = form => [...form.validation.map(step => step.id), ...(form.smoke ? [form.smoke.id] : [])];

export function uniqueId(base, taken) {
  const ids = new Set(taken), stem = base.replace(/[^\w:.-]+/g, '-').slice(0, 60) || 'check';
  if (!ids.has(stem)) return stem;
  let index = 2; while (ids.has(`${stem}-${index}`)) index++;
  return `${stem}-${index}`;
}

export function commandStep(line, taken) {
  const [step] = confirmLongRunning(parseRecipeText(line));
  if (!step || smokeStep(step)) return null;
  return { ...step, id: uniqueId(npmScript(step) ?? step.command.split('/').at(-1), taken) };
}

export function editCommand(step, line) {
  const [parsed] = parseRecipeText(line);
  return parsed && !smokeStep(parsed) ? { ...step, command: parsed.command, args: parsed.args } : step;
}

export function unusedScripts(info, form) {
  const used = new Set(form.validation.map(npmScript).filter(Boolean));
  return Object.keys(info?.scripts ?? {}).filter(script => !used.has(script) && !longRunningScript(script));
}

export function newCommands(form, saved) {
  const known = new Set(saved ? [...saved.validation, ...saved.setup].map(commandLine) : []);
  return [...form.validation, ...form.setup].map(commandLine).filter(line => !known.has(line));
}

export const formChanged = (form, saved) => !saved || JSON.stringify(form) !== JSON.stringify(saved);

export function projectPayload(form, repositoryPath) {
  const scopes = form.scopes.map(scope => ({ ...scope, paths: lines(scope.paths) })).filter(scope => scope.paths.length), git = form.git !== false;
  return { repositoryPath, name: form.name, baseBranch: git ? form.base : null, confirmed: true,
    validation: [...form.validation, ...(form.smoke ? [form.smoke] : [])], setup: form.setup, checkScopes: scopes, risk: form.risk,
    instructions: lines(form.instructions), protectedPaths: lines(form.protectedPaths), linked: form.linked, linkedEnv: Object.fromEntries(Object.entries(form.linkedEnv).map(([id, name]) => [id, name.trim()]).filter(([id, name]) => name && form.linked.includes(id))), trackRemote: git && form.trackRemote,
    connectors: form.connectors,
    browser: { enabled: form.browser, headed: form.browser && form.headed }, review: form.review, memory: form.memory, dispatchCoAuthor: git && form.dispatchCoAuthor };
}
