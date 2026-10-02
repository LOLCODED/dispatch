// The facts dispatch hands a delivery connector, and a ready-made title and Markdown description any connector may use.
const maxCheckedPaths = 500;

export function changeFacts(run, { base, pages = [], related = [] } = {}) {
  return {
    id: run.id, title: run.title, ticketId: run.ticketId, reference: run.ticket?.reference ?? null, sourceUrl: run.ticket?.sourceUrl ?? null, summary: run.summary ?? '', sqlToRun: run.sqlToRun ?? null,
    workspace: run.workspace, branch: run.branch, baseBranch: run.baseBranch, base: base ?? run.baseBranch, baseSha: run.baseSha ?? null, headSha: run.headSha ?? null, revision: run.revision ?? null,
    changedPaths: (run.changedPaths ?? []).slice(0, maxCheckedPaths), flags: run.flags ?? {}, baseMoved: run.handoff?.baseMoved ?? 0, pages, related,
    checks: (run.checks ?? []).filter(check => check.revision === run.revision).map(({ name, status, attempt, revision, command }) => ({ name, status, attempt, revision, command: command ?? null })),
    delivery: run.delivery ?? null,
  };
}

const workItem = change => typeof change.reference === 'string' && change.reference.trim() ? change.reference.trim().slice(0, 40) : null;
function changeTitle(change) {
  const reference = workItem(change), title = String(change.title ?? '').replace(/\s+/g, ' ').trim();
  return (reference ? `${reference} - ${title}` : title).slice(0, 120);
}
function summaryBullets(text) {
  const body = String(text ?? '').split(/^[#*\s]*(?:notes for next time\b|DISPATCH_BLOCKED:).*$/im)[0];
  const lines = body.split('\n').map(line => line.trim()).filter(line => line && !/^#/.test(line));
  const bullets = lines.filter(line => /^[-*•]\s+/.test(line)).map(line => line.replace(/^[-*•]\s+/, ''));
  return (bullets.length ? bullets : lines).slice(0, 4).map(line => `- ${line.slice(0, 300)}`);
}
function flagLines(change) {
  const flags = change.flags ?? {}, lines = [];
  if (flags.testsChanged?.length) lines.push(`- Test files changed: ${flags.testsChanged.join(', ')}. Review the test diff before merging.`);
  if (flags.protectedTouched?.length) lines.push(`- Protected paths touched: ${flags.protectedTouched.join(', ')}.`);
  if (flags.envChanged?.length) lines.push(`- Environment files changed: ${flags.envChanged.join(', ')}.`);
  if (flags.lockfileChanged?.length) lines.push(`- Lockfile changed: ${flags.lockfileChanged.join(', ')}.`);
  if (change.baseMoved) lines.push(`- Base moved by ${change.baseMoved} commit${change.baseMoved === 1 ? '' : 's'} since this run started; rebase before merge.`);
  return lines;
}
const maxAreas = 8, maxAreaFiles = 5, maxPages = 8;
function areaLines(paths = []) {
  const areas = new Map();
  for (const path of paths) { const cut = path.lastIndexOf('/'), area = cut < 0 ? '(repository root)' : path.slice(0, cut); areas.set(area, [...areas.get(area) ?? [], path.slice(cut + 1)]); }
  const lines = [...areas].slice(0, maxAreas).map(([area, files]) => `  - \`${area}\`: ${files.slice(0, maxAreaFiles).join(', ')}${files.length > maxAreaFiles ? ` and ${files.length - maxAreaFiles} more` : ''}`);
  return areas.size > maxAreas ? [...lines, `  - and ${areas.size - maxAreas} more folders`] : lines;
}
function whereToLook(change, pages) {
  const areas = areaLines(change.changedPaths);
  return [
    '## Where to look',
    ...(pages.length ? ['- Pages the agent opened in the browser while working:', ...pages.slice(0, maxPages).map(page => `  - \`${page}\``)] : []),
    ...(areas.length ? ['- Changed files by folder:', ...areas] : ['- No files changed.']), '',
  ];
}
const relatedLines = related => related.length ? ['', '## Related pull requests', ...related.map(item => `- ${item.url} — ${item.title}`)] : [];
function changeBody(change) {
  const { pages = [], related = [], checks = [] } = change, reference = workItem(change), flags = flagLines(change);
  const summary = summaryBullets(change.summary), passed = checks.filter(check => check.status === 'passed');
  return [
    '## Summary', ...(summary.length ? summary : ['- See the checks below.']), '',
    ...(reference ? [`Work item: ${reference}${change.sourceUrl ? ` (${change.sourceUrl})` : ''}`, ''] : []),
    ...(change.sqlToRun ? ['## SQL to run before deploy', '```sql', change.sqlToRun, '```', ''] : []),
    ...whereToLook(change, pages),
    '## Checks', `Ticket: ${change.ticketId} — ${change.title}`, `Base: ${change.baseBranch} @ ${change.baseSha}`, `Head: ${change.branch} @ ${change.headSha}`,
    ...checks.map(check => `- ${check.name}: ${check.status} (attempt ${check.attempt}, revision ${check.revision.slice(0, 12)})`), `Checks ran locally against ${change.revision}.`, '',
    '## How to test', ...passed.map((check, index) => `${index + 1}. \`${check.command?.join(' ') ?? check.name}\` passes.`), `${passed.length + 1}. Review the diff against ${change.baseBranch}.`,
    ...(pages.length ? [`${passed.length + 2}. Open the pages under Where to look and confirm they match the summary.`] : []),
    ...relatedLines(related),
    ...(flags.length ? ['', '## Flags', ...flags] : []),
  ].join('\n');
}
export function describeChange(change) {
  return { title: changeTitle(change), body: changeBody(change) };
}
