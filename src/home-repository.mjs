import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { initRepository } from './new-repository.mjs';
import { namedProjects } from './repository.mjs';

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

// Only a repository the text names on its own is chosen; anything else starts in dispatch home, where the agent asks before adding one.
export function autoRepository(text, projects, home) {
  const named = namedProjects(text, projects.filter(project => project.id !== home.id));
  if (named.length === 1) return { project: named[0], reason: `Selected ${named[0].name} from your instructions.` };
  return { project: home, reason: named.length ? `Several repositories are named; starting in ${homeName} so the agent can ask which.` : `No repository named; starting in ${homeName}.` };
}
