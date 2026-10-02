import { InputError } from './engine.mjs';
import { linkedSettings, maxLinked } from './linked-repositories.mjs';
import { maxTaskRepositories } from './repository.mjs';
import { repositoryInput, setupSummary } from './repository-setup.mjs';
import { providerName } from './providers.mjs';

const approve = 'Add it', decline = 'Not now';
const commandLines = steps => steps.map(step => step.kind === 'browser-smoke' ? 'dispatch browser-smoke' : [step.command, ...step.args].join(' '));

function lines(value, label, max) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > max || value.some(line => typeof line !== 'string' || line.length > 500)) throw new InputError(`${label} must be a list of at most ${max} lines.`);
  return value.map(line => line.trim()).filter(Boolean);
}

function text(value, label) {
  if (value !== undefined && (typeof value !== 'string' || value.length > 200)) throw new InputError(`${label} must be text under 200 characters.`);
  return value?.trim() || undefined;
}

function flag(value, label) {
  if (value !== undefined && typeof value !== 'boolean') throw new InputError(`${label} must be true or false.`);
  return value;
}

export function repositoryOptions(input) {
  if (typeof input?.repositoryPath !== 'string' || !input.repositoryPath.trim()) throw new InputError('Give the repository folder.');
  return {
    repositoryPath: input.repositoryPath.trim(), name: text(input.name, 'Name'), baseBranch: text(input.baseBranch, 'Base branch'),
    checks: lines(input.checks, 'Checks', 12), setup: lines(input.setup, 'Setup', 8), textOnlyPaths: lines(input.textOnlyPaths, 'Text-only paths', 20), instructions: lines(input.instructions, 'Instructions', 20),
    browser: flag(input.browser, 'Browser'), review: flag(input.review, 'Review'),
  };
}

const taskRepositories = run => [...new Set([run.projectId, ...(run.linked ?? []).map(member => member.projectId), ...(run.linkRequests ?? [])])];

// Saves a folder as a dispatch repository for the CLI, and lets a run's agent add one to its task once the operator approves.
export class RepositoryTool {
  constructor(live) { this.live = live; }

  saved(path) { return this.live.projects.find(project => project.repositoryPath === path); }

  owner(id) {
    const project = this.live.projects.find(item => item.id === id);
    if (!project) throw new InputError('Project not found', 404);
    return project;
  }

  async add(input) {
    const options = repositoryOptions(input), owner = input.linkTo ? this.owner(input.linkTo) : null;
    if (owner && (owner.linked ?? []).length >= maxLinked) throw new InputError(`${owner.name} already links ${maxLinked} repositories, the most it can.`);
    const info = await this.live.inspect(options.repositoryPath), existing = this.saved(info.repositoryPath);
    const project = existing ?? await this.live.saveProject(repositoryInput(info, options));
    if (owner) this.link(owner, project);
    return { project, created: !existing, linkedTo: owner?.name ?? null };
  }

  link(owner, project) {
    if ((owner.linked ?? []).includes(project.id)) return;
    owner.linked = linkedSettings([...(owner.linked ?? []), project.id], this.live.projects, owner.id);
    this.live.engine.store.save();
  }

  async call(run, args, { signal }) {
    if (typeof args.path !== 'string' || !args.path.trim()) throw new InputError('Give the folder path.');
    const info = await this.live.inspect(args.path), existing = this.saved(info.repositoryPath);
    const inTask = Boolean(existing) && taskRepositories(run).includes(existing.id);
    if (args.action === 'inspect') return this.inspection(info, existing, inTask);
    if (args.action !== 'add') throw new InputError('Repository action must be inspect or add.');
    if (inTask) return { added: false, note: `${existing.name} is already part of this task.` };
    if (taskRepositories(run).length >= maxTaskRepositories) throw new InputError(`A task can use at most ${maxTaskRepositories} repositories.`);
    const options = repositoryOptions({ ...args, repositoryPath: info.repositoryPath });
    const answer = await this.approval(run, { info, existing, input: existing ? null : repositoryInput(info, options), always: args.alwaysLink === true }, signal);
    if (answer !== approve) return { added: false, operator: answer };
    const result = await this.add({ ...options, linkTo: args.alwaysLink === true ? run.projectId : undefined });
    run.linkRequests = [...(run.linkRequests ?? []), result.project.id]; this.live.engine.store.save();
    return { added: true, repository: result.project.name, savedNow: result.created, linkedTo: result.linkedTo,
      next: `${result.project.name} joins this task from its next turn, with its own isolated workspace and checks. Do not edit ${info.repositoryPath} directly. Finish this turn now, saying what is left to do in ${result.project.name}; dispatch then continues the ticket there in this session.` };
  }

  inspection(info, existing, inTask) {
    const defaults = existing ? null : repositoryInput(info);
    return {
      repositoryPath: info.repositoryPath, git: info.git !== false, branches: (info.branches ?? []).slice(0, 20), scripts: Object.keys(info.scripts ?? {}),
      saved: existing?.name ?? null, partOfThisTask: inTask,
      defaults: defaults && { name: defaults.name, baseBranch: defaults.baseBranch, checks: commandLines(defaults.validation), setup: commandLines(defaults.setup), textOnlyPaths: defaults.checkScopes[0]?.paths ?? [], browser: defaults.browser.enabled },
    };
  }

  async approval(run, { info, existing, input, always }, signal) {
    const name = existing?.name ?? input.name;
    const settings = existing ? `${name} is already saved in dispatch; its settings stay as they are.` : `dispatch saves it as: ${setupSummary(input).join('; ')}.`;
    const question = `${providerName(run.provider)} wants to add ${info.repositoryPath} to this task${always ? ` and link it to ${run.project.name} for future tasks` : ''}. ${settings} When this turn ends, dispatch continues the task in it with its own isolated workspace and checks.`;
    const { answers } = await this.live.interactions.request(run, { kind: 'question', source: 'tool', questions: [{ id: 'repository', header: 'Add a repository', question,
      options: [{ label: approve, description: `Save ${name} and continue the task in it.` }, { label: decline, description: 'Keep working without it.' }] }] }, signal);
    return answers?.repository?.answers?.[0] ?? null;
  }
}
