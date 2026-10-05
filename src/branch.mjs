import { InputError } from './engine.mjs';

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
// A connector may propose a branch for the tickets it reads; an unusable proposal is ignored rather than failing intake.
const proposedBranch = ticket => { try { return ticket?.branch ? chosenBranch(ticket.branch) : null; } catch { return null; } };
export const ticketTemplate = ticket => proposedBranch(ticket) ?? defaultTemplate;
const branchValues = (ticket, runId) => ({ type: branchType(ticket?.type), ticketId: ticket?.id ? String(ticket.id) : runId, id: ticket?.id ? String(ticket.id) : runId.slice(0, 8), run: runId, slug: slug(ticket?.title) });

export function branchName(template, { ticket, runId, baseBranch }) {
  const values = branchValues(ticket, runId);
  const name = renderBranch(template ?? ticketTemplate(ticket), values);
  if (!safeBranch(name) || name === baseBranch) return renderBranch(defaultTemplate, values);
  return name;
}

// Suggestions are templates so they can be offered before the run, and its id, exists; {run} shows as <run>.
export function branchSuggestions(saved, ticket) {
  const templates = [...new Set([saved, proposedBranch(ticket), defaultTemplate].filter(Boolean))];
  return templates.map(template => ({ template, label: renderBranch(template, { ...branchValues(ticket, '<run>'), id: ticket?.id ? String(ticket.id) : '<run>' }) }));
}
export function chosenBranch(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new InputError('Choose a branch name under 120 characters.');
  const trimmed = value.trim(), used = [...trimmed.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1]);
  if (used.some(token => !tokens.includes(token))) throw new InputError(`Branch names can use {${tokens.join('}, {')}}.`);
  if (!safeBranch(renderBranch(trimmed, { type: 'task', ticketId: '1', id: '1', run: 'abcdef', slug: 'sample' }))) throw new InputError('That is not a valid Git branch name.');
  return trimmed;
}

export const branchModes = ['auto', 'ask'];
export const branchMode = state => state.branchNaming === 'ask' ? 'ask' : 'auto';
export function setBranchMode(store, mode) {
  if (!branchModes.includes(mode)) throw new InputError('Choose auto or ask.');
  store.state.branchNaming = mode; store.save();
  return mode;
}
