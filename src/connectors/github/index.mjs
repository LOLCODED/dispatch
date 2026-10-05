import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PUSH_TIMEOUT_MS = 120_000, GH_TIMEOUT_MS = 30_000;
const transientPush = /could not read from remote|unable to access|connection (?:reset|refused|timed out)|early eof|remote end hung up/i;
const pullRequestFields = 'number,url,state,headRefOid,baseRefName,reviewDecision,mergeable,latestReviews';
const failed = result => result.exitCode !== 0 || result.timedOut || result.cancelled;
const failure = (kind, message, transient = false) => Object.assign(new Error(message), { kind, transient });

function ghFailure(step, result) {
  if (result.cancelled) return failure('cancelled', 'Delivery cancelled.');
  if (result.timedOut) return failure('timeout', `GitHub CLI timed out during ${step}.`);
  const output = result.output ?? '';
  if (/\bENOENT\b/.test(output)) return failure('unavailable', 'GitHub CLI (gh) is not installed.');
  if (/rate limit|HTTP 403|HTTP 429/i.test(output)) return failure('rate-limited', 'GitHub refused the request (rate limit or forbidden). Refresh delivery later.');
  if (/not logged in|gh auth login|authentication required|HTTP 401/i.test(output)) return failure('unauthenticated', 'GitHub CLI is not logged in. Run gh auth login.');
  return failure('failed', `GitHub CLI ${step} failed: ${output.trim().slice(-500)}`);
}

function pushFailure(error) {
  const result = error.result ?? {}, output = result.output ?? error.message ?? '';
  if (result.cancelled) return failure('cancelled', 'Push cancelled.');
  if (result.timedOut) return failure('timeout', 'Push timed out after 120 s. No retry was attempted.');
  if (/\[rejected\]|\[remote rejected\]|non-fast-forward/i.test(output)) return failure('rejected', `Push rejected by the remote: ${output.trim().slice(-500)}`);
  if (/\bENOENT\b/.test(output)) return failure('unavailable', 'Git is not installed.');
  return failure('failed', `Push failed: ${output.trim().slice(-500)}`, transientPush.test(output));
}

function parseJson(output, message) {
  try { return JSON.parse(output); } catch { throw failure('failed', message); }
}

const latestChangeRequest = reviews => (Array.isArray(reviews) ? reviews : []).filter(review => review?.state === 'CHANGES_REQUESTED' && review.submittedAt).map(review => review.submittedAt).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) ?? null;

export function pullRequestFromList(list) {
  const found = list.find(pr => pr.state === 'OPEN') ?? list[0];
  return found ? { number: found.number ?? null, url: found.url ?? null, state: found.state ?? 'UNKNOWN', headRefOid: found.headRefOid ?? null, reused: true, baseRefName: found.baseRefName ?? null, reviewDecision: found.reviewDecision || null, mergeable: found.mergeable ?? null, changesRequestedAt: latestChangeRequest(found.latestReviews) } : null;
}

