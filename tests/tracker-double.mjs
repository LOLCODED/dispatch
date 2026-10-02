export const trackerOrigin = 'https://tracker.example';
export const issueUrl = (project, id) => `${trackerOrigin}/${project}/issues/${id}`;

export function parseIssueRef(input, { memory = {} } = {}) {
  const text = String(input).trim(), url = text.match(/^https:\/\/tracker\.example\/([\w-]+)\/issues\/(\d+)$/);
  if (url) return { tracker: 'example', organization: trackerOrigin, project: url[1], id: url[2], sourceUrl: text };
  if (/^https:\/\/tracker\.example\//.test(text)) throw new Error('Paste an Example Tracker link ending in /issues/123, or paste the ticket text.');
  const bare = text.match(/^EX-(\d{1,9})$/i);
  return bare && memory.organization === trackerOrigin ? { tracker: 'example', organization: trackerOrigin, project: null, id: bare[1], sourceUrl: null } : null;
}

// A connector double whose behaviour tests replace by assigning double.read, double.states and so on.
export function exampleTracker({ rev = 4, states = ['New', 'Active', 'Resolved', 'Closed'], withRevision = true, notify = null, status, ...overrides } = {}) {
  const double = {
    calls: [], moves: [], events: [], rev,
    read: async ref => ({ ...ref, project: ref.project ?? 'demo', sourceUrl: ref.sourceUrl ?? issueUrl('demo', ref.id), key: `example:${ref.id}`, reference: `EX-${ref.id}`, revision: double.rev, title: `Issue ${ref.id}`, description: 'Change the value', acceptance: 'Pass', type: 'Bug', state: 'Active', remember: { organization: ref.organization } }),
    revision: async () => double.rev,
    comment: async (ref, text) => { double.calls.push(['comment', ref.id, text]); },
    states: async () => states,
    setState: async (ref, state, { expectedRevision } = {}) => {
      if (Number.isInteger(expectedRevision) && expectedRevision !== double.rev) return { moved: false, changed: true, rev: double.rev };
      double.moves.push([ref.id, state]); double.rev++;
      return { moved: true, changed: false, rev: double.rev };
    },
    notify: notify ?? (async summary => { double.events.push(summary); }),
    ...overrides,
  };
  double.connector = {
    id: 'example', name: 'Example Tracker',
    ...(status === null ? {} : { status: status ?? (async () => ({ available: true, authenticated: true, detail: 'Test tracker double' })) }),
    actions: {
      read: { label: 'Read issues', access: 'read', hooks: { 'ticket.detect': (input, ctx) => parseIssueRef(input, ctx), 'ticket.read': (...args) => double.read(...args), ...(withRevision ? { 'ticket.revision': (...args) => double.revision(...args) } : {}) } },
      comment: { label: 'Comment results', access: 'write', hooks: { 'ticket.comment': (...args) => double.comment(...args) } },
      state: { label: 'Move issue state', access: 'write', hooks: { 'ticket.states': (...args) => double.states(...args), 'ticket.setState': (...args) => double.setState(...args) } },
      notify: { label: 'Notify on run events', access: 'write', hooks: { 'run.ready': (...args) => double.notify(...args), 'run.blocked': (...args) => double.notify(...args), 'run.failed': (...args) => double.notify(...args) } },
    },
  };
  return double;
}

// Everything the double can do, switched on for one repository.
export const exampleOn = (extra = {}) => ({ example: { enabled: true, actions: { comment: true, state: true, notify: true, ...extra } } });
