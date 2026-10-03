# Test strategy

## Suites

| Command | Coverage | Count on this revision | External requirements |
|---|---|---|---|
| `npm run check` | Syntax of `src/`, `scripts/` and `tests/` | — | Node |
| `npm run build` | Frontend bundle under `dist/client`; the unit and browser suites serve it, so build once before them | — | Node |
| `npm run test:unit` | `tests/*.test.mjs` plus each connector's own `src/connectors/<name>/test/*.test.mjs`: engine lifecycle, live service, Codex app-server and exec parsing, Claude stream-json and MCP bridge, providers, models, process handling, HTTP API, delivery orchestration, memory, the connector contract, registry, permissions, loader and run events, each built-in connector, review, tasks, serving isolation, analytics, browser evidence, diff, recipe text, repository resolution and per-task repository selection, linked repositories, landing, run tree | 573 tests | Node, Git and loopback ports |
| `npm run e2e` | Five lanes against a controlled worker (`scripts/e2e-server.mjs`) with real Chromium: `tests/e2e/run.spec.mjs` and `visual-edit.spec.mjs` (`@run`, 16), `setup.spec.mjs` (`@setup`, 10), `tasks.spec.mjs`, `landing.spec.mjs` and `multi-repo.spec.mjs` (`@tasks`, 7: saved tasks, the board, landing, one task across three repositories landing on per-repository targets, and Agent decides, both created through the API), `ui.spec.mjs` (`@ui`, 12), `smoke.spec.mjs` (`@smoke`, 2: the browser smoke check and a newly created repository, which start real apps). `npm run e2e:<lane>` runs one lane; every lane creates the runs and repositories it needs | 47 tests | Chromium and a port derived from the worktree path, so concurrent runs in other worktrees never share a server (`DISPATCH_E2E_PORT` overrides) |
| `npm test`, `npm run test:e2e` | Build, then the unit or browser suite | — | as above |
| `node src/connectors/github/smoke.mjs` | Real `git push` to a local bare remote through dispatch and the GitHub connector, with a `gh` shell shim | — | Git |
| `npm run live:smoke` | Explicitly live: three disposable Codex tickets, a follow-up and two reviews | — | Signed-in Codex; consumes usage |
| `node scripts/multi-repo-smoke.mjs [--owner you] [--agent] [--keep]` | Explicitly live: creates three private GitHub repositories (api, frontend with a `staging` base, service) with `gh`, registers them in the dispatch at `--url` (default the dev server on 4327), dispatches one ticket across all three with the enabled provider (`--provider claude` by default; never enables one), expects three commits and three passed checks, opens three draft pull requests (frontend onto `staging`) and checks their bases and cross-links with `gh pr view`, lands them onto `main`/`staging`/`main` and checks the remote did not move, then deletes the repositories unless `--keep` | — | Signed-in `gh`, a running dispatch with the provider enabled; consumes usage |

Check, build, the unit suite and the browser lanes are the mandatory checks and never call a provider or use credentials. Unit tests assert what the browser cannot observe (fail-closed invariants, rejected inputs, restart recovery); flows a person can see are asserted once, in the browser lane that covers them. Engine and service tests use controlled adapter doubles (`tests/live-double.mjs`) and real temporary Git repositories. The README's Status section lists what has been live-verified.

## Acceptance matrix

| Risk | Automated evidence |
|---|---|
| A run publishes after only some checks pass | Live failed-check and E2E handoff tests |
| Stale evidence counts for a changed revision | Live check-mutation test |
| Repair loop runs forever | Bounded repair test |
| Duplicate ticket starts twice | Engine conflict test and the HTTP 409 test |
| Two live runs start at once | Engine queueing test (one live worker) |
| Cancelled work later publishes | Queued and in-flight cancellation tests |
| Restart silently repeats work | Recovery interruption test |
| Timeout becomes success | Process timeout test |
| Ticket text becomes shell code | Argument-literal process test; no command is built from ticket text |
| Local server serves arbitrary files | Static allowlist/API path tests |
| Browser checks are merely claimed | E2E check launches real Chromium and saves artifacts |
| UI is unusable on a phone | 390px viewport/navigation/form/overflow browser test |
| Critical flows throw frontend errors | Browser happy path records and asserts no page errors |
| Delivery pushes when disabled or force-pushes | Core delivery tests drive `tests/forge-double.mjs`, an in-memory code host; ticket tests drive `tests/tracker-double.mjs`. Neither names a real service, so the core suite passes with every built-in connector folder deleted. Switched-off actions and unused connectors make zero calls |
| Repository notes leak into the worktree or repairs | Memory lifecycle tests |

## Repository checks

A live project's recipes must assert the properties that matter for that repository. An agent may edit tests too; do not let it redefine its own acceptance gate unnoticed. Keep baseline regressions and trusted acceptance recipes outside its editable scope or require explicit review of changes to them.

## Evidence semantics

- Check output is bounded to the latest 100,000 characters per process.
- Browser retries are zero; an assertion is not hidden behind automatic reruns.
- Screenshots and traces are retained for successful browser checks too.
- Screenshots support inspection; assertions establish the automated pass signal.
- A revision hash is taken before checks and verified before handoff.
- A cancelled check remains cancelled even if a process exits zero after cancellation.

## Not yet covered

1. **Crash injection:** terminate before and after push, pull request creation and ticket writeback; reconcile safely.
2. **Environment isolation:** services, databases and ports used by checks do not bleed across tickets.
3. **Live acceptance:** Claude Code questions and review over MCP, and the GitHub connector with a real `gh` login, as opt-in runs excluded from default checks.
4. **Human acceptance:** sample merged outcomes for defects that automated checks missed.

## Testing discipline

Rerun focused tests during development; run the complete prescribed suite before handoff. A failed suite is a failure to investigate, not permission to weaken an assertion. Do not repeatedly rerun expensive suites without a change or a specific flake hypothesis. Report infrastructure failures separately from application defects.

Playwright references: [web assertions](https://playwright.dev/docs/test-assertions), [trace viewer](https://playwright.dev/docs/trace-viewer). Node reference: [test runner](https://nodejs.org/api/test.html).
