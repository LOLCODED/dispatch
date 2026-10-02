import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmLongRunning, longRunningSteps, parseRecipeText, recipeText } from '../web/lib/recipe-text.mjs';

test('recipe text keeps existing steps exactly and turns new lines into commands', () => {
  const existing = [{ id: 'unit', role: 'check', command: 'node', args: ['-e', 'process.exit(0)'], timeoutSeconds: 30 }];
  const steps = parseRecipeText(`${recipeText(existing)}\n\n  npm run lint  \nmake test\n`, existing);
  assert.deepEqual(steps, [existing[0], { id: 'lint', command: 'npm', args: ['run', 'lint'] }, { id: 'check-3', command: 'make', args: ['test'] }]);
});
test('long-running npm scripts are detected and confirmed only on request', () => {
  const steps = parseRecipeText('npm run dev\nnpm test\nnpm start');
  assert.deepEqual(longRunningSteps(steps).map(step => step.id), ['dev', 'start']);
  assert.deepEqual(confirmLongRunning(steps).map(step => step.confirmedLongRunning === true), [true, false, true]);
});
