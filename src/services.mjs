import { InputError } from './engine.mjs';
import { localEnvironment } from './local-tools.mjs';
import { runProcess } from './process.mjs';

const maxServices = 10, logLimit = 40_000, shownLimit = 8_000, serviceId = /^[a-z][a-z0-9-]{0,30}$/;

export const serviceTool = {
  name: 'dispatch_service', kind: 'service',
  description: 'Run this task’s services outside the sandbox and read their logs. list shows them; start and stop run a service the repository declares; logs returns the latest output of a service or of a dev server (app, or app:<name> for a linked repository). Use it to see server errors while testing.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { type: 'string', enum: ['list', 'start', 'stop', 'logs'] }, service: { type: 'string', maxLength: 80 } } },
};

export function serviceSettings(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxServices) throw new InputError(`Declare at most ${maxServices} services.`);
  const services = value.map(item => ({ id: item?.id, command: item?.command, args: item?.args ?? [] }));
  if (services.some(item => !serviceId.test(item.id ?? '') || item.id === 'app' || typeof item.command !== 'string' || !item.command.trim() || !Array.isArray(item.args) || item.args.some(arg => typeof arg !== 'string'))) throw new InputError('Each service needs a short lowercase id (not app) and a command.');
  if (new Set(services.map(item => item.id)).size !== services.length) throw new InputError('Service ids must be unique.');
  return services;
}

export function logBuffer() {
  let text = '';
  return { add: chunk => { text = (text + chunk).slice(-logLimit); }, read: () => text };
}
const tail = text => text.length > shownLimit ? `… ${text.length - shownLimit} earlier characters\n${text.slice(-shownLimit)}` : text || '(no output yet)';

// Declared services belong to the run: they start on request and stop with its dev servers.
export class Services {
  constructor(live, { execute = runProcess } = {}) { this.live = live; this.execute = execute; this.running = new Map(); }

  declared(run) {
    return [run, ...(run.linked ?? [])].flatMap(owner => (owner.project?.services ?? []).map(service => ({ ...service, workspace: owner.workspace, repository: owner === run ? null : owner.name })));
  }

  find(run, id) {
    const service = this.declared(run).find(item => item.id === id || (item.repository && `${item.repository}:${item.id}` === id));
    if (!service) throw new Error(`No service called ${id}. Use list to see this task's services.`);
    return service;
  }

  key(run, service) { return `${run.id}:${service.repository ?? ''}:${service.id}`; }

  async call(run, args, { signal } = {}) {
    if (args.action === 'list') return text(this.list(run));
    if (!args.service) throw new Error(`${args.action} needs a service.`);
    if (args.action === 'logs') return logView(await this.logs(run, args.service, signal), args.service);
    const service = this.find(run, args.service);
    return args.action === 'start' ? text(this.start(run, service)) : logView(await this.stop(run, service), service.id);
  }

  list(run) {
    const lines = this.declared(run).map(service => `${service.repository ? `${service.repository}:` : ''}${service.id}: ${[service.command, ...service.args].join(' ')} (${this.running.has(this.key(run, service)) ? 'running' : 'stopped'})`);
    return ['app: this worktree’s dev server (logs only; dispatch starts it for app:/)', ...lines].join('\n');
  }

  start(run, service) {
    const key = this.key(run, service);
    if (this.running.has(key)) return `${service.id} is already running.`;
    const logs = logBuffer(), stop = new AbortController();
    const exited = this.execute(service.command, service.args, { cwd: service.workspace, signal: stop.signal, timeoutMs: 3_600_000, inheritEnv: false, env: localEnvironment({ ...(service.repository ? {} : this.live.taskDatabases?.env(run)), CI: '1' }), maxOutput: 1000, onStdout: logs.add, onStderr: logs.add });
    this.running.set(key, { service, logs, stop, exited });
    exited.then(result => { logs.add(`\n[exited with code ${result.exitCode}]`); });
    this.live.log(run, 'service', `Started ${service.id}${service.repository ? ` in ${service.repository}` : ''}: ${[service.command, ...service.args].join(' ')}`);
    return `Started ${service.id}. Read its output with logs.`;
  }

  async stop(run, service) {
    const entry = this.running.get(this.key(run, service));
    if (!entry) return `${service.id} is not running.`;
    this.running.delete(this.key(run, service)); entry.stop.abort(); await entry.exited.catch(() => {});
    this.live.log(run, 'service', `Stopped ${service.id}.`);
    return `Stopped ${service.id}.\n${tail(entry.logs.read())}`;
  }

  async logs(run, id, signal) {
    if (/^app(:|$)/.test(id)) {
      const server = await this.live.devServerFor(run, signal, id === 'app' ? null : this.live.linked.appTarget(run, `${id}/`).member);
      return tail(server.logs?.() ?? '');
    }
    const entry = this.running.get(this.key(run, this.find(run, id)));
    return entry ? tail(entry.logs.read()) : `${id} is not running.`;
  }

  async stopAll(run) {
    for (const [key, entry] of [...this.running]) if (key.startsWith(`${run.id}:`)) { this.running.delete(key); entry.stop.abort(); await entry.exited.catch(() => {}); }
  }
}

const text = value => ({ content: [{ type: 'text', text: value }], isError: false });
const logView = (value, service) => ({ ...text(value), view: { type: 'log', label: 'Service', title: service, text: value } });
