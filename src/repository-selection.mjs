import { InputError } from './engine.mjs';
import { maxTaskRepositories } from './repository.mjs';

// projectIds wins over projectId: an explicit list names every repository (first primary), 'all' hands the choice to the agent,
// and a lone projectId keeps the repository's own linked list, as before.
export function taskRepositories(input, projects) {
  const ids = input.projectIds;
  if (ids === 'all' || input.projectId === 'all') return { mode: 'agent', ids: [], inherit: false };
  if (ids !== undefined && ids !== null) return { mode: 'manual', ids: explicitIds(ids, projects), inherit: false };
  const selection = input.projectId ?? 'auto';
  if (selection === 'auto') return { mode: 'auto', ids: [], inherit: true };
  if (typeof selection !== 'string' || !projects.some(project => project.id === selection)) throw new InputError('Choose a saved repository.');
  return { mode: 'manual', ids: [selection], inherit: true };
}

function explicitIds(ids, projects) {
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string')) throw new InputError('Choose saved repositories.');
  const unique = [...new Set(ids)];
  if (unique.length > maxTaskRepositories) throw new InputError(`Choose at most ${maxTaskRepositories} repositories.`);
  if (unique.some(id => !projects.some(project => project.id === id))) throw new InputError('Choose saved repositories.');
  return unique;
}

export function agentMembers(primary, projects) {
  const others = projects.filter(project => project.id !== primary.id);
  if (others.length >= maxTaskRepositories) throw new InputError(`More than ${maxTaskRepositories} repositories are saved; tick the repositories this task involves instead of letting the agent decide.`);
  return others.map(project => project.id);
}
