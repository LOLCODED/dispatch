# Contributing

1. Read README.md, AGENTS.md, and docs/ARCHITECTURE.md.
2. Keep each change bounded to one task.
3. Preserve honest live-verified, tested-with-doubles and planned labels.
4. Install with `npm ci` and `npx playwright install chromium`.
5. Run `npm run check`, `npm run build`, `npm run test:unit`, and `npm run e2e` for lifecycle/UI changes. `npm run e2e:<lane>` (run, setup, tasks, ui, smoke) runs one browser lane while iterating.
6. Update the docs when behavior changes.
7. A new connector goes in its own folder (`src/connectors/<name>/` with `package.json`, `index.mjs`, `test/` and a README) and uses only the `dispatch` object; see docs/INTEGRATIONS.md#writing-a-connector. Core code must not name it.

PR descriptions should explain the behavior change, relevant acceptance criteria, tests run, and remaining limitations. Include browser evidence for visible UI changes. Use disposable repositories and recorded API responses for integration development; live provider tests must be explicit and excluded from default CI.

Never commit credentials, actual workplace ticket content, generated workspaces, or run data. Contributions are accepted under the [MIT License](LICENSE).
