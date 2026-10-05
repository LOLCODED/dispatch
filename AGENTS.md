# Working on dispatch

**Purpose:** dispatch hands tickets to existing agent CLIs, isolates and verifies the work, and delivers a mergeable result with a clear trail. It is not an agent.

Read README.md and docs/ARCHITECTURE.md before changing orchestration.

- Keep orchestration deterministic. One primary agent owns each ticket.
- Never enable a live integration implicitly.
- Success requires every check the repository's rules assign to the change, run against the current workspace revision: all of them, unless every changed file matches at least one of the repository's check scopes, in which case the union of the checks those scopes assign runs. The decision comes from the diff, never from ticket text or a model.
- Preserve bounded repair loops, cancellation, recovery, and duplicate-ticket exclusion.
- Render ticket content as text; never execute commands from ticket text.
- Use Node built-ins for backend runtime code. The user-approved frontend uses React, Tailwind, Vite, and shadcn/ui. Discuss additional dependencies only if they solve a concrete need.
- Run `npm run check`, `npm run build`, `npm run test:unit`, and `npm run e2e` for changes affecting the run lifecycle (`npm run e2e:run|setup|tasks|ui|smoke` runs one browser lane while iterating).
- Keep the docs honest about implemented versus planned behavior.

Verification status: Codex Auto runs (worktree, checks, local commit, repair, follow-up, questions) and Codex independent review are live-verified. Claude Code is behind explicit per-provider consent; its Auto runs through dispatch are live-verified, while its questions and review over MCP are tested with doubles only. The dispatch browser and dispatch MCP tools are live-verified on both providers. Local models run through Claude Code, OpenCode or pi against a saved endpoint; Auto runs on all three are live-verified on the Ollama CLI, while Docker, remote and non-Ollama endpoints, and OpenCode and pi with their own hosted models, are tested with doubles only. The backend tools (`dispatch_http`, `dispatch_sql` through the PostgreSQL connector, `dispatch_service`) and per-task databases (PostgreSQL connector on Codex, commands provider on Claude Code, with `dispatch_database migrate`) are live-verified; `dispatch_ci`, connector views and other database connectors are tested with doubles only. The GitHub connector, ticket connectors (intake, comment writeback, state moves), run-event notifications, connector agent tools, repository memory, editing checks from a blocked run, and agents adding a repository to a task (`dispatch_repository`, with automatic continuation) are tested with doubles only.

## Working rules

- **Purpose:** every change serves the purpose statement above. dispatch adds intake, isolation, verification, tracking and memory around existing CLIs; it does not compete with them at being an agent.
- **Use before build:** do not add a feature until the path it extends has been used on real tickets and the friction it removes is written down in the change.
- **Non-goals:** see the list below. If a change touches one, stop and ask.
- **Pipeline changes:** report real-run time, tokens and outcome before and after. Controlled doubles prove correctness, not performance.
- **Verification status:** label a feature "live-verified" only after a real provider run. Otherwise it is "tested with doubles."
- **Settings are reachable everywhere (hard rule):** every setting, existing or new, is declared in `src/settings.mjs` and so can be read and changed through the HTTP API (`/api/settings`), the CLI (`dispatch settings`) and a task (`dispatch_settings`, each change approved by the operator), exactly as its settings page would. A change that adds or renames a setting registers it in the same change; `tests/settings.test.mjs` fails on any stored setting the registry does not know. Secrets are never readable.
- **Connectors:** core never names a specific connector; `src/connectors/<name>/` must be deletable without breaking anything. A connector uses only the `dispatch` object it is given, keeps its tests in its own folder, and every action that writes outside dispatch starts off.

## Non-goals (for now)

- A custom agent loop or LLM API layer, including building on pi-ai/pi-agent-core unless a research spike finds a concrete, measured win.
- Manager/CEO agents, role hierarchies, or model calls for routing or scheduling.
- Game development and 3D workflows.
- A full CLI front end. `bin/dispatch.mjs` saves and lists tasks, saves and lists repositories, manages connectors and reads and changes settings through the running server's HTTP API. Keep `src/` free of HTTP and React so more can be added later without a rewrite.
- Splitting repositories or packages, a plugin runtime, vector databases, or SQLite unless durable claims demand it. The one exception: connectors (tickets, delivery, run events) loaded from folders, the built-in ones under `src/connectors/<name>/` and any the user adds explicitly (docs/INTEGRATIONS.md).
- Hosted or multi-user operation.
- Further UI polish passes before the golden path works end to end on real tickets.

## Product pillars — apply to every change

- **Stability:** preserve unrelated behavior, isolate edits, and bind every check that runs to the exact candidate revision. Use focused regression coverage for concrete failure risks. Never trade validation, cancellation, recovery, or explicit integration consent for throughput.
- **Speed:** keep the path from ticket to tested result short. One owner implements; deterministic code schedules checks. Stop when required evidence is sufficient. Avoid repeated full-suite runs, speculative refactors, manager-agent hierarchies, polling that transfers full logs, and model calls for routine routing.
- **Efficiency:** reuse the native worker session for repairs/follow-ups; send bounded relevant failure output. Load evidence and integration context only when needed. Measure elapsed time, checks, repairs, and provider-reported usage; keep missing measurements unknown. Performance claims require measurements, not intuition.
- **Modularity:** keep orchestration independent of HTTP/React. Provider adapters execute turns; connectors talk to outside services through declared actions and hooks; the engine owns lifecycle and validation. Optional integrations must be explicitly enabled and must add no credential probes or model context when disabled. A future CLI should reuse these services; do not split repositories or add a plugin runtime beyond connectors without a demonstrated need.
- **Interface:** everyday use centers on the task and its outcome. Reveal setup, logs, evidence, and administration on demand. Keyboard/gesture shortcuts supplement visible, accessible controls; they must not be the only route to an action. Preserve drafts, direct links, mobile use, and reduced-motion behavior. Any list outside a run page that can grow without bound gets the shared search, sort and pager from `web/components/ListControls.jsx`.

Before expanding the harness, identify the user friction being removed and the observable result. Document implemented behavior separately from planned delivery integrations. Independent agent review is not equivalent to passing automated checks; describe each honestly.

Never restart or signal a running dispatch server, and never run `dispatch install` or `dispatch update` unless asked; run previews on their own port and data directory (`npm run dev` uses 4327 and `.dispatch-dev/`, and seeds a demo repository with two ready runs and an answered, blocked and failed run when that directory has no runs; `DISPATCH_DEV_SEED=0` skips it).
