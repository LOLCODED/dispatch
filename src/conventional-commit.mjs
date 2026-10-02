export const commitTypes = { feat: 'Features', fix: 'Fixes', perf: 'Performance', refactor: 'Refactoring', docs: 'Documentation', test: 'Tests', build: 'Build', ci: 'Build', style: 'Style', chore: 'Chores', revert: 'Reverts' };
export const miscellaneous = 'Miscellaneous';

const subjectPattern = /^([a-z]+)(?:\(([^()\n]{1,40})\))?(!)?: (\S.*)$/;
const legacyPrefix = /^(?:TASK-[0-9a-f]{8}|[A-Z][A-Z0-9]*-\d+):\s*/;
const commitLine = /^[ \t>*_`]*DISPATCH_COMMIT:[ \t]*(.*?)[ \t`*_]*$/gm;
const maxSubject = 120;

export function parseSubject(subject) {
  const text = String(subject ?? '').trim().replace(legacyPrefix, '');
  const match = text.match(subjectPattern);
  if (!match || !commitTypes[match[1]]) return { type: null, scope: null, breaking: false, description: text };
  return { type: match[1], scope: match[2]?.trim() || null, breaking: Boolean(match[3]), description: match[4].trim() };
}

export function commitSubject(summary) {
  const lines = [...String(summary ?? '').matchAll(commitLine)].map(match => match[1].trim());
  const subject = lines.at(-1);
  return subject && subject.length <= maxSubject && parseSubject(subject).type ? subject : null;
}

export const withoutCommitLine = summary => String(summary ?? '').replace(commitLine, '').replace(/\n{3,}/g, '\n\n').trim();

export function commitMessage(run) {
  const subject = run.commitSubject ?? run.title.split('\n')[0].slice(0, maxSubject);
  return run.ticket?.id ? `${subject}\n\nRefs: ${run.ticketId}` : subject;
}
