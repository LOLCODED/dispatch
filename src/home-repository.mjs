import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { initRepository } from './new-repository.mjs';
import { namedProjects } from './repository.mjs';
import { fingerprint, pastedClues, quoted, routingKey } from './repository-routing.mjs';

export const homeName = 'dispatch home';
export const homeFolder = dataDir => join(realpathSync(dataDir), 'home');

// With no repository saved, tasks start in a repository inside dispatch's data folder; deleting it only means it is created again on the next task.
export async function ensureHome(live, folder) {
  if (!existsSync(join(folder, '.git'))) await initRepository(folder);
  return live.projects.find(project => project.repositoryPath === folder)
    ?? live.saveProject({ repositoryPath: folder, name: homeName, baseBranch: 'main', confirmed: true, validation: [], setup: [], checkScopes: [], browser: { enabled: false, headed: false }, review: false, memory: true });
}

// dispatch home is a scratch fallback, never one of the repositories "agent decides" or tracker intake chooses between.
export function homeAndSaved(projects, folder) {
  const home = folder ? projects.find(project => project.repositoryPath === folder) : undefined, saved = projects.filter(project => project !== home);
  return { home, saved: saved.length ? saved : projects };
}

export const needsHome = (projects, folder) => !projects.length || projects.some(project => project.repositoryPath === folder);

const chosen = (project, stage, confidence, reason, ranked = []) => ({ project, stage, confidence, reason, ranked });

function learnedChoice(text, saved, learned) {
  const key = routingKey(text), entry = key && learned ? learned(key) : null;
  const project = entry && saved.find(item => item.id === entry.value);
  return project ? { project, mode: entry.mode, count: entry.count } : null;
}

function rankedOptions(found, suggested) {
  const options = found.ranked.map(item => ({ project: item.project, reason: `mentions ${quoted(item.hits)}` }));
  if (!suggested) return options.slice(0, 3);
  return [{ project: suggested.project, reason: `your pick the last ${suggested.count} times` }, ...options.filter(item => item.project !== suggested.project)].slice(0, 3);
}

// Explicit signals win: a name, then pasted run ids, links and paths, then a learned habit, then the repositories' own files. Anything still unclear starts in dispatch home with ranked guesses for the agent.
export function autoRepository(text, projects, home, { runs = [], profiles = [], learned = null } = {}) {
  const saved = projects.filter(project => project.id !== home.id), named = namedProjects(text, saved);
  if (named.length === 1) return chosen(named[0], 'name', 'certain', `Selected ${named[0].name} from your instructions.`);
  if (named.length > 1) return chosen(home, 'name', 'ask', `Several repositories are named; starting in ${homeName} so the agent can ask which.`, named.map(project => ({ project, reason: 'named in the ticket' })));
  const pasted = pastedClues(text, saved, { runs, profiles });
  if (pasted.project) return chosen(pasted.project, 'paste', 'certain', `Selected ${pasted.project.name}: ${pasted.clues[0].why}.`);
  const habit = learnedChoice(text, saved, learned);
  if (habit?.mode === 'auto') return chosen(habit.project, 'learned', 'learned', `Selected ${habit.project.name}: you chose it the last ${habit.count} times for tickets like this.`);
  const found = fingerprint(text, saved, profiles), [top] = found.ranked;
  if (found.confident && (!habit || habit.project === top.project)) return chosen(top.project, 'fingerprint', 'likely', `Selected ${top.project.name}: the ticket mentions ${quoted(top.hits)}, which match its files.`);
  const ranked = rankedOptions(found, habit);
  return chosen(home, habit ? 'learned' : 'fingerprint', 'ask', ranked.length ? `No repository named; starting in ${homeName} with ${ranked.map(item => item.project.name).join(', ')} as the ${ranked.length === 1 ? 'best guess' : 'best guesses'}.` : `No repository named; starting in ${homeName}.`, ranked);
}
