import { git } from './local-tools.mjs';
import { commitTypes, miscellaneous, parseSubject } from './conventional-commit.mjs';

const maxReleases = 10;
const versionTag = /^v(\d+)\.(\d+)\.(\d+)$/;
const versionBump = /^v?\d+\.\d+\.\d+$/;
const groupOrder = [...new Set(Object.values(commitTypes)), miscellaneous];

const versionKey = version => String(version ?? '').replace(/^v/, '').split('.').map(Number);
export function compareVersions(a, b) {
  const [x, y] = [versionKey(a), versionKey(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

export function groupCommits(commits) {
  const groups = new Map();
  for (const { sha, subject } of commits) {
    if (versionBump.test(subject.trim())) continue;
    const entry = parseSubject(subject), label = commitTypes[entry.type] ?? miscellaneous;
    if (!entry.description) continue;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push({ sha: sha.slice(0, 12), scope: entry.scope, breaking: entry.breaking, description: entry.description });
  }
  return groupOrder.filter(label => groups.has(label)).map(label => ({ label, entries: groups.get(label) }));
}

async function releaseTags(root) {
  const tags = (await git(root, ['tag', '--merged', 'HEAD', '--list', 'v*'])).split('\n').map(tag => tag.trim()).filter(tag => versionTag.test(tag));
  return tags.sort(compareVersions);
}

async function commitsBetween(root, from, to) {
  const output = await git(root, ['log', '--no-merges', '--format=%H%x1f%s', from ? `${from}..${to}` : to]);
  return output.split('\n').filter(Boolean).map(line => { const [sha, subject] = line.split('\x1f'); return { sha, subject: subject ?? '' }; });
}

// Releases up to and including `version`, newest first, read from the app's own Git tags: all of them, those newer than `since` (at most ten), or only `version`.
export async function changelog(root, { version, since = null, all = false }) {
  let tags;
  try { tags = await releaseTags(root); } catch { return { version, releases: [] }; }
  const released = tags.filter(tag => compareVersions(tag, version) <= 0);
  const wanted = all ? released : released.filter(tag => since === null ? compareVersions(tag, version) === 0 : compareVersions(tag, since) > 0).slice(-maxReleases);
  const releases = [];
  for (const tag of wanted.reverse()) {
    const previous = tags[tags.indexOf(tag) - 1] ?? null;
    const date = await git(root, ['log', '-1', '--format=%cs', tag]);
    releases.push({ version: tag.slice(1), date, groups: groupCommits(await commitsBetween(root, previous, tag)) });
  }
  return { version, releases };
}
