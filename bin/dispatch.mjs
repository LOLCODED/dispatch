#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { text } from 'node:stream/consumers';
import { setTimeout as delay } from 'node:timers/promises';
import { taskProject, taskProjects } from '../src/repository.mjs';
import { InstallError, install, startService, stopService, update } from './install.mjs';

const usage = `Usage:
  dispatch
      Print dispatch's address, starting the installed service first if it is not running.
  dispatch kill [--force]
      Stop the installed service. Refuses while runs are working unless --force; queued runs stay queued.
  dispatch add [--repo <name|path>[,<name|path>...] | --repo all] [--answer] [instructions...]
      Save a task to dispatch's Todo list. Reads instructions from stdin when none are given.
      The repository is --repo, else the one containing the current folder, else the one the text names.
      Several repositories (first one primary) give the task a worktree in each; "all" lets the agent decide.
  dispatch tasks [--repo <name|path>]
      List saved tasks and their state.
  dispatch repo add <folder> [--name <name>] [--base <branch>] [--check <command>]... [--setup <command>]...
                    [--text-only <glob>]... [--instruction <text>]... [--browser | --no-browser] [--review]
                    [--link <name|path>]
      Save a folder as a repository with the settings the setup page suggests; each option overrides one.
      Checks and setup run as trusted commands. --link also gives every task in that saved repository a
      worktree in this one. An already saved folder keeps its settings and is only linked.
  dispatch repo list
      List saved repositories and what each links.
  dispatch connector add <folder> | remove <id> | list
      Load a tracker connector from a local folder (its package.json "dispatch.connector",
      else index.mjs), remove one, or list them. The connector runs inside dispatch with your
      permissions; repositories still read its tickets only after you enable it for them.
  dispatch install [--ref <tag>] [--port 4317] [--dir ~/.local/share/dispatch]
      From a dispatch checkout: clone it at the latest vX.Y.Z tag, build it, run it as a user service
      (systemd or launchd) with its own data directory, and link this command into ~/.local/bin.
  dispatch update [--ref <tag>] [--force]
      Fetch the newest tag from the checkout it was installed from, rebuild and restart.
      While runs are working it holds the queue, waits for them to finish, then updates;
      queued runs continue after the restart. --force updates now and interrupts working runs.

Talks to a running dispatch at DISPATCH_URL (default http://127.0.0.1:\${PORT:-4317}).`;

const base = (process.env.DISPATCH_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4317}`).replace(/\/$/, '');

class CliError extends Error {}

async function api(path, init) {
  let response;
  try { response = await fetch(`${base}${path}`, init); }
  catch { throw new CliError(`dispatch is not running at ${base}. Start it with \`dispatch\`, or set DISPATCH_URL.`); }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new CliError(value.error ?? `dispatch answered ${response.status}.`);
  return value;
}

const candidateList = (error, candidates) => { const list = candidates.map(candidate => `  ${candidate.name}  ${candidate.repositoryPath}`).join('\n'); return new CliError(list ? `${error}\n${list}` : error); };

function chooseProject(projects, selection) {
  const { project, error, candidates } = taskProject(selection, projects);
  if (project) return project;
  throw candidateList(error, candidates);
}

function chooseProjects(projects, selection) {
  const choice = taskProjects(selection, projects);
  if (choice.error) throw candidateList(choice.error, choice.candidates);
  return choice;
}

const repositoryBody = choice => choice.all ? { projectIds: 'all' } : choice.projects.length > 1 ? { projectId: choice.projects[0].id, projectIds: choice.projects.map(project => project.id) } : { projectId: choice.projects[0].id };
const repositoryLabel = choice => choice.all ? 'Saved (agent decides)' : `Saved to ${choice.projects.map(project => project.name).join(', ')}`;

async function add({ values, positionals }) {
  const input = (positionals.length ? positionals.join(' ') : process.stdin.isTTY ? '' : await text(process.stdin)).trim();
  if (!input) throw new CliError('Give the task instructions as arguments or on stdin.');
  const choice = chooseProjects(await api('/api/projects'), { repo: values.repo, cwd: resolve('.'), input });
  const task = await api('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...repositoryBody(choice), input, kind: values.answer ? 'answer' : 'change' }) });
  console.log(`${repositoryLabel(choice)}: ${task.title}\n${base}/  (task ${task.id})`);
}

async function tasks({ values }) {
  const projects = await api('/api/projects');
  const project = values.repo?.length ? chooseProject(projects, { repo: values.repo[0] }) : null;
  const names = new Map(projects.map(candidate => [candidate.id, candidate.name]));
  const rows = (await api('/api/tasks')).filter(task => !project || task.projectId === project.id);
  if (!rows.length) { console.log('No saved tasks.'); return; }
  for (const task of rows) console.log(`${task.status.padEnd(12)} ${(names.get(task.projectId) ?? '?').padEnd(16)} ${task.title}`);
}

async function workingRuns() {
  try { return (await api('/api/workspace')).runs; } catch (error) { if (error instanceof CliError) return []; throw error; }
}

const post = value => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });

