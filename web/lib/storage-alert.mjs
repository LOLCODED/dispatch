const twelveHours = 12 * 60 * 60 * 1000;

export function oldCompletedCount(view, now = Date.now()) {
  return view.completed.filter(({ latest, item }) => {
    const completedAt = Math.max(
      Date.parse(item.done?.runId === latest.id ? item.done.at : '') || 0,
      Date.parse(latest.worktreeRemovedAt) || 0,
      Date.parse(latest.finishedAt) || 0,
    );
    return completedAt > 0 && now - completedAt >= twelveHours;
  }).length;
}
