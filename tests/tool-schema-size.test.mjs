import test from 'node:test';
import assert from 'node:assert/strict';
import { repositoryTool, toolSchemaCharacters, toolSet } from '../src/dispatch-tools.mjs';

test('the repository tool keeps the default change-turn tool schema small', t => {
  const added = toolSchemaCharacters([repositoryTool]), turn = toolSchemaCharacters(toolSet({ memory: true, repository: true }));
  t.diagnostic(`dispatch_repository schema: ${added} characters; memory + repository: ${turn} characters`);
  assert.ok(added < 2000, 'dispatch_repository schema stays under 2,000 characters');
});
