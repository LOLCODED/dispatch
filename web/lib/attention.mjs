import { boardView } from './board.mjs';

export const defaultVolume = 60;

export const trayLimit = 5;

export const clampVolume = value => Number.isFinite(Number(value)) && String(value).trim() !== '' ? Math.min(100, Math.max(0, Math.round(Number(value)))) : defaultVolume;

const runKey = entry => `${entry.state}:${entry.key}:${entry.latest.id}`;

export function attentionOf({ runs = [], board = {} }) {
  const { decision, review } = boardView({ runs, board });
  const asks = decision.filter(entry => entry.state === 'decision').map(runKey);
  return { count: decision.length + review.length, decisions: decision.length, asks: new Set([...asks, ...review.map(runKey)]) };
}

export function trayOf({ runs = [], board = {} }) {
  const view = boardView({ runs, board });
  return [['decision', 'Needs you'], ['review', 'Ready for review'], ['active', 'Running']]
    .map(([state, label]) => ({ state, label, total: view[state].length, entries: view[state].slice(0, trayLimit) }))
    .filter(section => section.total > 0);
}

export function attentionTitle(base, count, decisions = 0) {
  if (decisions <= 0) return count > 0 ? `(${count}) ${base}` : base;
  const reviews = count - decisions;
  return `(! ${decisions}${reviews > 0 ? ` · ${reviews}` : ''}) ${base}`;
}

export const decisionAlert = decisions => decisions === 1 ? '! Decision needed' : `! ${decisions} decisions needed`;

export function newAskKind(before, now) {
  if (before === null) return null;
  const fresh = [...now].filter(ask => !before.has(ask));
  if (fresh.some(ask => ask.startsWith('decision:'))) return 'decision';
  return fresh.length > 0 ? 'review' : null;
}

export const hasNewAsk = (before, now) => newAskKind(before, now) !== null;

export const badgedIcon = href => href.replace(/%3C\/svg%3E$/, '%3Ccircle cx=%2731%27 cy=%279%27 r=%278%27 fill=%27%23e5484d%27 stroke=%27%23171918%27 stroke-width=%272%27/%3E%3C/svg%3E');