function connectorLine(plugin) {
  const state = plugin.error ? `failed: ${plugin.error}` : plugin.loaded ? 'loaded' : 'not loaded';
  return `${(plugin.id ?? '?').padEnd(12)} ${(plugin.name ?? '').padEnd(20)} ${plugin.path}  (${state})`;
}

const connectorCommands = {
  async add([folder]) {
    if (!folder) throw new CliError('Give the connector folder: dispatch connector add <folder>.');
    const plugin = await api('/api/connectors/plugins', post({ path: resolve(folder) }));
    console.log(`Added ${plugin.name} (${plugin.id}) from ${plugin.path}.\nEnable it for a repository in its settings, or paste one of its links.`);
  },
  async remove([id]) {
    if (!id) throw new CliError('Give the connector id: dispatch connector remove <id>.');
    const removed = await api(`/api/connectors/plugins/${encodeURIComponent(id)}/remove`, post({}));
    console.log(`Removed ${removed.id} (${removed.path}).`);
  },
  async list() {
    const plugins = await api('/api/connectors/plugins');
    console.log(plugins.length ? plugins.map(connectorLine).join('\n') : 'No connectors added.');
  },
};

async function connector({ positionals: [action = 'list', ...rest] }) {
  if (!connectorCommands[action]) throw new CliError('Use dispatch connector add <folder>, remove <id> or list.');
  await connectorCommands[action](rest);
}

function repositoryRequest(folder, values, projects) {
  return {
    repositoryPath: resolve(folder), confirmed: true, name: values.name, baseBranch: values.base, checks: values.check, setup: values.setup,
    textOnlyPaths: values['text-only'], instructions: values.instruction, browser: values.browser, review: values.review,
    linkTo: values.link ? chooseProject(projects, { repo: values.link }).id : undefined,
  };
}

const repoCommands = {
  async add([folder], values) {
    if (!folder) throw new CliError('Give the repository folder: dispatch repo add <folder>.');
    const { project, created, linkedTo } = await api('/api/projects/add', post(repositoryRequest(folder, values, await api('/api/projects'))));
    const checks = project.validation.map(step => step.id).join(', ') || 'none';
    console.log(`${created ? `Saved ${project.name} (${project.repositoryPath}) with checks: ${checks}.` : `${project.name} is already saved; its settings were left as they are.`}${linkedTo ? `\nLinked to ${linkedTo}.` : ''}`);
  },
  async list() {
    const projects = await api('/api/projects'), names = new Map(projects.map(project => [project.id, project.name]));
    if (!projects.length) { console.log('No saved repositories.'); return; }
    for (const project of projects) console.log(`${project.name.padEnd(20)} ${project.repositoryPath}${project.linked?.length ? `  (links ${project.linked.map(id => names.get(id) ?? '?').join(', ')})` : ''}`);
  },
};

async function repo({ positionals: [action = 'list', ...rest], values }) {
  if (!repoCommands[action]) throw new CliError('Use dispatch repo add <folder> or list.');
  await repoCommands[action](rest, values);
}

const queue = {
  hold: seconds => api('/api/queue/hold', post({ seconds })).catch(error => { if (error instanceof CliError) return null; throw error; }),
  release: () => api('/api/queue/release', post({})).catch(() => {}),
};

async function updateInstall({ values }) {
  const cancel = () => queue.release().finally(() => process.exit(130));
  process.once('SIGINT', cancel);
  try { await update({ ...values, runs: workingRuns, queue }); } finally { process.off('SIGINT', cancel); }
}

async function answering() {
  try { await fetch(`${base}/api/projects`, { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; }
}

async function open() {
  if (!await answering()) {
    startService();
    const deadline = Date.now() + 20_000;
    while (!await answering()) {
      if (Date.now() > deadline) throw new CliError(`Started the dispatch service, but ${base} is not answering. Check the service log.`);
      await delay(250);
    }
  }
  console.log(`${base}/`);
}

const commands = {
  open, add, tasks, connector, repo,
  kill: async ({ values }) => { await stopService({ force: values.force, runs: workingRuns }); console.log('dispatch stopped.'); },
  install: ({ values }) => install(values),
  update: updateInstall,
};
try {
  const parsed = parseArgs({ allowPositionals: true, allowNegative: true, options: {
    repo: { type: 'string', multiple: true }, answer: { type: 'boolean' }, ref: { type: 'string' }, port: { type: 'string' }, dir: { type: 'string' }, force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    name: { type: 'string' }, base: { type: 'string' }, check: { type: 'string', multiple: true }, setup: { type: 'string', multiple: true }, 'text-only': { type: 'string', multiple: true },
    instruction: { type: 'string', multiple: true }, browser: { type: 'boolean' }, review: { type: 'boolean' }, link: { type: 'string' },
  } });
  const [command = 'open', ...positionals] = parsed.positionals;
  if (parsed.values.help || !commands[command]) { console.log(usage); process.exitCode = parsed.values.help ? 0 : 1; }
  else await commands[command]({ values: parsed.values, positionals });
} catch (error) {
  if (!(error instanceof CliError) && !(error instanceof InstallError) && error.code !== 'ERR_PARSE_ARGS_UNKNOWN_OPTION') throw error;
  console.error(error.message); process.exitCode = 1;
}
