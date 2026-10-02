export const terminal = new Set(['planned', 'ready', 'blocked', 'budget_exceeded', 'failed', 'cancelled', 'interrupted']);
export const maxConcurrency = 4;
export const labels = { planned: 'Plan ready', queued: 'Queued', preparing: 'Preparing', implementing: 'Implementing', reviewing: 'Reviewing changes', validating: 'Validating', repairing: 'Repairing', publishing: 'Preparing handoff', landing: 'Landing', ready: 'Ready for review', blocked: 'Needs decision', budget_exceeded: 'Budget reached', failed: 'Needs attention', cancelled: 'Cancelled', interrupted: 'Interrupted' };
