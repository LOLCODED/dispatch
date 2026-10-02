export const layoutModes = ['default', 'vibe', 'technical'];

const policies = {
  default: { order: ['chat', 'diff', 'checks', 'browser'], open: ['chat'], ratio: 0.56, diff: 'ready', browser: 'take', handBack: true, keepBrowser: false, question: 'chat', activity: true, games: false },
  vibe: { order: ['browser', 'chat', 'games', 'checks', 'diff'], open: ['chat', 'games'], ratio: 0.6, diff: 'manual', browser: 'gentle', handBack: false, keepBrowser: true, question: 'bar', activity: false, games: true },
  technical: { order: ['diff', 'chat', 'browser', 'checks'], open: ['chat'], ratio: 0.58, diff: 'changes', browser: 'stack', handBack: false, keepBrowser: false, question: 'chat', activity: true, games: false },
};

export const managedTiles = ['diff', 'browser'];
export const layoutPolicy = mode => policies[mode] ?? policies.default;

export function relevantTiles(policy, { canDiff, hasChanges, checks, driving, browsed }) {
  const relevant = { chat: true, diff: policy.diff === 'manual' ? canDiff : hasChanges, checks, browser: driving || (policy.keepBrowser && browsed), games: policy.games };
  return policy.order.filter(tile => relevant[tile]);
}

export const diffWanted = (policy, status, hasChanges) => hasChanges && (policy.diff === 'changes' || (policy.diff === 'ready' && status === 'ready'));

// Each automation event maps to tile actions, so the run page and the settings preview cannot disagree.
export function layoutReaction(policy, event, { full = null, busy = false } = {}) {
  if (event === 'diff') return policy.diff === 'changes' ? [['focus', 'diff']] : policy.diff === 'ready' ? [['open', 'diff']] : [];
  if (event === 'browse') return policy.browser === 'stack' || (policy.browser === 'gentle' && (full || busy)) ? [['open', 'browser']] : [['full', 'browser']];
  if (event === 'said') return policy.handBack && full === 'browser' ? [['exitFull'], ['show', 'chat']] : [];
  if (event === 'question') return policy.question === 'bar' ? [] : [...(full && full !== 'chat' ? [['exitFull']] : []), ['show', 'chat']];
  if (event === 'browsed') return policy.keepBrowser ? [] : [...(full === 'browser' ? [['exitFull']] : []), ['close', 'browser']];
  return [];
}

export const previewSteps = ['Working', 'Writes code', 'Drives the browser', 'Replies', 'Asks a question', 'Keeps going', 'Ready to review'];
const stepEvents = [[], [], ['browse'], ['said'], ['browsed', 'question'], [], ['diff']];
const technicalDiffStep = 1;

function applyPreview(state, [action, tile]) {
  const open = new Set(state.open);
  if (action === 'focus') return { ...state, order: [tile, ...state.order.filter(item => item !== tile)], open: [...open.add(tile)] };
  if (action === 'open') return { ...state, open: [...open.add(tile)] };
  if (action === 'full') return { ...state, full: tile, open: [...open.add(tile)] };
  if (action === 'exitFull') return { ...state, full: null };
  if (action === 'show') return { ...state, full: state.full ? tile : null, open: [...open.add(tile)] };
  open.delete(tile);
  return { ...state, open: [...open], full: state.full === tile ? null : state.full };
}

// A scripted run for the settings preview: which tiles show, which fills the run area, and whether the answer bar is up.
export function previewLayout(mode, step) {
  const policy = layoutPolicy(mode);
  let state = { order: policy.order, open: policy.open, full: null };
  for (let index = 0; index <= step; index++) {
    const events = index === technicalDiffStep && policy.diff === 'changes' ? ['diff'] : stepEvents[index];
    for (const event of events) for (const action of layoutReaction(policy, event, { full: state.full })) state = applyPreview(state, action);
  }
  const available = relevantTiles(policy, { canDiff: true, hasChanges: step >= 1, checks: step >= 6, driving: step === 2 || step === 3, browsed: step >= 2 });
  const visible = state.full && available.includes(state.full) ? [state.full] : state.order.filter(tile => available.includes(tile) && state.open.includes(tile));
  return { visible: visible.length ? visible : ['chat'], available, ratio: policy.ratio, bar: step === 4 && policy.question === 'bar', asking: step === 4 };
}
