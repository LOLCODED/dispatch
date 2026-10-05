import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { freePort } from './browser-smoke.mjs';
import { localEnvironment } from './local-tools.mjs';
import { runProcess } from './process.mjs';
import { projectDatabases } from './database.mjs';

const commandTimeoutMs = 900_000, shownOutput = 6000;
const envName = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export const databaseTool = {
  name: 'dispatch_database', kind: 'database',
  description: 'Manage this task’s own database, outside the sandbox. migrate runs the repository’s migrate command against it; reset recreates it from the development database. The dev server, services, checks and dispatch_sql already use it; the shared development database is never changed.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { type: 'string', enum: ['migrate', 'reset'] } } },
};

export const taskDatabaseEntry = project => projectDatabases(project).find(entry => entry.perTask) ?? null;
export const perTask = project => taskDatabaseEntry(project)?.perTask ?? null;
const fill = (text, values) => text.replaceAll('{task}', values.task).replaceAll('{port}', String(values.port ?? ''));
const tail = text => text.length > shownOutput ? `… ${text.length - shownOutput} earlier characters\n${text.slice(-shownOutput)}` : text;
const redact = (text, env) => Object.values(env).filter(value => value.length >= 8).reduce((output, secret) => output.split(secret).join('<database>'), String(text ?? ''));

// Gives each task its own database from a provider (a connector or the operator's commands); core knows no engine.
// The provisioned variables stay in a private file, never in run state, so evidence exports cannot carry them.
export class TaskDatabases {
  constructor(live, { execute = runProcess, root } = {}) { this.live = live; this.execute = execute; this.root = root ?? join(resolve(live.engine.dataDir), 'task-databases'); }

