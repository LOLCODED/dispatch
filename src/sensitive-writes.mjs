import { isAbsolute, relative, resolve, sep } from 'node:path';

const approve = 'Allow', decline = 'Not now';
const pathFields = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
// Git metadata and agent settings can change isolation or the agent's own permissions, so they always need the operator.
const alwaysAsk = ['.git', '.claude'];

const allow = input => ({ behavior: 'allow', updatedInput: input });
const deny = message => ({ behavior: 'deny', message });

export function writeTarget(run, args) {
  const field = pathFields[args?.tool_name], path = field && args.input?.[field];
  if (typeof path !== 'string' || !path.trim()) return null;
  const target = resolve(run.workspace, path);
  const roots = [run.workspace, ...(run.linked ?? []).map(member => member.workspace)];
  const root = roots.find(item => { const inner = relative(item, target); return inner && !inner.startsWith('..') && !isAbsolute(inner); });
  return root ? { path: target, inner: relative(root, target) } : null;
}

export const needsOperator = ({ inner }) => inner.split(sep).some(part => alwaysAsk.includes(part));

// Answers Claude Code's permission prompts for a run: only file writes inside the task's worktrees can pass,
// either because the repository allows sensitive files or because the operator approves this path for the run.
export class SensitiveWrites {
  constructor(live) { this.live = live; }

  async call(run, args, { signal } = {}) {
    const target = writeTarget(run, args);
    if (!target) return deny('dispatch only approves file edits inside this task\'s worktrees; nobody can approve anything else during a run.');
    if ((run.sensitiveApprovals ?? []).includes(target.path)) return allow(args.input);
    if (run.project?.allowSensitiveFiles === true && !needsOperator(target)) return allow(args.input);
    const answer = await this.approval(run, target, signal);
    if (answer !== approve) return deny(`The operator did not allow writing ${target.inner}. Do not try another way to write it; continue without it or explain why it is needed.`);
    run.sensitiveApprovals = [...(run.sensitiveApprovals ?? []), target.path]; this.live.engine.store.save();
    return allow(args.input);
  }

  async approval(run, target, signal) {
    const { answers } = await this.live.interactions.request(run, { kind: 'question', source: 'tool', questions: [{ id: 'sensitive-file', header: 'Sensitive file',
      question: `The agent wants to write ${target.inner}, which Claude Code treats as a sensitive file. Allow it for this run?`,
      options: [{ label: approve, description: `Let the agent write ${target.inner} in this run's worktree.` }, { label: decline, description: 'Keep working without it.' }] }] }, signal);
    return answers?.['sensitive-file']?.answers?.[0] ?? null;
  }
}
