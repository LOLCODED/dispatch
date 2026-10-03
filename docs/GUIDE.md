# Guide

Everything dispatch does, in the order you meet it. For what is live-verified versus tested with doubles, see the Status section of the [README](../README.md#status).

## Set up a repository

1. Choose **+ Add repository…** in the composer (or **Settings → Repositories → Add repository**). Type a local Git checkout path or browse folders; `~/` and paths relative to the server folder work. A folder that is not a Git repository is saved as a **plain folder**: the agent works in it directly, dispatch snapshots it for checks, and there is no branch, commit, landing or pull request for it.
2. Choose the base branch and, under **Checks**, switch on the package scripts that must pass or add any other command. Turn on `npm ci` under *Before each run* when a fresh worktree needs dependencies. The save bar lists every new command; saving approves them.
3. Optionally enable independent review, repository notes, the dispatch browser and the connectors this repository uses. Save.

**New projects:** ask for something new in a folder that does not exist yet and the agent creates the folder and asks to add it, or answer a repository question with a new path under **Other repository path**: dispatch offers to create it as a Git repository (folder, `git init`) or as a plain folder (no Git), either registered with the browser smoke check as its only check. New projects can be given full access (no sandbox, network on) so the agent can install packages; package scripts the agent adds are offered as extra checks after the run, never enabled on their own.

## Run a task

Paste a ticket or describe the change and press **dispatch** (or **Ctrl/⌘ + Enter**). **Save for later** stores it locally without provider usage; saved tasks appear under **Todo** and start from the state dot.

- **Repository:** there is no picker. A ticket that names one saved repository (by name, folder name or path) goes there, with the repositories linked to it in its settings. Anything else starts in **dispatch home**, a scratch Git repository at `<data>/home` with no checks: the agent answers or works there, and when the ticket is about a project elsewhere it finds the folder from the ticket's clues, asks which one when unsure, and asks you to add it with `dispatch_repository` (see below). No model call routes a ticket. A task can still span several repositories, each with its own worktree, checks and commit, and the Land and pull request dialogs ask for a target branch per repository; `dispatch add --repo a,b` and the HTTP API's `projectIds` (or `all` to let the agent decide among every saved repository) set them explicitly.
- **Model:** Auto uses the provider's reported default or the CLI default. **Settings** checks connections and refreshes CLI-reported models without a model turn. A run keeps its provider and model through repairs, review and follow-ups.
- **Questions:** appear in chat with two or three options and a typed answer. Answering resumes the same session and reruns the checks, except checks that already passed on the identical tree, which are reused.
- **Questions only:** a ticket that just asks something gets an answer without edits, checks or a commit. A follow-up in the same session can then make the change.
- **Interrupt:** send new instructions while the agent works; the turn stops and continues in the same session.

**From a terminal.** `dispatch add "instructions"` saves a task to **Todo** in a running dispatch (text from arguments or stdin; `--answer` for a question, `--repo <name|path>` to choose the repository, `--repo api,web` for several with the first as primary, `--repo all` to let the agent decide; otherwise the one containing the current folder or the one the text names). `dispatch tasks` lists saved tasks. `dispatch repo add <folder>` saves a repository with the settings the connect form suggests; `--name`, `--base`, `--check`, `--setup`, `--text-only`, `--instruction`, `--browser`/`--no-browser` and `--review` override them, and `--link <repo>` links it to a saved repository. An already saved folder keeps its settings and is only linked. `dispatch repo list` shows saved repositories and their links. `npm link` in the checkout puts `dispatch` on your PATH; `DISPATCH_URL` points it at another port. Nothing starts until you press Start.

The home **Tasks** list groups conversations as Needs decision, Active, Todo and Completed. The state dot starts, pauses, stops, archives and files tasks into folders.

## Run page

Each run has its own URL at `/runs/:id`. **Chat**, **Diff**, **Checks** and **Timeline** are tiles in a master/stack layout: toggle them from the header or **Alt+1…4**, promote, close, resize, or take one full screen (**Alt+F** by default, configurable in Settings; Escape leaves). The layout persists locally; phones show one tile at a time. Dragging a diff line or referencing a screenshot adds a text reference to the follow-up draft.

The **Result** drawer holds the verdict (outcome, checks against the tested tree, review, base drift, warnings for changed tests, SQL, env files, lockfiles and protected paths, the SQL to run with a copy button, and Remove worktree) above the run's model, branch, per-phase timings, tokens and evidence export. It opens by itself on desktop when a run you are watching finishes.

**Timeline** is the rewind: every recorded step in order (turns, tool calls, browser actions with their screenshot and target, file changes, checks with screenshots, videos and traces, questions, delivery, status). Step with Previous/Next/Play, the scrubber, or ←, → and Space; **Browser only** keeps just browser actions; a step's link ends in `#step=N`. Playwright traces open in the built-in trace viewer. While the agent drives the dispatch browser, the run area becomes a live browser view over a caption feed of its actions.

The follow-up box suggests a reply from the run state (take the recommended option, fix the failing check, continue); **Tab** accepts it. Press **/** to focus the task and **Escape** to close a drawer or preview. Every shortcut has a visible control.

## Checks

Every saved step has a role, `check` or `setup`. Long-running scripts (`start`, `dev`, `dev:*`, `serve`, `watch`, `preview`) are never suggested, show a warning when selected, and are refused as checks unless you confirm them.

**Check scopes** keep small changes fast. Each scope names path patterns and the checks they require. After the agent's turn, dispatch reads the diff: if every changed file matches a scope, the union of the matched scopes' checks runs and the rest are recorded as skipped with the reason; otherwise everything runs. New repositories start with a text-only scope (`*.md`, `docs/**`). The decision comes from the diff, never from the ticket or a model.

**Browser smoke check** is built in for apps without their own tests: dispatch starts the first of the `dev`, `preview`, `start` or `serve` scripts on a free port, loads the page in Chromium, keeps a screenshot, and fails on page errors, console errors or an HTTP error status. Switch it on under Checks, or add `{ "id": "browser-smoke", "kind": "browser-smoke" }` (optional `start`, `url`, `readyTimeoutSeconds`) to the repository's `validation` through the API.

When a run ends blocked or failed on a check, **Checks → Edit checks and continue** changes the mandatory checks, updates the repository's recipe and continues the same session with fresh checks.

## dispatch browser

**Give the agent a dispatch browser** is set per repository: the connect form pre-ticks it when the repository has a `dev`, `preview`, `start` or `serve` script, repositories created from the composer get it on, and repositories saved before this default keep their setting until you tick it. Every provider then gets the same `dispatch_browser_*` tools (navigate, snapshot, click, type, press, select, scroll, wait, back, screenshot, console). The browser is Chromium through Playwright, owned by dispatch rather than the CLI, with network access and a persistent profile per repository: log in once and the session survives later runs. The agent acts on element refs from the accessibility snapshot, never coordinates. `app:/` opens the worktree's own app; dispatch starts its dev server on a free port and stops it before checks. Every action records a screenshot (bounded to 400 files or 60 MB per run) for the Timeline. Off means no tool, no process and no profile. "Show the browser window" runs it headed.

## Providers

Turning a provider on is consent for dispatch to check its CLI and list its models. A provider that is off is never probed. Each CLI keeps its own login; dispatch copies no credentials.

- **Codex:** `codex app-server` for owner turns (streamed messages, native questions), `codex exec --json` read-only for review. On by default.
- **Claude Code:** `claude -p` stream-json. Owner turns use `acceptEdits` inside Claude Code's sandbox; review denies mutating tools; nothing may prompt. Off until you enable it under **Settings → Integrations → Providers**.

**Settings → General → Agent access** decides what owner turns may write: **Home folder** (default) keeps the OS sandbox with network off; **Full access** removes it. Review turns stay read-only either way.

dispatch's own tools (`dispatch_question`, `dispatch_memory`, `dispatch_repository`, `dispatch_browser_*`) are one registry served to both CLIs by a per-turn local MCP server. The MCP server name `dispatch` is reserved.

**Adding a repository mid-task.** When a ticket needs a folder outside the task, the agent can use `dispatch_repository` to inspect the folder and ask to add it, instead of editing it in place. You see the settings and commands dispatch would save and answer **Add it** or **Not now**. Once you approve, the folder is saved (or, if already saved, used as it is). When the turn ends, dispatch continues the ticket in the same session with the new repository in its own worktree, with its own checks and commit. Agents set name, base branch, checks, setup, text-only paths, instructions, browser and review; `alwaysLink` also links it to the task's repository for future tasks. Tested with doubles only.

## Brain and memory

Everything dispatch remembers is on one page, **Brain** (Settings → Brain): your standing rules, learned preferences, enabled connectors and the agent's notes, grouped by "Everywhere" and by repository. Each entry can be turned off or forgotten. Type `/forget <text>` in any composer to find matching entries.

`/todo <text>` in any composer saves a task to **Todo** without starting it; more lines after the first become its details. From a run it uses that run's repository and the Todo row links back to the run. Review findings have the same **Save as task** button.

- **Standing rules:** up to 20 lines sent on every worker turn and to the reviewer. Tell the agent "always do X" and it records the rule with `dispatch_memory`.
- **Preferences** grow deterministically: the first time dispatch needs a choice it asks; after 2 matching answers it suggests; after 4 it acts on its own and says so with an Undo. A different answer starts over, and you can pin a mode. No model call.
- **Repository notes:** `notes.md` and `tasks.jsonl` under `<data directory>/memory/<project id>/`, never in the repository. Finished runs append a summary; ready runs add up to three learnings from the worker's closing notes. A new task's first turn receives relevant notes, capped at 2,000 characters and labelled as data. Turn it off per repository. The value on repeat tasks is not yet measured.

## Connectors

Anything that reaches outside your machine is a connector: reading a ticket link, commenting the result on the ticket, pushing the branch and opening a pull request, or telling you a task is ready. GitHub ships with dispatch; anything else you add from a folder:

```sh
dispatch connector add ~/code/my-connector
dispatch connector list
dispatch connector remove <id>
```

or under **Settings › Connectors**. Adding or removing one takes effect without a restart. A connector runs inside the dispatch server as your user, so add only code you trust. [INTEGRATIONS.md](INTEGRATIONS.md#writing-a-connector) documents how to write one.

Open a connector in **Settings › Connectors** to see what it can do. Each action has a switch; reading actions start on and writing actions start off. Those are the defaults for every repository. In a repository's **Extras**, **Use** *connector* decides whether it takes part automatically, and each action can be switched for that repository alone. Opening a pull request by hand needs only the actions allowed, not **Use**. A connector nothing uses is never called.

### Tickets

Paste a ticket link into a repository that does not read that connector yet and the composer offers to turn it on for that repository, everywhere, or to paste the text instead. A connector can remember your organization so later tickets can be pasted as bare ids. Only a single line starting with `http://` or `https://` is treated as a URL.

With its comment action on, each ready run posts one comment on the ticket with the outcome, branch, pull request, checks and any state move. Nothing else on the ticket changes. With its state action on, after a pull request opens the verdict offers to move the ticket to one of its allowed states. Answering teaches the preference ladder; "Never ask here" stops it. Every move is revision-checked and can be undone.

### Delivery

- **GitHub** (your `gh` login): with **Use GitHub** and **Push task branches** on, after a run is ready dispatch pushes `HEAD:refs/heads/dispatch/<run>` (or your branch template, such as `{type}/{ticketId}`), never force and never the base branch; with **Open pull requests** on it reuses the branch's pull request or opens a draft one; with **Read CI checks** on it reads CI for the pushed commit. CI failure never changes the run status. When **Refresh delivery** finds failed checks on the delivered commit, the verdict lists them with **Repair CI failures**: it continues the same session with the failing jobs' logs (at most three checks, about 10,000 characters in all), reruns the local checks and pushes the fix to the same branch. Nothing repairs by itself. Nothing is merged.

Delivery and ticket writeback are tested with doubles and a local bare remote (`node src/connectors/github/smoke.mjs`), not yet against real GitHub or a real tracker.

### Notifications

A connector can react to a run becoming ready, blocked, failed or cancelled, for example by sending you an email. These are write actions, so they start off.

## Execution boundaries

- One live worker at a time. One implementation owner per ticket, in its own worktree and branch from the base commit (a freshly fetched `origin/<base>` when the remote exists). No automatic merge. A plain folder is edited in place instead, one conversation at a time, with its checks bound to a snapshot of the folder.
- One automatic repair, shared by check failures and review findings.
- Setup and check recipes are saved outside the worktree and snapshotted per run. Package-script changes block automatic checks once; continue the run to accept them, or turn on "Write sensitive files without asking" for the repository to accept them without blocking. Commands run as your local user: use trusted repositories.
- Every check assigned to the change must pass on the same candidate tree before a matching local commit is marked ready. Follow-ups rerun them.
- Cancellation stops process groups. Restart marks working runs interrupted; nothing is replayed. Queued runs had not started, so they stay queued.
- Usage is provider-reported per turn. Missing values stay unknown.

## Installed release

`node bin/dispatch.mjs install` (from a checkout) clones that checkout into `~/.local/share/dispatch/app` at its newest `vX.Y.Z` tag, runs `npm ci` and the build, and starts it as a user service on port 4317 with data in `~/.dispatch` (or `<dir>/data` with `--dir`; deleting it resets dispatch, and the next task recreates what it needs): `dispatch.service` under systemd (`journalctl --user -u dispatch` for logs) or `dev.dispatch.server` under launchd (log in `~/.local/share/dispatch/server.log`). It links `dispatch` into `~/.local/bin`. The service keeps the PATH from install time so it finds `codex`, `claude`, `git` and `npm`; reinstall after moving them.

Ship a version by tagging the checkout (`npm version <x.y.z>`), then run `dispatch update`: it fetches tags from the checkout it was installed from, checks out the newest (or `--ref`), rebuilds and restarts the service. While a run is working it holds the queue so nothing new starts, waits for the working runs to finish, then installs and restarts; queued runs stay queued and continue on the new version. Ctrl+C releases the hold. `--force` updates at once and leaves working runs interrupted. An install whose data is still in `~/.local/share/dispatch/data` has it moved to `~/.dispatch` by an update run without `--dir`: with the queue idle it stops the service, moves the folder, rewrites the paths stored in `state.json`, re-links every task worktree with `git worktree repair`, and restarts on the same port and PATH. It changes nothing when `~/.dispatch` already exists or the two folders are on different filesystems. The move ships in the updater, so it happens on the update after the one that installs it. `--dir` and `--port` choose another location or port at install.

`dispatch` on its own prints the address, starting the service first if nothing answers, so it never launches a second server. `dispatch kill` stops the service (refusing while a run is working unless `--force`); it stays enabled and starts again at login.

`npm run dev` serves the working copy on port 4327 with `.dispatch-dev/` and restarts after each frontend rebuild, so it never shares data or a port with the installed release. `npm start` keeps the defaults below.

## Local data and configuration

State, logs, step logs (`live-steps/`), browser profiles (`browser-profiles/`), notes and worktrees live under `.dispatch/` (Git-ignored). A run's evidence exports as one zip (`/api/runs/:id/export?format=zip`).

| Variable | Default | Purpose |
|---|---|---|
| `DISPATCH_DATA_DIR` | `.dispatch/` | Data directory |
| `PORT` | `4317` | Server port |
| `DISPATCH_CONCURRENCY` | `1` | Tasks at a time (1–4) until Settings → Queue sets it |

The server binds loopback and checks Host and Origin. Stopping it interrupts work. Remove reviewed worktrees from the Result drawer or with `git worktree remove`.
