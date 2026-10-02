export const remainingMarker = 'DISPATCH_REMAINING:';
const start = /^[*_\s]*DISPATCH_REMAINING:[*_]*[ \t]*/m;
const end = /^\s*(?:DISPATCH_[A-Z]+\b|[#*\s]*notes for next time\b)/i;
const bullet = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/;
const nothingLeft = /^[\s*_`([]*(?:none|nothing|n\/?a|-)[\s*_`.)\]]*$/i;
const maxItems = 12, maxItemLength = 500;

export function splitRemaining(text) {
  const source = String(text ?? ''), match = source.match(start);
  if (!match) return { before: source, items: [], after: '' };
  const lines = source.slice(match.index + match[0].length).split('\n'), items = [];
  let index = 0;
  for (; index < lines.length && !end.test(lines[index]); index++) {
    const item = lines[index].replace(bullet, '').trim();
    if (item && !nothingLeft.test(item)) items.push(item.slice(0, maxItemLength));
  }
  return { before: source.slice(0, match.index).trim(), items: items.slice(0, maxItems), after: lines.slice(index).join('\n').trim() };
}

export const remainingWork = text => splitRemaining(text).items;
export const openRemaining = run => run?.status === 'ready' && !run.supersededBy && Boolean(run.remaining?.items?.length) && !run.remaining.resolution;

export function remainingTaskInput(run) {
  return [`Build the work left over from "${run.title}":`, ...run.remaining.items.map(item => `- ${item}`), '', run.branch ? `That task's tested changes are on branch ${run.branch}; land them first if this work builds on them.` : `That task's tested changes are in ${run.workspace}.`].join('\n');
}
