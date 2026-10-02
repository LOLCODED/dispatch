const ignored = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'when', 'into', 'can', 'should', 'not', 'use', 'using', 'add', 'fix', 'make', 'update', 'change', 'task', 'tasks', 'are', 'was', 'its', 'our', 'you', 'all', 'any', 'have', 'has', 'but', 'out', 'new']);
const minSharedWords = 2;

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, name) => new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(name.toLowerCase())}(?=$|[^\\p{L}\\p{N}_])`, 'u').test(text);

function words(text = '') {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3 && !ignored.has(word) && !/^\d+$/.test(word)));
}

function onlyBest(scored) {
  const [best, next] = scored.sort((a, b) => b.score - a.score);
  return best && best.score > (next?.score ?? -1) ? best.folder : null;
}

function byName(text, folders) {
  const lower = text.toLowerCase();
  return onlyBest(folders.filter(folder => mentions(lower, folder.name)).map(folder => ({ folder, score: folder.name.length })));
}

function byWords(text, folders, filed) {
  const wanted = words(text);
  if (!wanted.size) return null;
  const scored = folders.map(folder => {
    const known = new Set([...words(folder.name), ...filed.filter(task => task.folderId === folder.id).flatMap(task => [...words(task.title)])]);
    return { folder, score: [...wanted].filter(word => known.has(word)).length };
  }).filter(({ score }) => score >= minSharedWords);
  return onlyBest(scored);
}

function newest(at, folders) {
  const time = Date.parse(at);
  if (!time) return null;
  return folders.filter(folder => Date.parse(folder.createdAt) <= time).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
}

// Deterministic on purpose: a mentioned folder name wins, then shared words with a folder's tasks, then the newest folder made before the task (one folder per sprint).
export function suggestFolder({ text, at }, folders = [], filed = []) {
  if (!text?.trim() || !folders.length) return null;
  const named = byName(text, folders);
  if (named) return { folder: named, reason: `mentions ${named.name}` };
  const similar = byWords(text, folders, filed);
  if (similar) return { folder: similar, reason: `like other tasks in ${similar.name}` };
  const latest = newest(at, folders);
  return latest && { folder: latest, reason: 'newest folder' };
}

// Archived work and landings, which follow the folders of the tasks they land, are left alone; only unfiled tasks get a suggestion.
export function unfiledSuggestions(entries, folders = []) {
  if (!folders.length) return [];
  const filed = entries.filter(entry => entry.item.folderId).map(entry => ({ title: entry.title, folderId: entry.item.folderId }));
  return entries.filter(entry => !entry.item.folderId && entry.state !== 'archived' && entry.latest?.kind !== 'landing').flatMap(entry => {
    const suggestion = suggestFolder({ text: entry.title, at: entry.createdAt ?? entry.latest?.createdAt }, folders, filed);
    return suggestion ? [{ entry, ...suggestion }] : [];
  });
}
