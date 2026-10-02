import test from 'node:test';
import assert from 'node:assert/strict';
import { branchName, branchType, renderBranch, safeBranch, validateTemplate } from '../src/branch.mjs';

test('branch types map tracker work item types with a task default', () => {
  assert.equal(branchType('Bug'), 'bug'); assert.equal(branchType('User Story'), 'story'); assert.equal(branchType('Epic'), 'epic'); assert.equal(branchType(undefined), 'task'); assert.equal(branchType('Weird'), 'task');
});

test('templates need a unique token, allowed tokens only, and a valid Git name', () => {
  assert.equal(validateTemplate('{type}/{ticketId}'), '{type}/{ticketId}');
  assert.throws(() => validateTemplate('{slug}'), /unique/);
  assert.throws(() => validateTemplate('{owner}/{ticketId}'), /tokens/);
  assert.throws(() => validateTemplate('../{ticketId}'), /invalid Git branch/);
  assert.throws(() => validateTemplate(''), /text/);
  assert.equal(safeBranch('story/42'), true); assert.equal(safeBranch('refs/heads/x'), false); assert.equal(safeBranch('a..b'), false); assert.equal(safeBranch('x.lock'), false); assert.equal(safeBranch('.hidden/1'), false);
});

test('branch names render from the ticket and fall back to dispatch/<run> when unsafe or equal to the base', () => {
  const ticket = { id: '42', type: 'User Story', title: 'Fix the balance label!' };
  assert.equal(branchName('{type}/{ticketId}', { ticket, runId: 'abc-123', baseBranch: 'staging' }), 'story/42');
  assert.equal(branchName('{type}/{ticketId}-{slug}', { ticket, runId: 'abc-123', baseBranch: 'staging' }), 'story/42-fix-the-balance-label');
  assert.equal(branchName('{type}/{ticketId}', { ticket: { title: 'Text ticket' }, runId: 'abc-123', baseBranch: 'staging' }), 'task/abc-123');
  assert.equal(branchName(null, { ticket, runId: 'abc-123', baseBranch: 'staging' }), 'dispatch/abc-123');
  assert.equal(branchName('{run}', { ticket, runId: 'staging', baseBranch: 'staging' }), 'dispatch/staging');
  assert.equal(renderBranch('{type}--{id}', { type: 'bug', id: '1' }), 'bug-1');
});
