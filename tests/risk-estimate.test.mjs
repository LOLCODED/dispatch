import test from 'node:test';
import assert from 'node:assert/strict';
import { RiskChecks } from '../src/risk-checks.mjs';

const run = { projectId: 'repo', project: { validation: [{ id: 'build', command: 'npm', args: ['run', 'build'] }, { id: 'unit', command: 'npm', args: ['run', 'test:unit'] }] } };
const check = (name, durationMs, extra = {}) => ({ name, durationMs, status: 'passed', command: ['npm', 'run', name === 'build' ? 'build' : 'test:unit'], ...extra });
const estimator = runs => new RiskChecks({ engine: { runs } });

test('risk duration estimates sum median durations of matching commands in the same repository', () => {
  const risk = estimator([{ projectId: 'repo', checks: [check('build', 20000), check('build', 40000), check('build', 90000), check('unit', 80000)] }]);
  assert.match(risk.estimate(run, ['build']), /under 1 minute/);
  assert.match(risk.estimate(run, ['build', 'unit']), /about 2 minutes/);
});

test('risk duration estimates remain unknown for missing, reused, failed or different-command evidence', () => {
  const risk = estimator([
    { projectId: 'other', checks: [check('unit', 1000)] },
    { projectId: 'repo', checks: [check('build', 1000), check('unit', 0, { reusedFrom: {} }), check('unit', 1000, { status: 'failed' }), check('unit', 1000, { command: ['different'] })] }
  ]);
  assert.match(risk.estimate(run, ['build', 'unit']), /unavailable/);
});
