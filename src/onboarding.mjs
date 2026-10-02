export const setupNeeded = state => !state.setupCompletedAt && !state.projects?.length && !state.runs?.length && !state.tasks?.length;

export function completeSetup(store, now = new Date()) {
  store.state.setupCompletedAt ??= now.toISOString();
  store.save();
  return { setupCompletedAt: store.state.setupCompletedAt };
}