const reviewItems = parsed => Array.isArray(parsed) ? parsed.filter(item => typeof item?.body === 'string' && item.body.trim()) : [];
const ansiEscape = /\x1b\[[0-9;]*[A-Za-z]/g, actionsTimestamp = /^\d{4}-\d\d-\d\dT[\d:.]+Z /gm;

// An Actions job log ends in post-job cleanup; the failure is at its last ##[error] line.
export function actionsLog(text) {
  const clean = String(text).replace(ansiEscape, '').replace(actionsTimestamp, '');
  const error = clean.lastIndexOf('##[error]');
  return error < 0 ? clean : clean.slice(0, clean.indexOf('\n', error) + 1 || undefined);
}

const checkRun = check => ({ id: Number.isSafeInteger(check?.id) ? check.id : null, app: typeof check?.app === 'string' ? check.app : null, name: String(check?.name ?? ''), status: check?.status ?? null, conclusion: check?.conclusion ?? null });

export function createGithub({ runProcess, localEnvironment, git, describeChange }) {
  const gh = (args, { cwd, signal } = {}) => {
    const extra = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_PAGER: 'cat', ...(process.env.GH_CONFIG_DIR ? { GH_CONFIG_DIR: process.env.GH_CONFIG_DIR } : {}) };
    return runProcess('gh', args, { cwd, signal, inheritEnv: false, env: localEnvironment(extra), timeoutMs: GH_TIMEOUT_MS, maxOutput: 200_000 });
  };
  const ghText = async (step, args, options) => {
    const result = await gh(args, options);
    if (failed(result)) throw ghFailure(step, result);
    return result.output;
  };
  // gh refuses output with terminal escapes, which Actions logs always have, unless allowed; versions without the check reject the flag.
  const jobLog = async (path, options) => {
    const allowed = await gh(['api', path, '--allow-escape-sequences'], options);
    const result = failed(allowed) && /unknown flag/.test(allowed.output ?? '') ? await gh(['api', path], options) : allowed;
    if (failed(result)) throw ghFailure('checks', result);
    return actionsLog(result.output);
  };
  const withBody = async (body, use) => {
    const directory = mkdtempSync(join(tmpdir(), 'dispatch-pr-'));
    try { const file = join(directory, 'body.md'); writeFileSync(file, body, { mode: 0o600 }); return await use(file); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  };
  const repository = async (change, ctx) => {
    const remote = change.delivery?.remote ?? ctx.settings.remote, cached = ctx.memory.repository;
    if (cached?.remote === remote && cached.nameWithOwner) return cached.nameWithOwner;
    const remoteUrl = await git(change.workspace, ['remote', 'get-url', remote], { signal: ctx.signal, timeoutMs: GH_TIMEOUT_MS });
    const name = (await ghText('checks', ['repo', 'view', remoteUrl, '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { cwd: change.workspace, signal: ctx.signal })).trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(name)) throw failure('failed', 'Could not determine the GitHub repository for this remote.');
    ctx.remember({ repository: { remote, nameWithOwner: name } });
    return name;
  };
  const options = (change, ctx) => ({ cwd: change.workspace, signal: ctx.signal });

  async function push(change, ctx) {
    const remote = ctx.settings.remote;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { await git(change.workspace, ['push', remote, `HEAD:refs/heads/${change.branch}`], { signal: ctx.signal, timeoutMs: PUSH_TIMEOUT_MS }); return { remote }; }
      catch (error) { const reason = pushFailure(error); if (!reason.transient || attempt === 2 || ctx.signal?.aborted) throw reason; }
    }
  }
  async function findPullRequest(change, ctx) {
    const list = parseJson(await ghText('pull request', ['pr', 'list', '--head', change.branch, '--state', 'all', '--json', pullRequestFields], options(change, ctx)), 'GitHub CLI returned an invalid pull request list.');
    if (!Array.isArray(list)) throw failure('failed', 'GitHub CLI returned an invalid pull request list.');
    return pullRequestFromList(list);
  }
  function openPullRequest(change, ctx) {
    const { title, body } = describeChange(change);
    return withBody(body, async file => {
      // A title beginning with "-" would otherwise be parsed by gh as a flag.
      const args = ['pr', 'create', ...(ctx.settings.draft === false ? [] : ['--draft']), '--head', change.branch, '--base', change.base, `--title=${title}`, '--body-file', file];
      const url = (await ghText('pull request', args, options(change, ctx))).trim().split('\n').find(line => /^https:\/\//.test(line)) ?? null;
      const number = Number(url?.match(/\/pull\/(\d+)$/)?.[1]);
      return { number: Number.isInteger(number) ? number : null, url, state: 'OPEN', headRefOid: change.headSha, reused: false };
    });
  }
  async function describe(change, ctx) {
    await withBody(describeChange(change).body, file => ghText('pull request', ['pr', 'edit', change.delivery.pr.url, '--body-file', file], options(change, ctx)));
  }
  async function checks(change, ctx) {
    const nameWithOwner = await repository(change, ctx), jq = '{total: .total_count, checks: [.check_runs[] | {id: .id, app: .app.slug, name: .name, status: .status, conclusion: .conclusion}]}';
    const parsed = parseJson(await ghText('checks', ['api', `repos/${nameWithOwner}/commits/${change.delivery.headSha}/check-runs`, '--jq', jq], options(change, ctx)), 'GitHub returned invalid check-run data.');
    return Array.isArray(parsed?.checks) ? parsed.checks.map(checkRun) : [];
  }
  async function checkLogs(change, failing, ctx) {
    const nameWithOwner = await repository(change, ctx);
    const log = check => {
      if (!check.id) return 'No check-run id; open the check on GitHub.';
      if (check.app === 'github-actions') return jobLog(`repos/${nameWithOwner}/actions/jobs/${check.id}/logs`, options(change, ctx));
      return ghText('checks', ['api', `repos/${nameWithOwner}/check-runs/${check.id}`, '--jq', '[.output.title, .output.summary, .output.text] | map(select(. != null)) | join("\n")'], options(change, ctx));
    };
    return Promise.all(failing.map(async check => {
      try { return { name: check.name, conclusion: check.conclusion, log: await log(check) }; }
      catch (error) { return { name: check.name, conclusion: check.conclusion, log: `Log unavailable: ${error.message}` }; }
    }));
  }
  async function reviews(change, ctx) {
    const nameWithOwner = await repository(change, ctx), number = change.delivery.pr.number;
    const read = async (path, jq) => reviewItems(parseJson(await ghText('review', ['api', `repos/${nameWithOwner}/pulls/${number}/${path}?per_page=100`, '--jq', jq], options(change, ctx)), 'GitHub returned invalid review data.'));
    const written = await read('reviews', '[.[] | {author: .user.login, state: .state, body: .body, at: .submitted_at}]');
    const comments = await read('comments', '[.[] | {author: .user.login, path: .path, line: (.line // .original_line), body: .body, at: .created_at}]');
    return [...written.filter(review => review.state !== 'APPROVED'), ...comments];
  }
  async function status() {
    const version = await gh(['--version']);
    if (failed(version)) return { available: false, authenticated: false, detail: 'Install the GitHub CLI (gh), then run gh auth login.' };
    const authenticated = !failed(await gh(['auth', 'status']));
    return { available: true, authenticated, version: version.output.split('\n')[0].trim(), detail: authenticated ? 'GitHub CLI installed and logged in.' : 'GitHub CLI installed but not logged in. Run gh auth login.' };
  }

  return {
    // The GitHub mark from Simple Icons (CC0).
    icon: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
    id: 'github', name: 'GitHub', description: 'Pushes the tested branch, opens pull requests and reads their checks and reviews through the GitHub CLI (gh) and its login.',
    status,
    settings: {
      remote: { label: 'Git remote', description: 'The remote dispatch pushes task branches to.', type: 'string', default: 'origin', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' },
      draft: { label: 'Open as draft', type: 'boolean', default: true },
    },
    actions: {
      push: { label: 'Push task branches', description: 'Push the tested branch to the remote. Never force-pushes or pushes the base branch.', access: 'write', hooks: { 'delivery.push': push } },
      openPullRequest: { label: 'Open pull requests', description: 'Open a pull request for the pushed branch and keep its description up to date. Never merges.', access: 'write', hooks: { 'delivery.openPullRequest': openPullRequest, 'delivery.describe': describe } },
      readPullRequests: { label: 'Read pull requests', description: 'Find the branch’s pull request, its state and review comments.', access: 'read', hooks: { 'delivery.findPullRequest': findPullRequest, 'delivery.reviews': reviews } },
      readChecks: { label: 'Read CI checks', description: 'Read check runs and failing logs for the pushed commit.', access: 'read', hooks: { 'delivery.checks': checks, 'delivery.checkLogs': checkLogs } },
    },
  };
}

export default createGithub;
