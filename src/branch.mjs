const types = { bug: 'bug', 'user story': 'story', story: 'story', task: 'task', feature: 'feature', epic: 'epic', issue: 'issue' };
const tokens = ['type', 'ticketId', 'id', 'run', 'slug'];
const unique = ['ticketId', 'id', 'run'];
const safeRef = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/;
export const defaultTemplate = 'dispatch/{run}';

export const branchType = ticketType => types[String(ticketType ?? '').trim().toLowerCase()] ?? 'task';
export const slug = title => String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'change';

export function safeBranch(name) {
  return typeof name === 'string' && safeRef.test(name) && !name.includes('..') && !name.includes('//') && !name.includes('@{') && !name.endsWith('.lock') && !name.endsWith('/') && !name.endsWith('.') && !name.startsWith('refs/') && !name.split('/').some(part => part.startsWith('.'));
}
export function validateTemplate(template) {
  if (typeof template !== 'string' || !template.trim() || template.length > 120) throw new Error('Branch template must be text under 120 characters.');
  const used = [...template.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1]);
  if (used.some(token => !tokens.includes(token))) throw new Error(`Branch template tokens are {${tokens.join('}, {')}}.`);
  if (!used.some(token => unique.includes(token))) throw new Error('Branch template needs {ticketId}, {id} or {run} so branches stay unique.');
  const sample = renderBranch(template, { type: 'task', ticketId: '1', id: '1', run: 'abcdef', slug: 'sample' });
  if (!safeBranch(sample)) throw new Error('Branch template renders an invalid Git branch name.');
  return template.trim();
}
export function renderBranch(template, values) {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, token) => String(values[token] ?? '')).replace(/-{2,}/g, '-');
}
export function branchName(template, { ticket, runId, baseBranch }) {
  const id = ticket?.id ? String(ticket.id) : runId.slice(0, 8);
  const values = { type: branchType(ticket?.type), ticketId: ticket?.id ? String(ticket.id) : runId, id, run: runId, slug: slug(ticket?.title) };
  const name = renderBranch(template ?? defaultTemplate, values);
  if (!safeBranch(name) || name === baseBranch) return renderBranch(defaultTemplate, values);
  return name;
}
