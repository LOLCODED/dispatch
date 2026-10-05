import { InputError } from './engine.mjs';

const approve = 'Change it', decline = 'Leave it', maxShown = 600;

export const settingsTool = {
  name: 'dispatch_settings', kind: 'settings',
  description: 'Read and change dispatch’s own settings, the same ones its settings pages change: list (optionally search), get or set a key. Add repository for a repository’s settings, such as repository.databases. Each set waits for the operator’s approval. Secrets cannot be read.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['action'], properties: {
    action: { type: 'string', enum: ['list', 'get', 'set'] }, key: { type: 'string', maxLength: 120 }, value: { description: 'The new value: text, true/false, a number, or JSON for structured settings.' },
    repository: { type: 'string', maxLength: 200, description: 'A saved repository’s name, for repository.* settings.' }, search: { type: 'string', maxLength: 80 },
  } },
};

const shown = value => { const text = typeof value === 'string' ? value : JSON.stringify(value); return text.length > maxShown ? `${text.slice(0, maxShown)}…` : text; };
const text = value => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError: false });

// The agent reads freely; every change is the operator's call, asked in the run like any other question.
export class SettingsTool {
  constructor(live) { this.live = live; }
  get registry() { return this.live.settingsRegistry; }

  async call(run, args, { signal } = {}) {
    const options = args.repository ? { repository: args.repository } : {};
    if (args.action === 'list') return text(this.registry.describe(options).filter(entry => !args.search || `${entry.key} ${entry.description}`.toLowerCase().includes(args.search.toLowerCase())));
    if (!args.key) throw new InputError(`${args.action} needs a key; list shows them.`);
    if (args.action === 'get') return text({ key: args.key, value: this.registry.get(args.key, options) });
    if (args.value === undefined) throw new InputError('set needs a value.');
    const current = this.registry.get(args.key, options);
    if (await this.ask(run, args, current, signal) !== approve) return text(`The operator kept ${args.key} as it is.`);
    const result = await this.registry.set(args.key, args.value, options);
    this.live.log(run, 'settings', `Changed ${args.key}${args.repository ? ` for ${args.repository}` : ''} with your approval.`);
    return text(result);
  }

  async ask(run, args, current, signal) {
    const where = args.repository ? ` for ${args.repository}` : '';
    const { answers } = await this.live.interactions.request(run, { kind: 'question', source: 'tool', questions: [{ id: 'setting', header: 'Change a setting', question: `Change ${args.key}${where} from ${shown(current)} to ${shown(args.value)}?`,
      options: [{ label: approve, description: 'dispatch saves it as its settings page would.' }, { label: decline, description: 'Keep the current value.' }] }] }, signal);
    return answers?.setting?.answers?.[0] ?? null;
  }
}
