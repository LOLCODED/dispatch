import { connectorApi } from '../src/connectors/api.mjs';

const key = change => `${change.workspace}:${change.branch}`;
const kept = change => ({ branch: change.branch, base: change.base, headSha: change.headSha, workspace: change.workspace });

// An in-memory code host: the delivery contract without any real platform behind it.
export function forgeDouble({ api = connectorApi(), checks = [{ name: 'ci', status: 'completed', conclusion: 'success' }], status = { available: true, authenticated: true, detail: 'Test forge' } } = {}) {
  const forge = { calls: [], pulls: new Map(), checks, reviews: [], logs: {}, fail: {}, next: 7, status };
  const record = (hook, change, extra = {}) => {
    forge.calls.push({ hook, ...kept(change), ...extra });
    const failure = forge.fail[hook];
    if (failure) throw typeof failure === 'function' ? failure() : failure;
  };
  const hooks = {
    push: (change, ctx) => { record('push', change, { remote: ctx.settings.remote }); ctx.remember({ repository: 'example/repo' }); return { remote: ctx.settings.remote }; },
    findPullRequest: change => { record('findPullRequest', change); const pull = forge.pull(change); return pull ? { ...pull } : null; },
    openPullRequest: (change, ctx) => {
      const { title, body } = api.describeChange(change);
      record('openPullRequest', change, { title, body, draft: ctx.settings.draft });
      const pr = { number: forge.next++, url: `https://forge.example/repo/pull/${forge.next - 1}`, state: 'OPEN', headRefOid: change.headSha, reused: false, baseRefName: change.base };
      forge.pulls.set(key(change), { ...pr, reused: true });
      return pr;
    },
    describe: change => { record('describe', change, { url: change.delivery.pr.url, body: api.describeChange(change).body }); },
    checks: change => { record('checks', change, { sha: change.delivery.headSha }); return forge.checks; },
    checkLogs: (change, failing) => { record('checkLogs', change, { names: failing.map(check => check.name) }); return failing.map(check => ({ name: check.name, conclusion: check.conclusion, log: forge.logs[check.name] ?? `${check.name} log` })); },
    reviews: change => { record('reviews', change); return forge.reviews; },
  };
  forge.connector = {
    id: 'forge', name: 'Example Forge', description: 'A test code host.',
    status: async () => forge.status,
    settings: { remote: { label: 'Git remote', type: 'string', default: 'origin' }, draft: { label: 'Open as draft', type: 'boolean', default: true } },
    actions: {
      push: { label: 'Push task branches', access: 'write', hooks: { 'delivery.push': (...args) => hooks.push(...args) } },
      openPullRequest: { label: 'Open pull requests', access: 'write', hooks: { 'delivery.openPullRequest': (...args) => hooks.openPullRequest(...args), 'delivery.describe': (...args) => hooks.describe(...args) } },
      readPullRequests: { label: 'Read pull requests', access: 'read', hooks: { 'delivery.findPullRequest': (...args) => hooks.findPullRequest(...args), 'delivery.reviews': (...args) => hooks.reviews(...args) } },
      readChecks: { label: 'Read CI checks', access: 'read', hooks: { 'delivery.checks': (...args) => hooks.checks(...args), 'delivery.checkLogs': (...args) => hooks.checkLogs(...args) } },
    },
  };
  forge.hooks = hooks;
  forge.pull = change => forge.pulls.get(key(change));
  forge.of = hook => forge.calls.filter(call => call.hook === hook);
  return forge;
}

// Repository settings that deliver automatically through the forge.
export const forgeOn = (settings = {}) => ({ forge: { enabled: true, actions: { push: true, openPullRequest: true }, settings } });
export const publishWrites = live => live.connectors.setGlobal('forge', { actions: { push: true, openPullRequest: true } });
