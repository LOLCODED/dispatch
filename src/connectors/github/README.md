# GitHub connector

Pushes a task's tested branch, opens and updates its pull request, and reads the pull request's state, reviews and CI checks, all through the GitHub CLI (`gh`) and its existing login. It ships with dispatch and is loaded at startup like any connector you add. It is also the reference for writing your own ([docs/INTEGRATIONS.md](../../../docs/INTEGRATIONS.md#writing-a-connector)). Delete this folder and dispatch runs without a delivery connector.

## Requirements

`gh` on your `PATH`, logged in with `gh auth login`. Settings › Connectors shows whether it is installed and logged in.

## Actions

| Action | Access | Default | Hooks |
|---|---|---|---|
| Push task branches | write | off | `delivery.push` |
| Open pull requests | write | off | `delivery.openPullRequest`, `delivery.describe` |
| Read pull requests | read | on | `delivery.findPullRequest`, `delivery.reviews` |
| Read CI checks | read | on | `delivery.checks`, `delivery.checkLogs` |

Pushes are `git push <remote> HEAD:refs/heads/<branch>`, never forced, with one retry on a transient network failure. Pull requests are opened as drafts unless **Open as draft** is off, titled and described with `describeChange`. The repository's `owner/name` is read once per remote with `gh repo view` and remembered for that repository.

## Settings (per repository)

| Setting | Default |
|---|---|
| Git remote | `origin` |
| Open as draft | on |

## Files

- `index.mjs`: the connector. It uses only the `dispatch` object it is given (`runProcess`, `git`, `localEnvironment`, `describeChange`).
- `test/github.test.mjs`: its tests, with a fake `dispatch` object; run by `npm run test:unit`.
- `smoke.mjs`: opt-in smoke that runs a real `git push` to a disposable local bare remote through dispatch with a `gh` shell shim: `node src/connectors/github/smoke.mjs`. It never contacts GitHub.

Status: tested with doubles and the local smoke; not yet run against a real GitHub repository.
