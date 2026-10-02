export const purgeScopes = ['worktrees', 'tasks'];
export const purgeAges = [0, 1, 7, 30];

const dayMs = 86400000;

export function purgeTargets(tasks, { scope, olderThanDays = 0 }, now = Date.now()) {
  const cutoff = now - olderThanDays * dayMs;
  return tasks.filter(task => task.finished && (Date.parse(task.lastActivityAt) || 0) <= cutoff && (scope === 'tasks' || task.worktree));
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit++; }
  return `${unit === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