  task(run) { const id = basename(run.workspace).replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 24); return { id, name: `dispatch_task_${id}` }; }
  path(run) { return join(this.root, `${this.task(run).id}.json`); }
  saved(run) { try { return JSON.parse(readFileSync(this.path(run), 'utf8')); } catch { return null; } }
  env(run) { return run.workspace && perTask(run.project) ? this.saved(run)?.env ?? {} : {}; }

  sourceEnv(run, signal) { return this.live.databases.connectionEnv(run, taskDatabaseEntry(run.project), signal, { source: true }); }

  async create(run, signal) {
    const settings = perTask(run.project);
    await this.sweep(run.project);
    const task = this.task(run), source = await this.sourceEnv(run, signal), port = settings.provider === 'commands' && JSON.stringify(settings).includes('{port}') ? await freePort() : null;
    const env = settings.provider === 'commands' ? await this.createWithCommands(run, settings, { task: task.name, port }, source, signal) : await this.provisionWithConnector(run, settings.provider, task, source, signal);
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    writeFileSync(this.path(run), JSON.stringify({ provider: settings.provider, task, port, env, projectId: run.project.id, workspace: run.workspace }), { mode: 0o600 });
    this.pointEnvFile(run, env);
    this.live.log(run, 'database', `This task has its own database (${task.name}) from ${settings.provider === 'commands' ? 'your create command' : this.live.connectors.registry.get(settings.provider)?.name ?? settings.provider}; the shared development database is not changed.`);
  }

  async provisionWithConnector(run, id, task, env, signal) {
    const result = await this.live.connectors.invoke(run.project, id, 'database.provision', [{ task, env, workspace: run.workspace }], { signal });
    const provisioned = result?.env && typeof result.env === 'object' ? Object.fromEntries(Object.entries(result.env).filter(([name, value]) => envName.test(name) && typeof value === 'string')) : {};
    if (!Object.keys(provisioned).length) throw new Error(`${id} did not return the task database's variables.`);
    return provisioned;
  }

  async createWithCommands(run, settings, values, source, signal) {
    await this.command(run, settings.drop, values, source, signal).catch(() => {});
    await this.command(run, settings.create, values, source, signal);
    return Object.fromEntries(Object.entries(settings.env).map(([name, value]) => [name, fill(value, values)]));
  }

  async command(run, step, values, env, signal) {
    const args = step.args.map(arg => fill(arg, values)), result = await this.execute(fill(step.command, values), args, { cwd: run.workspace, signal, timeoutMs: commandTimeoutMs, inheritEnv: false, env: localEnvironment(env) });
    const output = redact(result.output, env);
    if (result.exitCode !== 0 || result.timedOut) throw new Error(`${step.command} failed: ${tail(output.trim()) || `exit ${result.exitCode}`}`);
    return output;
  }

  // Apps that read the env file themselves see the task database too; the copy is ignored by Git.
  pointEnvFile(run, env) {
    const { connection } = taskDatabaseEntry(run.project);
    if (connection.from !== 'envFile') return;
    const path = join(run.workspace, connection.envFile);
    let text = existsSync(path) ? readFileSync(path, 'utf8') : '';
    for (const [name, value] of Object.entries(env)) {
      const line = new RegExp(`^(export\\s+)?${name}=.*$`, 'm');
      text = line.test(text) ? text.replace(line, (_, exported = '') => `${exported}${name}=${value}`) : `${text.replace(/\n?$/, '\n')}${name}=${value}\n`;
    }
    writeFileSync(path, text, { mode: 0o600 });
  }

  async migrate(run, signal) {
    const settings = perTask(run.project), env = this.env(run);
    if (!settings.migrate) throw new Error('This repository has no migrate command. Ask the operator to set one under Extras › Database.');
    if (!Object.keys(env).length) throw new Error('This task has no database of its own yet; call reset to create it.');
    const output = await this.command(run, settings.migrate, {}, env, signal);
    this.live.log(run, 'database', `Ran ${[settings.migrate.command, ...settings.migrate.args].join(' ')} against the task database.`);
    return tail(output.trim()) || '(no output)';
  }

  async call(run, args, { signal } = {}) {
    if (!perTask(run.project)) throw new Error('This repository does not give tasks their own database.');
    if (args.action === 'reset') { await this.live.stopDevServer(run); await this.release(run); await this.create(run, signal); return text('Recreated this task’s database from the development database. Run migrate to apply this task’s migrations.', 'reset'); }
    return text(await this.migrate(run, signal), 'migrate');
  }

  async release(run) {
    const saved = this.saved(run);
    if (!saved) return;
    try { await this.releaseSaved(run.project, saved, run.workspace); }
    catch (error) { this.live.log(run, 'database', `Could not remove the task database: ${error.message}`); }
    rmSync(this.path(run), { force: true });
  }

  async releaseSaved(project, saved, workspace) {
    const settings = perTask(project);
    if (saved.provider === 'commands') { if (settings?.drop) await this.command({ workspace: existsSync(workspace) ? workspace : project.repositoryPath }, settings.drop, { task: saved.task.name, port: saved.port }, saved.env); return; }
    await this.live.connectors.invoke(project, saved.provider, 'database.release', [{ task: saved.task, env: saved.env, workspace }], {});
  }

  // A crash or a removed checkout can leave a task database behind; any whose worktree is gone is released.
  async sweep(project) {
    const live = new Set(this.live.engine.runs.filter(run => run.workspace && !run.worktreeRemovedAt).map(run => run.workspace));
    for (const file of existsSync(this.root) ? readdirSync(this.root).filter(name => name.endsWith('.json')) : []) {
      let saved; try { saved = JSON.parse(readFileSync(join(this.root, file), 'utf8')); } catch { continue; }
      if (saved.projectId !== project.id || live.has(saved.workspace)) continue;
      await this.releaseSaved(project, saved, saved.workspace).catch(() => {});
      rmSync(join(this.root, file), { force: true });
    }
  }
}

const text = (value, action) => ({ content: [{ type: 'text', text: value }], isError: false, view: { type: 'log', label: 'Database', title: action, text: value } });
