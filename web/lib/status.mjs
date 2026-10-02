const tones = {
  queued: 'waiting', preparing: 'active', implementing: 'active', validating: 'active', reviewing: 'active', repairing: 'active', publishing: 'active', landing: 'active',
  ready: 'success', planned: 'success', blocked: 'attention', budget_exceeded: 'attention', failed: 'danger', cancelled: 'muted', interrupted: 'muted',
};

export function statusTone(run) {
  if (run.supersededBy) return 'continued';
  if (run.status === 'saved') return 'saved';
  return tones[run.status] ?? 'muted';
}

export function relativeTime(value, now = Date.now()) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(at).toLocaleDateString();
}
