import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { git } from './local-tools.mjs';
import { isPlain } from './plain-folder.mjs';
import { projectForPath } from './repository.mjs';

const fileLimit = 20000;
const confidentScore = 1.5;
const stopWords = new Set(('a an and are as at be but by can could do does did for from get got has have how i if in into is it its just like make me my need needs not of on or our out please should so some that the their them then there these this those to up use used using was we were what when where which while who why will with would you your yes no all any also too very more less most much many one two three new now still really want wants feel feels look looks seem seems thing things stuff way bit lot fix fixed fixes bug bugs issue issues add added adds remove change changes changed update updated work works working broken break breaks right wrong good bad better make made show shows see try sure every each other another same here only again first last next before after since until about above below over under off than then via per etc '
  + 'src lib web app apps test tests spec specs index main mod util utils helper helpers common shared core public assets docs doc readme license package json mjs cjs js jsx ts tsx css scss html md txt yml yaml toml lock config configs scripts script build dist node modules vendor types type').split(' '));

const singular = word => word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;

export const splitWords = value => String(value)
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  .toLowerCase().split(/[^a-z0-9]+/).map(singular).filter(word => word.length > 2 && !/^\d+$/.test(word) && !stopWords.has(word));

export const ticketTerms = text => [...new Set(splitWords(text))];

