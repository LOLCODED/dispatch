import { InputError } from './engine.mjs';
import { databaseHosts } from './network-access.mjs';

const approve = 'Change it', decline = 'Leave it', maxShown = 600;
// Claude Code fixes a turn's sandbox when the turn starts, so retrying in the same turn only repeats the refusal.
const nextTurn = 'The next turn of this task, which dispatch starts on its own once this turn ends. This turn keeps its sandbox: stop retrying and finish with DISPATCH_BLOCKED: naming what you will retry; do not ask the operator to reply.';

export const settingsTool = {
  name: 'dispatch_settings', kind: 'settings',
  description: 'Read and change dispatch’s own settings, the same ones its settings pages change: list (optionally search), get or set a key. Add repository for a repository’s settings, such as repository.databases or repository.network (the sandbox’s allowed hosts); list without one also shows this task’s repositories. A set replaces the whole value, so keep what is already there, for example every host already listed. Each set waits for the operator’s approval. Secrets cannot be read.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['action'], properties: {
    action: { type: 'string', enum: ['list', 'get', 'set'] }, key: { type: 'string', maxLength: 120 }, value: { description: 'The new value: text, true/false, a number, or JSON for structured settings.' },
    repository: { type: 'string', maxLength: 200, description: 'A saved repository’s name, for repository.* settings.' }, search: { type: 'string', maxLength: 80 },
  } },
};

const shown = value => { const text = typeof value === 'string' ? value : JSON.stringify(value); return text.length > maxShown ? `${text.slice(0, maxShown)}…` : text; };
const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError: false });
const parsed = value => { if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return value; } };

export function databaseHostRefusal(key, value, current) {
  if (key !== 'repository.network') return null;
  const added = databaseHosts(parsed(value)?.hosts).filter(host => !(current?.hosts ?? []).includes(host));
  if (!added.length) return null;
  return { content: [{ type: 'text', text: `${added.join(', ')} ${added.length === 1 ? 'is a database address' : 'are database addresses'}: the sandbox only carries web requests, so allowing ${added.length === 1 ? 'it' : 'them'} would not let your commands connect, and the operator was not asked. Query a database the repository lists with dispatch_sql. When none is listed, finish the code without it and, after DISPATCH_REMAINING, list the queries or steps the operator must run; the operator can add the database under Extras › Databases, including one behind a tunnel they keep open.` }], isError: true };
}

// The agent reads freely; every change is the operator's call, asked in the run like any other question.
export class SettingsTool {
  constructor(live) { this.live = live; }
  get registry() { return this.live.settingsRegistry; }

  async call(run, args, { signal } = {}) {
    const options = args.repository ? { repository: args.repository } : {};
    if (args.action === 'list') return text(this.list(run, args).filter(entry => !args.search || `${entry.key} ${entry.description}`.toLowerCase().includes(args.search.toLowerCase())));
    if (!args.key) throw new InputError(`${args.action} needs a key; list shows them.`);
    if (args.action === 'get') return text({ key: args.key, value: this.registry.get(args.key, options) });
    if (args.value === undefined) throw new InputError('set needs a value.');
    const current = this.registry.get(args.key, options);
    const refused = databaseHostRefusal(args.key, args.value, current);
    if (refused) { this.live.log(run, 'settings', `Did not ask to allow ${args.key} database hosts: the sandbox cannot carry database connections.`); return refused; }
    const answer = await this.ask(run, args, current, signal);
    if (answer !== approve) return text(answer && answer !== decline ? `The operator did not approve ${args.key} as asked. Their reply: ${answer}` : `The operator kept ${args.key} as it is.`);
    const result = await this.registry.set(args.key, args.value, options).catch(error => {
      throw new InputError(`${error.message} ${args.key} expects: ${this.registry.find(args.key, options).description} It is now ${shown(current)}.`);
    });
    this.live.log(run, 'settings', `Changed ${args.key}${args.repository ? ` for ${args.repository}` : ''} with your approval.`);
    if (args.key === 'repository.network') run.networkChanged = true;
    return text(args.key === 'repository.network' ? { ...result, appliesFrom: nextTurn } : result);
  }

  // An agent searching for a setting rarely knows it is per repository, so its own task's repositories are listed too.
  list(run, args) {
    if (args.repository) return this.registry.describe({ repository: args.repository });
    const ids = new Set([run.projectId ?? run.project?.id, ...(run.linked ?? []).map(member => member.projectId)]);
    const own = this.live.projects.filter(project => ids.has(project.id)).flatMap(project => this.registry.describe({ repository: project.id }).map(entry => ({ ...entry, repository: project.name })));
    return [...this.registry.describe({}), ...own];
  }

  async ask(run, args, current, signal) {
    const where = args.repository ? ` for ${args.repository}` : '';
    const { answers } = await this.live.interactions.request(run, { kind: 'question', source: 'tool', questions: [{ id: 'setting', header: 'Change a setting', question: `Change ${args.key}${where} from ${shown(current)} to ${shown(args.value)}?`,
      options: [{ label: approve, description: 'dispatch saves it as its settings page would.' }, { label: decline, description: 'Keep the current value.' }] }] }, signal);
    return answers?.setting?.answers?.[0] ?? null;
  }
}
