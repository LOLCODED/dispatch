export const maxTaskRepositories = 8;

const escape = value => value.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Match whole names/paths only. Ambiguous mentions must never select a target.
function mentionIndex(text, project) {
  const spans = mentionSpans(text, project);
  return spans.length ? Math.min(...spans.map(span => span.start)) : -1;
}

export function mentionedProjects(input, projects) {
  const text = input.toLowerCase();
  return projects.filter(project => mentionIndex(text, project) >= 0);
}

function mentionSpans(text, project) {
  return [project.repositoryPath, project.repositoryPath?.split('/').at(-1), project.name].filter(Boolean)
    .flatMap(value => [...text.matchAll(new RegExp(`(^|[^\\p{L}\\p{N}_/.-])${escape(value)}(?=$|[^\\p{L}\\p{N}_/.-])`, 'gu'))].map(match => {
      const start = match.index + match[1].length;
      return { start, end: start + value.length };
    }));
}

// Like mentionedProjects, but a mention lying inside a longer mention of another repository does not count: "Second repository" names that repository, not one whose folder is "repository".
export function namedProjects(input, projects) {
  const text = input.toLowerCase(), found = projects.map(project => ({ project, spans: mentionSpans(text, project) })).filter(item => item.spans.length);
  const inside = (span, other) => other.start <= span.start && span.end <= other.end && other.end - other.start > span.end - span.start;
  return found.filter(item => !item.spans.every(span => found.some(other => other !== item && other.spans.some(wider => inside(span, wider))))).map(item => item.project);
}

export function mentionOrder(input, projects) {
  const text = input.toLowerCase();
  return projects.map(project => ({ project, index: mentionIndex(text, project) })).filter(item => item.index >= 0).sort((a, b) => a.index - b.index).map(item => item.project);
}

export function resolveRepository(input, projects, selection = 'auto') {
  if (selection !== 'auto') {
    const project = projects.find(project => project.id === selection);
    return project ? { project, reason: `Using ${project.name}, as you answered.` } : { question: 'That repository is no longer saved. Which repository should I use?' };
  }
  const matches = mentionedProjects(input, projects);
  if (matches.length === 1) return { project: matches[0], reason: `Selected ${matches[0].name} from your instructions.` };
  if (matches.length > 1) return { question: 'Multiple repositories are mentioned. Which repository should I use?', candidates: matches };
  if (projects.length === 1) return { project: projects[0], reason: `Using your only saved repository, ${projects[0].name}.` };
  return { question: projects.length ? 'Which repository should I use for this task?' : 'Connect a repository before dispatching.', candidates: projects };
}

export const agentCanDecide = projects => projects.length > 1 && projects.length <= maxTaskRepositories;

// When the agent decides, the agent starts where the ticket points first; every saved repository stays in reach.
export function agentPrimary(input, candidates) {
  if (!candidates.length) return { question: 'Connect a repository before dispatching.' };
  const [mentioned] = mentionOrder(input, candidates);
  if (mentioned) return { project: mentioned, reason: `Starting in ${mentioned.name}, mentioned first; every saved repository is in reach.` };
  return { project: candidates[0], reason: `Starting in ${candidates[0].name}, your first saved repository; every saved repository is in reach.` };
}

const within = (path, root) => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);

export function projectForPath(path, projects) {
  return projects.filter(project => within(path, project.repositoryPath)).sort((a, b) => b.repositoryPath.length - a.repositoryPath.length)[0];
}

// A task saved from a terminal: an explicit --repo wins, then the working directory, then the composer's rules.
export function taskProject({ repo, cwd, input }, projects) {
  if (repo) {
    const wanted = repo.toLowerCase();
    const matches = projects.filter(project => [project.id, project.name, project.repositoryPath, project.repositoryPath.split('/').at(-1)].some(value => value?.toLowerCase() === wanted));
    if (matches.length === 1) return { project: matches[0] };
    return { error: matches.length ? `"${repo}" matches more than one repository; use its path.` : `No saved repository matches "${repo}".`, candidates: matches.length ? matches : projects };
  }
  const here = cwd && projectForPath(cwd, projects);
  if (here) return { project: here };
  const resolved = resolveRepository(input, projects);
  return resolved.project ? { project: resolved.project } : { error: `${resolved.question} Pass --repo.`, candidates: resolved.candidates ?? [] };
}

// --repo all lets the agent decide; --repo a,b lists the repositories, first one primary.
export function taskProjects({ repo, cwd, input }, projects) {
  const names = [].concat(repo ?? []).flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
  if (names.some(name => name.toLowerCase() === 'all')) return names.length === 1 ? { all: true } : { error: '--repo all cannot be combined with repository names.', candidates: [] };
  if (!names.length) { const single = taskProject({ cwd, input }, projects); return single.project ? { projects: [single.project] } : single; }
  const chosen = [];
  for (const name of names) {
    const found = taskProject({ repo: name }, projects);
    if (!found.project) return found;
    if (!chosen.includes(found.project)) chosen.push(found.project);
  }
  if (chosen.length > maxTaskRepositories) return { error: `Choose at most ${maxTaskRepositories} repositories.`, candidates: [] };
  return { projects: chosen };
}
