import { conversationTree, latestRun, rootOf } from './conversations.mjs';
import { openRemaining } from './remaining.mjs';

export const activeStatuses = new Set(['queued', 'preparing', 'implementing', 'validating', 'reviewing', 'repairing', 'publishing', 'landing']);
const decisionStatuses = new Set(['blocked', 'budget_exceeded', 'failed', 'interrupted']);
export const groupOrder = ['decision', 'active', 'reviewing', 'queued', 'review', 'awaiting', 'todo', 'completed'];

export const conversationKey = root => root.taskId ?? root.id;
export const hasPendingRequest = run => Boolean(run.pendingRequest ?? run.interactions?.some(interaction => interaction.status === 'pending'));

// What a pushed pull request needs next. Conflicts block a merge outright, a change request only counts when it came after the latest push, and CI only for the pushed head.
export function pullRequestState(run) {
  const delivery = run?.delivery, pr = delivery?.pr;
  if (!pr || !delivery.pushedAt) return null;
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  if (pr.state !== 'OPEN') return null;
  if (pr.mergeable === 'CONFLICTING') return 'conflicts';
  if (pr.reviewDecision === 'CHANGES_REQUESTED' && Date.parse(pr.changesRequestedAt) > Date.parse(delivery.pushedAt)) return 'changes';
  if (delivery.ci?.state === 'failure' && delivery.ci.sha === delivery.headSha) return 'ci';
  return 'open';
}

// Pause and done belong to the run they were set on, so any later turn clears them without cleanup. A removed worktree or a merged pull request means the work was taken or dropped, so it counts as done.
export function taskState({ latest, item = {} }) {
  if (!latest) return item.archivedAt ? 'archived' : 'todo';
  if (activeStatuses.has(latest.status)) return hasPendingRequest(latest) ? 'decision' : latest.status === 'queued' ? 'queued' : 'active';
  if (latest.handingOff) return 'reviewing';
  if (item.archivedAt) return 'archived';
  if (item.pause?.runId === latest.id) return 'paused';
  const pullRequest = pullRequestState(latest);
  if (item.done?.runId === latest.id || latest.worktreeRemovedAt || latest.landed || pullRequest === 'merged') return 'completed';
  if (decisionStatuses.has(latest.status) || openRemaining(latest) || pullRequest && pullRequest !== 'open') return 'decision';
  return pullRequest === 'open' && latest.delivery.submittedAt ? 'awaiting' : 'review';
}

// Only work no agent has touched can be rewritten; continued or started runs take a follow-up instead.
export function editTarget({ key, state, latest, turns }) {
  if (state === 'todo') return { kind: 'tasks', id: key };
  if (latest?.status === 'queued' && turns === 1 && !latest.previousRunId && !latest.resumable) return { kind: 'runs', id: latest.id };
  return null;
}

export const groupOf = state => state === 'paused' ? 'decision' : state;

export function folderScope(folders, id) {
  const scope = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const folder of folders) if (scope.has(folder.parentId) && !scope.has(folder.id)) { scope.add(folder.id); grew = true; }
  }
  return scope;
}

export function folderDepth(folders, id) {
  const seen = new Set();
  let depth = 0, current = folders.find(folder => folder.id === id);
  while (current && !seen.has(current.id)) { seen.add(current.id); depth++; current = folders.find(folder => folder.id === current.parentId); }
  return depth;
}

export const isLanding = entry => entry.latest?.kind === 'landing';
// A landing is plumbing, not a task: it shows while it runs or needs you, and its landed tasks carry the record afterwards.
const settledLanding = entry => isLanding(entry) && ['review', 'completed', 'archived'].includes(entry.state);
export const activityAt = entry => Date.parse(entry.latest?.finishedAt ?? entry.latest?.createdAt) || 0;

function entries({ runs, tasks, items }) {
  const started = conversationTree(runs).map(chain => {
    const key = conversationKey(chain[0]), latest = latestRun(runs, chain[0]), item = items[key] ?? {};
    return { key, title: latest.summary || chain[0].title, request: chain[0].request ?? null, createdAt: chain[0].createdAt, startedAt: chain.find(run => run.startedAt)?.startedAt ?? null, latest, turns: chain.length, item, state: taskState({ latest, item }) };
  }).filter(entry => !settledLanding(entry));
  const saved = tasks.map(task => { const item = items[task.id] ?? {}; return { key: task.id, title: task.title, request: task.request ?? null, sourceRunId: task.sourceRunId ?? null, createdAt: task.createdAt, latest: null, turns: 0, item, state: taskState({ latest: null, item }) }; });
  return [...saved, ...started];
}

export function runEntry({ runs = [], tasks = [], board = {} }, runId) {
  const byId = new Map(runs.map(run => [run.id, run])), run = byId.get(runId);
  if (!run) return null;
  const key = conversationKey(rootOf(run, byId));
  return entries({ runs, tasks, items: board.items ?? {} }).find(entry => entry.latest && entry.key === key) ?? null;
}

// A landing is never filed itself, so it shows in every folder holding a task it lands.
function entryFolderIds(entry, items, byId) {
  if (!isLanding(entry)) return [entry.item.folderId];
  const landed = (entry.latest.landedRunIds ?? []).map(id => byId.get(id)).filter(Boolean);
  return [entry.item.folderId, ...landed.map(run => items[conversationKey(rootOf(run, byId))]?.folderId)];
}

export function boardView({ runs = [], tasks = [], board = {}, folderId = null }) {
  const folders = board.folders ?? [], items = board.items ?? {}, scope = folderId && folderScope(folders, folderId), byId = new Map(runs.map(run => [run.id, run]));
  const view = { decision: [], active: [], reviewing: [], queued: [], review: [], awaiting: [], todo: [], completed: [], archived: [] };
  for (const entry of entries({ runs, tasks, items })) {
    if (scope && !entryFolderIds(entry, items, byId).some(id => scope.has(id))) continue;
    view[groupOf(entry.state)].push(entry);
  }
  for (const group of ['decision', 'active', 'reviewing', 'queued', 'review', 'awaiting', 'completed', 'archived']) view[group].sort((a, b) => activityAt(b) - activityAt(a));
  return view;
}

export function folderTree(folders, parentId = null, depth = 0, seen = new Set()) {
  return folders.filter(folder => folder.parentId === parentId && !seen.has(folder.id)).sort((a, b) => a.name.localeCompare(b.name)).flatMap(folder => {
    seen.add(folder.id);
    return [{ folder, depth }, ...folderTree(folders, folder.id, depth + 1, seen)];
  });
}