function readManifest(folder) {
  try { return JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')); } catch { return {}; }
}

const packageWords = manifest => [manifest.name, manifest.description, ...(manifest.keywords ?? []), ...Object.keys(manifest.dependencies ?? {})].filter(value => typeof value === 'string').flatMap(splitWords);

function plainFiles(folder) {
  try {
    return readdirSync(folder, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && !/(^|\/)(node_modules|\.git)(\/|$)/.test(entry.parentPath ?? entry.path))
      .slice(0, fileLimit).map(entry => join(entry.parentPath ?? entry.path, entry.name).slice(folder.length + 1));
  } catch { return []; }
}

async function trackedFiles(folder) {
  const output = await git(folder, ['ls-files', '-z'], { timeoutMs: 5000, maxOutput: 2_000_000 });
  return output.split('\0').filter(Boolean).slice(0, fileLimit);
}

export function buildProfile(project, files) {
  const manifest = readManifest(project.repositoryPath), counts = new Map();
  for (const word of [...splitWords(project.name), ...splitWords(basename(project.repositoryPath)), ...packageWords(manifest), ...files.flatMap(file => splitWords(file.replace(/\.[a-z0-9]+$/i, '')))]) counts.set(word, (counts.get(word) ?? 0) + 1);
  const names = new Map();
  for (const file of files) { const name = basename(file).toLowerCase(); if (!names.has(name)) names.set(name, file); }
  return { projectId: project.id, terms: new Set(counts.keys()), counts, names, description: typeof manifest.description === 'string' ? manifest.description.slice(0, 200) : '' };
}

// The words a repository's files use most that the other candidates do not, so a short description can tell them apart.
export function distinctiveTerms(profile, others, limit = 20) {
  return [...profile.counts].filter(([word]) => !others.some(other => other.terms.has(word)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([word]) => word);
}

// Profiles are rebuilt only when a repository's HEAD moves, so routing a ticket costs one rev-parse per repository.
export class RepositoryProfiles {
  constructor() { this.cache = new Map(); }

  async head(project) {
    if (isPlain(project)) return 'folder';
    return git(project.repositoryPath, ['rev-parse', 'HEAD'], { timeoutMs: 5000 }).catch(() => null);
  }

  async refresh(project) {
    const head = await this.head(project), cached = this.cache.get(project.id);
    if (cached && cached.head === head && cached.path === project.repositoryPath) return cached.profile;
    const files = isPlain(project) ? plainFiles(project.repositoryPath) : head ? await trackedFiles(project.repositoryPath).catch(() => []) : [];
    const profile = buildProfile(project, files);
    this.cache.set(project.id, { head, path: project.repositoryPath, profile });
    return profile;
  }

  async warm(projects) { await Promise.all(projects.map(project => this.refresh(project).catch(() => null))); }

  known(projects) { return projects.map(project => this.cache.get(project.id)?.profile).filter(Boolean); }
}

const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const forgeLink = /\b(?:github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/([\w.-]+?)(?:\.git)?\/(?:-\/)?(?:pull|pulls|issues|merge_requests|commit|blob|tree)\b/gi;
const filePath = /(?:~|\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[A-Za-z][A-Za-z0-9]{0,7}(?=[:\s)\]'",;]|$)/g;

function runClues(text, projects, runs) {
  return [...text.matchAll(uuid)].flatMap(([id]) => {
    const run = runs.find(item => item.id === id.toLowerCase());
    const project = run && projects.find(item => item.id === run.projectId);
    return project ? [{ project, why: `run ${id.slice(0, 8)} ran in ${project.name}` }] : [];
  });
}

function linkClues(text, projects) {
  return [...text.matchAll(forgeLink)].flatMap(([, name]) => {
    const wanted = name.toLowerCase(), project = projects.find(item => item.name.toLowerCase() === wanted || basename(item.repositoryPath).toLowerCase() === wanted);
    return project ? [{ project, why: `the link points at ${name}` }] : [];
  });
}

function fileClues(text, projects, profiles) {
  return [...text.matchAll(filePath)].flatMap(([raw]) => {
    if (/^https?:|\/\//.test(raw) || /^\d/.test(raw)) return [];
    if (isAbsolute(raw)) { const project = projectForPath(raw, projects); return project ? [{ project, why: `${raw} is inside ${project.name}` }] : []; }
    const relative = raw.replace(/^\.\//, '');
    const owners = relative.includes('/')
      ? projects.filter(project => existsSync(join(project.repositoryPath, relative)))
      : profiles.filter(profile => profile.names.has(relative.toLowerCase())).map(profile => projects.find(project => project.id === profile.projectId)).filter(Boolean);
    return owners.length === 1 ? [{ project: owners[0], why: `only ${owners[0].name} has ${relative}` }] : [];
  });
}

// Pasted run ids, forge links and file paths point at exactly one repository each; they decide only when they agree.
export function pastedClues(text, projects, { runs = [], profiles = [] } = {}) {
  const clues = [...runClues(text, projects, runs), ...linkClues(text, projects), ...fileClues(text, projects, profiles)];
  const owners = [...new Set(clues.map(clue => clue.project))];
  return { clues, project: owners.length === 1 ? owners[0] : null, owners };
}

export function fingerprint(text, projects, profiles) {
  const terms = ticketTerms(text), byId = new Map(profiles.map(profile => [profile.projectId, profile]));
  const known = projects.filter(project => byId.has(project.id));
  const owners = term => known.filter(project => byId.get(project.id).terms.has(term)).length;
  const ranked = known.map(project => {
    const hits = terms.filter(term => byId.get(project.id).terms.has(term));
    return { project, hits, score: Math.round(hits.reduce((sum, term) => sum + 1 / owners(term), 0) * 100) / 100 };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  const [top, next] = ranked;
  const linkedPair = top && next && (top.project.linked ?? []).includes(next.project.id) && next.score >= top.score / 2;
  const confident = Boolean(top) && top.score >= confidentScore && (linkedPair || top.score >= 2 * (next?.score ?? 0));
  return { ranked, confident, terms };
}

export const quoted = hits => hits.slice(0, 3).map(word => `“${word}”`).join(', ');

// A learned answer is keyed by the ticket's distinctive words, so the same kind of request routes the same way next time.
export function routingKey(text) {
  const words = ticketTerms(text).sort().join(' ').slice(0, 80).trim();
  return words ? `repository.route:${words}` : null;
}
