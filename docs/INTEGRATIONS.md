# Local integrations

Built-in integrations use an installed CLI and its own login. dispatch copies no credentials. What is live-verified versus tested with doubles is listed in the README's [Status](../README.md#status) section.

## Codex

On by default. Run `codex login` in your terminal. Settings checks `codex --version` and `codex login status` without a model call. Owner turns use `codex app-server` with explicit thread start/resume, streamed activity and native questions, in a workspace-write sandbox with escalation declined. Optional independent review uses a separate read-only `codex exec --json` session; verdicts bind to the checked revision and findings return to the owner within the shared repair allowance. Model discovery reads `model/list` without starting a turn.

The adapter normalizes messages, tool progress, usage and outcomes. Raw events are kept in bounded local JSONL logs after token redaction. The CLI version is recorded per run; rerun `npm run live:smoke` after upgrading. See [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) and [authentication](https://learn.chatgpt.com/docs/auth). The adapter pattern was informed by [Paperclip's Codex adapter](https://docs.paperclip.ing/reference/adapters/codex/); dispatch does not copy its managed credential homes or remote execution.

## Claude Code

Off until enabled under **Settings → Integrations → Providers**. Run `claude auth login`. Owner turns run `claude -p --output-format stream-json` with `--session-id`/`--resume`, `--permission-mode acceptEdits`, Claude Code's bash sandbox (`allowUnsandboxedCommands: false`). Permission prompts go to dispatch's `dispatch_permission` tool (`--permission-prompts host --permission-prompt-tool`). While the run is sandboxed (home access), it approves shell commands Claude Code asks about because it cannot parse them (inline variables, compound commands); a request to run a command outside the sandbox is refused with a message telling the agent to ask the operator instead of retrying. It approves writes inside the task's worktrees to files Claude Code treats as sensitive (such as `.npmrc`) after asking the operator, unless the repository allows sensitive files. It refuses every other prompt. Files under `.git` or `.claude` always ask. This routing is tested with doubles only. Review turns use `dontAsk` and deny `Bash`, `Edit`, `Write` and `NotebookEdit`. Native `AskUserQuestion`, subagents and web tools are disabled. Questions go through `dispatch_question`, served by a Node-built-ins MCP stdio server that reaches dispatch over a per-turn Unix socket with a random token. Models are Claude Code's documented aliases. Auto runs through dispatch are live-verified; questions and review over MCP are tested with doubles only.

## Connectors

Everything dispatch does outside your machine goes through a connector: reading tickets, commenting on them, pushing branches, opening pull requests, reading CI, reacting to run events, and giving the agent tools for local services such as Docker. dispatch's core names no connector. Connectors ship as folders and load through one loader:

- **Built in:** every folder under `src/connectors/<name>/` with a `package.json` is loaded at startup. GitHub (`src/connectors/github/`) is the only one today and is the reference implementation. Delete the folder and dispatch still runs, with no delivery connector.
- **Added by you:** `dispatch connector add <folder>`, `dispatch connector list` and `dispatch connector remove <id>`, or **Settings › Connectors**.

Nothing a connector can do runs until you allow it (see [Permissions](#permissions)). The full contract is under [Writing a connector](#writing-a-connector).

### PostgreSQL

Built in. Implements `database.query` with `psql` (install the PostgreSQL client): a read-only session with a 15-second statement limit, reading the connection from the variable set in its settings (`DATABASE_URL` by default). Its **Give each task its own database** action (a write, off until a repository turns it on) clones the development database on the same server: `CREATE DATABASE … TEMPLATE` when nothing else is connected to it, otherwise `pg_dump` and `pg_restore`, and drops the clone with the worktree. It is the default engine while it is the only query connector loaded; another engine (MySQL, SQL Server, …) is a connector with its own `database.query`, or the repository's own **Commands** under **Extras → Database**. Tested with doubles only.

### GitHub

Uses your `gh` login (`gh auth login`). Its actions are **Push task branches** and **Open pull requests** (writes, off by default) and **Read pull requests** and **Read CI checks** (reads, on by default). Per repository it has a **Git remote** (default `origin`) and **Open as draft** (default on). After `ready`, a repository that uses GitHub with pushing on gets `HEAD:refs/heads/<branch>` pushed (never forced, never the base branch), the branch's pull request reused or a new one opened, and check runs read for the exact pushed SHA. Delivery errors are recorded on the run; the status stays `ready`. Tested with doubles and `node src/connectors/github/smoke.mjs` (local bare remote, `gh` shim); not yet run against GitHub. See [its README](../src/connectors/github/README.md).

## dispatch tools over MCP

The per-turn MCP server (`src/mcp-server.mjs`, Node built-ins) advertises only the tools dispatch attached (`DISPATCH_TOOL_NAMES`). Claude receives it through `--mcp-config` and an allow list of `mcp__dispatch__<tool>`; Codex through `-c mcp_servers.dispatch.command/args/env/tool_timeout_sec/default_tools_approval_mode` on both `app-server` and `exec`; the tools are pre-approved because Codex otherwise rejects MCP calls under approval policy `never`. Both are live-verified. Claude also loads the user's own MCP servers (the live run showed the claude.ai connectors next to `dispatch`); whether their tools are callable or cost context in worker turns has not been measured. The server name `dispatch` is reserved; a user server of the same name would clash. The dispatch browser needs no extra CLI: Chromium comes from the Playwright already installed for checks.


## Writing a connector

A connector is a folder. Its `package.json` may name the entry module with `"dispatch": { "connector": "./index.mjs" }`; without it dispatch loads `index.mjs`. The entry must stay inside the folder. GitHub's folder is the complete example: [`src/connectors/github/`](../src/connectors/github/). A ticket tracker connector can live in a repository of its own and be added with `dispatch connector add`.

### Adding and removing

```sh
dispatch connector add ~/code/my-connector   # validates and loads it
dispatch connector list
dispatch connector remove <id>
```

Or **Settings › Connectors**, or over HTTP: `GET /api/connectors/plugins`, `POST /api/connectors/plugins` with `{"path": "<absolute folder>"}`, and `POST /api/connectors/plugins/:id/remove`. Adding or removing takes effect without a restart; after editing a connector's code, restart dispatch to load the new version. A folder that fails to load is reported in the list and in the server log, and dispatch starts without it. Built-in connectors cannot be removed this way; delete their folder instead.

A connector runs inside the dispatch server with your user's permissions. Only add code you trust.

### What a connector receives

The module's default export is `createConnector(dispatch)`. The `dispatch` object is everything a connector gets from dispatch; a connector imports nothing else from it.

| Member | What it is |
|---|---|
| `contractVersion` | `1` |
| `runProcess(command, args, { cwd, env, inheritEnv, timeoutMs, signal, maxOutput })` | Runs a process without a shell → `{ exitCode, output, timedOut, cancelled }` |
| `localEnvironment(extra)` | A minimal environment (`PATH`, `HOME`, locale and similar) merged with `extra` |
| `git(cwd, args, { signal, timeoutMs })` | Runs Git with hooks off; resolves to its trimmed output, throws with `error.result` on failure |
| `plainText(html)` | HTML to plain text |
| `describeChange(change)` | `{ title, body }`: dispatch's title and Markdown description of a tested change (summary, work item, SQL to run, where to look, checks, how to test, flags). Optional; use it or write your own |

### What a connector returns

```js
export default function createConnector(dispatch) {
  return {
    id: 'acme',                 // 2–31 lowercase letters or digits, starting with a letter; not "text" or "dispatch"
    name: 'Acme',
    description: 'Shown in Settings and repository settings.',      // optional
    icon: 'M12 2 2 22h20z',     // optional: SVG path data for a 24 × 24 view box, filled with the accent colour
    status: async () => ({ available: true, authenticated: true, detail: 'Logged in.', version: '1.2' }), // optional
    settings: {                 // optional, per repository
      site: { label: 'Site', description: 'Your Acme address.', type: 'string', default: 'acme.example', pattern: '^[a-z.]+$' },
    },
    actions: {
      read: { label: 'Read tickets', description: 'Turn a pasted Acme link into the task.', access: 'read', hooks: { 'ticket.detect': detect, 'ticket.read': read } },
      comment: { label: 'Comment results', access: 'write', hooks: { 'ticket.comment': comment } },
    },
  };
}
```

`actions` is required and is what you see when you open a connector in **Settings › Connectors**: one switch per action. An action has `hooks`, [agent `tools`](#agent-tools), or both. Each hook and tool belongs to exactly one action, and dispatch calls a hook only while its action is permitted. Group hooks so each switch means one thing a user might want to refuse. `status()` is asked only once the connector is turned on in Settings or used by a repository, and has 15 seconds to answer; a missing `authenticated` counts as `available`.

Pairs that must come together: `ticket.detect` with `ticket.read`; `ticket.states` with `ticket.setState`; `delivery.openPullRequest` needs `delivery.push`. dispatch rejects a connector that breaks a rule, names an unknown hook, or puts one hook in two actions.

A setting can add `secret: true` (a token, a password): dispatch stores it like any other but never reads it back through the settings API, the CLI or a task.

### Database options

A connector that reaches databases can declare `databaseOptions`, shaped like `settings`. A repository then sets them for each of its databases (**Extras → Databases**), so one connector can serve several, for example a staging and a production database in different vaults, and hooks read them as `ctx.database.options`.

### Permissions

Each action resolves, in order: the repository's own switch (Repositories › a repository › Extras), the global switch (Settings › Connectors › the connector), then the default: **read actions on, write actions off**. A repository stores its own switch only while it differs from the global one, so changing the global default reaches every repository that has not overridden it.

Separately, a repository chooses which connectors it **uses**. Everything automatic needs both: reading a pasted link, delivering after `ready`, commenting the result, offering a state move, run events, and agent tools. A button the operator presses (**Open pull request**, or a choice on the state-move offer) needs only the action permitted. A repository uses at most one connector that pushes branches, and a plain folder (no Git) uses none.

Per repository the saved shape is `connectors.<id> = { enabled, actions: { <action>: true|false }, settings: { ... } }`; `POST /api/projects/:id/connectors` merges `{ "<id>": { enabled, actions, settings } }`, where `null` resets an action or setting to its default. Global switches are `POST /api/connectors` with `{ id, enabled?, actions? }`, and `GET /api/connectors` lists every connector with its actions and settings.

### Hooks

Every hook receives its arguments and then a context, `ctx`:

| `ctx` member | |
|---|---|
| `signal` | Aborted when the run is cancelled |
| `settings` | This repository's settings for the connector, with defaults filled in |
| `memory` | What the connector remembered for this repository |
| `remember(values)` | Merges `values` into that memory (kept outside the repository) |
| `workspace` | Agent tools only: the run's worktree, for reading files the agent wrote there |

Each call has 60 seconds. A hook that throws is reported on the run; throw an `Error` with a message a person can act on, optionally with `error.kind` (for example `unauthenticated`, `rate-limited`, `rejected`) and `error.transient`.

#### Tickets

| Hook | Returns |
|---|---|
| `ticket.detect(input, { memory })` | A reference `{ id, sourceUrl?, organization?, project? }` when the pasted text is yours, else `null`. Synchronous, no I/O. Throw for a link that is yours but malformed. `memory` lets a bare id such as `PROJ-12` resolve after a first link. If you match a link inside prose, dispatch passes the whole typed text to the agent as an operator note beside the ticket you read. |
| `database.url(ctx)` | (`ctx.database` names the database and carries its options.) A connection string for the repository's development database, for example read from a secret store using `ctx.settings`. Used when the repository picks this connector as its database connection; it becomes the connection variable the engine reads, and is never shown to the agent or the operator. |
| `database.connect({ run, workspace }, ctx)` | Opens a connection that needs setup, such as a tunnel through a bastion host, and returns `{ env }` with the variables the engine connects with. `ctx.database` is `{ name, options }`: the repository's name for this database and the options the connector declared in `databaseOptions` (for example a Key Vault and a jump host per environment). Called before the first query of a run; the connector keeps whatever it opened until `database.disconnect`. Takes precedence over `database.url`. |
| `database.disconnect({ run }, ctx)` | Closes what `database.connect` opened for that run and database; called when the run's turn ends. |
| `database.provision({ task, env, workspace }, ctx)` | Creates a database for one task and returns `{ env }`, the variables its processes should use (for example `{ DATABASE_URL: '…/dispatch_task_ab12' }`). `task` is `{ id, name }`, stable across the task's follow-ups; `env` holds the development database's connection to copy from. Called when the task's worktree is created and on `dispatch_database reset`; it may be called again for the same task, so replace what exists. The returned variables are kept in a private file, never in run state. |
| `database.release({ task, env, workspace }, ctx)` | Removes the task's database; `env` is what provision returned. Called when the worktree is removed, and for a task whose worktree disappeared (a crash) the next time that repository creates one. |
| `database.snapshot({ task, env, workspace }, ctx)` | `{ snapshot }`: any JSON value (at most 16 MB) describing the task database's current state; comes with `database.changes`. dispatch keeps it in a private file beside the task database's variables, never in run state, and deletes it with the worktree. Called only for a task's own database, never a shared one: when it is created or reset, when the agent starts a service with `dispatch_service`, and on `dispatch_database snapshot`. Put it in a **read** action so the operator can switch it off. |
| `database.changes({ task, env, workspace, snapshot }, ctx)` | `{ tables: [{ name, inserted, updated, deleted, columns, key, rows, columnsAdded?, columnsRemoved?, countOnly?, created?, dropped? }] }`: what changed since `snapshot`, one entry per changed table. `rows` is a sample of `{ change: 'inserted' \| 'updated' \| 'deleted', cells, before? }` in `columns` order; `before` holds an updated row's earlier cells. The simplest way is to keep each table as `{ name, columns, key, rows }` (or `{ name, count }` when it is too large) in the snapshot, read the same now, and return `dispatch.tableChanges(snapshot.tables, current)`. Called on `dispatch_database changes` and when a service started with a snapshot stops. |
| `database.query({ sql, env, workspace }, ctx)` | Runs one query for `dispatch_sql` and returns `{ columns, rows }` (cells are strings or `null`). `env` holds the connection variables (from the env file, a `database.url` connector or the task's own database); connect with them and keep the session read-only where the engine allows. Throw an `Error` with the database's message on failure. dispatch redacts connection values from rows and errors and shows the rows as a table. |
| `ticket.read(ref, ctx)` | The ticket: `title` (required), `description`, `acceptance`, and optionally `key` (duplicate-run identity; default `<id>:<ref.id>`), `reference` (for example `PROJ-12`; prefixes the pull request title), `revision`, `type`, `state`, `branch` (a branch name or template using `{type} {ticketId} {id} {run} {slug}`, used when the operator has no `branch.template` preference and offered first when dispatch asks; an invalid one is ignored; put it behind a setting, since `dispatch/<run>` is the default), and `remember: { ... }`, stored as this repository's memory |
| `ticket.revision(ref, ctx)` | The ticket's current revision number; lets the comment say the ticket changed since intake |
| `ticket.comment(ref, text, ctx)` | Nothing. Posts dispatch's one result comment for a ready run (outcome, branch, pull request, checks, state move) |
| `ticket.states(ref, ticket, ctx)` | Allowed state names, offered on the verdict after a pull request opens |
| `ticket.setState(ref, state, { expectedRevision }, ctx)` | `{ moved, changed, rev }`. Return `{ moved: false, changed: true, rev }` without writing when the ticket moved past `expectedRevision`; dispatch then asks before forcing it, and offers undo after a move |

Ticket text is shown as text and never executed.

#### Delivery

Delivery hooks receive `change`, the facts of one tested change: `id`, `title`, `ticketId`, `reference`, `sourceUrl`, `summary` (the worker's closing summary), `sqlToRun`, `workspace`, `branch`, `baseBranch`, `base` (the target chosen for this pull request), `baseSha`, `headSha`, `revision`, `changedPaths`, `flags`, `baseMoved`, `pages` (app pages the agent opened), `related` (`[{ url, title }]` pull requests opened with it), `checks` (`[{ name, status, attempt, revision, command }]` at the tested revision) and `delivery` (the run's delivery record so far). It never carries ticket text or the agent's prompt.

| Hook | Returns |
|---|---|
| `delivery.push(change, ctx)` | `{ remote? }` after pushing `change.branch`. dispatch has already refused the base branch and an untested head |
| `delivery.findPullRequest(change, ctx)` | The branch's existing pull request, or `null` |
| `delivery.openPullRequest(change, ctx)` | The new pull request |
| `delivery.describe(change, ctx)` | Nothing; rewrites the open pull request's description (used to link related pull requests) |
| `delivery.checks(change, ctx)` | `[{ name, status, conclusion, id?, app? }]` for `change.delivery.headSha`. The agent's `dispatch_ci` tool also calls it, with `headSha` set to the task's last pushed commit or the base branch head. |
| `delivery.checkLogs(change, failing, ctx)` | `[{ name, conclusion, log }]` for the failing checks (at most three); dispatch bounds them into one repair prompt |
| `delivery.reviews(change, ctx)` | `[{ author, body, at, path?, line?, state? }]`; dispatch keeps items written after the push and turns them into one follow-up |

A pull request is `{ number, url, state, headRefOid?, reused?, baseRefName?, reviewDecision?, mergeable?, changesRequestedAt? }`, in this vocabulary: `state` is `OPEN`, `MERGED` or `CLOSED`; `mergeable: 'CONFLICTING'` means conflicts; `reviewDecision: 'CHANGES_REQUESTED'` with a `changesRequestedAt` after the push means changes were asked for; set `reused: true` on one you found rather than opened. A check is finished when `status` is `completed`; conclusions `success`, `neutral` and `skipped` pass, and `failure`, `cancelled`, `timed_out`, `action_required` and `startup_failure` fail. dispatch records each step's error on the run (`push`, `pr`, `ci`, `review`) and the tested local commit stays valid.

#### Run events

`run.ready` (after delivery, so it carries the pull request link), `run.blocked`, `run.failed` and `run.cancelled` receive one read-only summary:

```js
{ event: 'run.ready', at, message,
  run: { id, title, status, kind, url, repository: { id, name }, branch, baseBranch, headSha,
         ticket: { id, reference, sourceUrl, tracker }, pullRequest, question, checks: [{ name, status }] } }
```

`url` links to the run page. Events are fire-and-forget: dispatch does not wait for them, and an error is logged on the run without changing it.

#### Agent tools

An action can give the agent tools for the length of a turn, for services its sandbox cannot reach (Claude Code's and Codex's sandboxes block, for example, the Docker socket):

```js
actions: {
  inspect: { label: 'Inspect containers', access: 'read', tools: {
    logs: { description: 'Recent logs of an allowed container.', inputSchema: { type: 'object', properties: { container: { type: 'string' } }, additionalProperties: false }, run: async (args, ctx) => ({ output: '…' }) },
  } },
}
```

The agent sees `<connector id>_<tool name>` (here `docker_logs`) on dispatch's MCP server, next to dispatch's own tools; names are lowercase letters, digits and `_`, at most 48 characters together. dispatch attaches a tool only while the repository uses the connector and the tool's action is permitted, and checks both again on every call. Read-only turns (questions about the repository) get only tools of `read` actions. `run(args, ctx)` returns any JSON value, which the agent receives as text cut at 24,000 characters; arguments over 16,000 characters are refused before `run`; each call has 60 seconds. A tool runs in the dispatch server, outside the agent's sandbox, so validate every argument and keep anything that changes state in a `write` action. Calls and results appear in the run's steps. Every attached schema costs context on every turn; keep descriptions short.

When the task has its own database (see `database.provision`), `ctx.taskDatabase` is that database's name, so a tool that reaches the database directly can default to it instead of the shared one.

To show a result as more than text, return `dispatch.withView(value, view)`: the agent still receives `value`, and the run's **Backend** tile renders `view` next to dispatch's own HTTP, SQL, service and CI results, filterable by its label. A view is one of:

| `type` | Fields | Shown as |
| --- | --- | --- |
| `table` | `columns`, `rows` (cells are strings or `null`), optional `query`, `rowCount` | A result grid with copy as TSV, CSV or JSON |
| `http` | `request: { method, url, headers, body }`, `response: { status, statusText, headers, body }` | Request and response tabs with copy as curl |
| `log` | `text` (JSON lines from pino, bunyan or winston are parsed) | A log viewer with levels and times |
| `checks` | `items: [{ name, state, detail }]` (`state`: `ok`, `bad`, `pending`, `muted`), optional `detail` | A status list |
| `text` | `text`, optional `format: 'json'` | Plain or pretty-printed text |
| `changes` | `since`, `tables` as returned by `database.changes`, optional `log` | Each table's inserted, updated and deleted counts, and its changed rows with changed cells shown before → after |

Every view may add `label` (the row's badge, at most 16 characters; defaults to the connector's name), `title` and `error`. dispatch caps sizes (a table keeps the rows that fit in about 12,000 characters and says how many there were) and drops a view of unknown type.

### Examples

A tracker that reads tickets served as JSON:

```js
const link = /^https:\/\/tickets\.example\.test\/(\d+)$/;

export default function createConnector({ plainText }) {
  async function read(ref, { signal }) {
    const response = await fetch(`${ref.sourceUrl}.json`, { signal });
    if (!response.ok) throw new Error(`Example Tracker returned ${response.status} for ticket ${ref.id}.`);
    const item = await response.json();
    return { title: plainText(item.title), description: plainText(item.body), acceptance: plainText(item.acceptance ?? ''), reference: `EX-${ref.id}`, revision: item.version, state: item.status ?? null };
  }
  return {
    id: 'example', name: 'Example Tracker',
    actions: {
      read: { label: 'Read tickets', access: 'read', hooks: { 'ticket.detect': input => { const match = link.exec(input.trim()); return match ? { id: match[1], sourceUrl: match[0] } : null; }, 'ticket.read': read } },
    },
  };
}
```

A notifier that emails you when a task is ready for review, through the local `sendmail`:

```js
import { spawn } from 'node:child_process';

export default function createConnector() {
  const send = ({ run }, { settings }) => new Promise((resolve, reject) => {
    const mail = spawn('sendmail', ['-t']);
    mail.on('error', reject).on('close', code => code === 0 ? resolve() : reject(new Error(`sendmail exited with ${code}.`)));
    mail.stdin.end(`To: ${settings.to}\nSubject: Ready for review: ${run.title}\n\n${run.url ?? ''}\n${run.pullRequest ?? 'No pull request.'}\n`);
  });
  return {
    id: 'mail', name: 'Mail',
    settings: { to: { label: 'Send to', type: 'string', default: '' } },
    actions: { notify: { label: 'Email when ready for review', access: 'write', hooks: { 'run.ready': send } } },
  };
}
```

Turn on **Email when ready for review** in Settings (it is a write, so it starts off), then **Use Mail** in a repository and fill in **Send to**. The same shape works for a webhook: call `fetch` in the hook.

The delivery example is GitHub: [`src/connectors/github/index.mjs`](../src/connectors/github/index.mjs). An agent-tool example is the Docker connector (container and PostgreSQL tools behind a per-repository allowlist), which lives in a repository of its own.

### Testing a connector

A connector's tests live in its own folder (`src/connectors/<name>/test/*.test.mjs` for built-in ones; `npm run test:unit` runs them). Build a fake `dispatch` object (a recording `runProcess`, a `git` that fails the way dispatch's does, a stub `describeChange`), call `createConnector` with it, and call hooks directly with a `ctx`. [`src/connectors/github/test/github.test.mjs`](../src/connectors/github/test/github.test.mjs) does exactly that and imports nothing from dispatch.
