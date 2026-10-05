import { longRunningScript, npmScript } from './recipe-roles.mjs';
import { commandLine, confirmLongRunning, parseRecipeText } from './recipe-text.mjs';
import { landingChecks, riskSettings } from './risk-policy.mjs';
import { projectScopes } from './check-scope.mjs';
import { suggestedRecipe } from '../../src/repository-setup.mjs';

export { installStep, scriptCheck, suggestedTextOnlyPaths } from '../../src/repository-setup.mjs';
export const smokeStep = step => step.kind === 'browser-smoke';
export const isInstall = step => step.command === 'npm' && step.args.join(' ') === 'ci';

const lines = values => values.map(value => value.trim()).filter(Boolean);

export function formFromProject(project) {
  return {
    path: project.repositoryPath, name: project.name, base: project.baseBranch ?? '', targets: project.targetBranches ?? [], git: project.git !== false,
    validation: project.validation.filter(step => !smokeStep(step)), smoke: project.validation.find(smokeStep) ?? null, setup: project.setup,
    risk: riskSettings(project.risk, project.validation), scopes: projectScopes(project), instructions: project.instructions ?? [], protectedPaths: project.protectedPaths ?? [], linked: project.linked ?? [], linkedEnv: project.linkedEnv ?? {},
    review: project.review === true, browser: project.browser?.enabled === true, headed: project.browser?.headed === true, memory: project.memory !== false, trackRemote: project.trackRemote !== false, dispatchCoAuthor: project.dispatchCoAuthor !== false,
    allowSensitiveFiles: project.allowSensitiveFiles === true, localFiles: project.localFiles ?? [], connectors: structuredClone(project.connectors ?? {}),
  };
}

export function blankForm(path = '') {
  return { risk: { mode: 'agent', minimumChecks: { low: [], medium: [], high: [] }, guidance: '' }, path, name: '', base: '', targets: [], git: true, validation: [], smoke: null, setup: [], localFiles: [], scopes: [], instructions: [], protectedPaths: [], linked: [], linkedEnv: {}, review: false, browser: false, headed: false, memory: true, trackRemote: true, dispatchCoAuthor: true, allowSensitiveFiles: false, connectors: {} };
}

export function formFromInspect(info) {
  const { validation, setup, browser, checkScopes } = suggestedRecipe(info);
  return { ...blankForm(info.repositoryPath), name: info.name, base: info.baseBranch ?? '', git: info.git !== false, validation, setup, browser, scopes: checkScopes, localFiles: info.git === false ? [] : info.suggestedLocalFiles ?? [] };
}

export const branchChoices = (info, form) => info.branches.filter(branch => branch === form.base || form.targets.includes(branch) || !info.taskBranches?.includes(branch));
export const existingTargets = (form, branches) => form.targets.filter(branch => branches.includes(branch) && branch !== form.base);

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

const neverChecks = new Set(['server', 'deploy', 'format-write']);
const kindText = {
  test: 'Runs tests', e2e: 'Runs end-to-end tests in a browser', 'service-test': 'Tests that need a database or another service',
  lint: 'Lints the code', typecheck: 'Type-checks', format: 'Checks formatting', check: 'Runs several checks', build: 'Builds the app',
  server: 'Starts a server and never finishes', deploy: 'Deploys, migrates or changes data', 'format-write': 'Rewrites files', other: '',
};
const detailOf = (info, script) => info?.scriptDetails?.[script] ?? { command: info?.scripts?.[script] ?? '', kind: longRunningScript(script) ? 'server' : 'other', ci: false };
export function scriptDescription(info, script) {
  const detail = detailOf(info, script);
  return [kindText[detail.kind], detail.ci && 'CI runs this', detail.command].filter(Boolean).join(' · ');
}
// CI-run scripts first, then other checks; scripts that never finish or change things are listed apart and never offered.
export function unusedScripts(info, form) {
  const used = new Set(form.validation.map(npmScript).filter(Boolean));
  const rank = script => { const detail = detailOf(info, script); return detail.ci ? 0 : detail.kind === 'other' || detail.kind === 'build' ? 2 : 1; };
  return Object.keys(info?.scripts ?? {}).filter(script => !used.has(script) && !neverChecks.has(detailOf(info, script).kind)).sort((a, b) => rank(a) - rank(b));
}
export const unsuitableScripts = info => Object.keys(info?.scripts ?? {}).filter(script => neverChecks.has(detailOf(info, script).kind));

export function newCommands(form, saved) {
  const known = new Set(saved ? [...saved.validation, ...saved.setup].map(commandLine) : []);
  return [...form.validation, ...form.setup].map(commandLine).filter(line => !known.has(line));
}

export const formChanged = (form, saved) => !saved || JSON.stringify(form) !== JSON.stringify(saved);

const landingRisk = form => form.risk.landingChecks ? { ...form.risk, landingChecks: landingChecks(form.risk, checkIds(form)) } : form.risk;

export function projectPayload(form, repositoryPath) {
  const scopes = form.scopes.map(scope => ({ ...scope, paths: lines(scope.paths) })).filter(scope => scope.paths.length), git = form.git !== false;
  return { repositoryPath, name: form.name, baseBranch: git ? form.base : null, targetBranches: git ? form.targets : [], confirmed: true,
    validation: [...form.validation, ...(form.smoke ? [form.smoke] : [])], setup: form.setup, checkScopes: scopes, risk: landingRisk(form),
    instructions: lines(form.instructions), protectedPaths: lines(form.protectedPaths), linked: form.linked, linkedEnv: Object.fromEntries(Object.entries(form.linkedEnv).map(([id, name]) => [id, name.trim()]).filter(([id, name]) => name && form.linked.includes(id))), trackRemote: git && form.trackRemote,
    connectors: form.connectors,
    browser: { enabled: form.browser, headed: form.browser && form.headed }, review: form.review, memory: form.memory, dispatchCoAuthor: git && form.dispatchCoAuthor, allowSensitiveFiles: form.allowSensitiveFiles, ...(git ? { localFiles: form.localFiles ?? [] } : {}) };
}

export const localFileChoices = (info, form) => [...new Set([...(info?.localFiles ?? []), ...(form.localFiles ?? [])])];
