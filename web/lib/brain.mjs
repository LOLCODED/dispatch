import { textMatches } from './list-view.mjs';

export const kindOrder = ['rule', 'preference', 'connector', 'note'];
export const kindLabels = { rule: 'Rules', preference: 'Preferences', connector: 'Connectors', note: 'Notes' };
export const sourceLabels = { operator: 'You', agent: 'Agent', observed: 'Observed' };

export function scopeName(scope, projects = []) {
  if (scope === 'global') return 'Everywhere';
  const id = scope.replace(/^project:/, '');
  return projects.find(project => project.id === id)?.name ?? 'Removed repository';
}

export function matchesFilter(entry, text) {
  return textMatches([entry.label, entry.text, entry.key, entry.value, entry.trigger, entry.action].filter(Boolean), text);
}

export function provenance(entry) {
  const parts = [];
  if (entry.origin?.via) parts.push({ import: 'imported from settings', settings: 'from settings', composer: 'from the composer', verdict: 'from a verdict answer', tool: 'from the agent', reply: 'from a reply', switch: 'from a model switch', escalation: 'from an escalation' }[entry.origin.via] ?? entry.origin.via);
  if (entry.answers?.length) parts.push(`answered ${entry.answers.length}×`);
  if (entry.uses) parts.push(`used ${entry.uses}×`);
  if (entry.lastUsedAt) parts.push(`last ${entry.lastUsedAt.slice(0, 10)}`);
  return parts.join(' · ');
}
