import test from 'node:test';
import assert from 'node:assert/strict';
import { heldReplies } from '../web/lib/held-reply.mjs';

const message = id => ({ id, kind: 'message', message: id });
const worker = status => ({ role: 'worker', status });

test('the closing reply waits while checks run and appears once the run settles', () => {
  const events = [{ id: 's', kind: 'implementing' }, message('working'), { id: 't', kind: 'tool' }, message('done'), { id: 'v', kind: 'validating' }];
  assert.deepEqual([...heldReplies({ status: 'validating', events, workerTurns: [worker('completed')] })], ['done']);
  assert.equal(heldReplies({ status: 'ready', events: [...events, { id: 'r', kind: 'ready' }], workerTurns: [worker('completed')] }).size, 0);
});

test('the reply is held as soon as the turn ends, before validation starts', () => {
  const events = [message('working'), message('done')];
  assert.deepEqual([...heldReplies({ status: 'implementing', events, workerTurns: [worker('completed')] })], ['done']);
  assert.equal(heldReplies({ status: 'implementing', events, workerTurns: [worker('running')] }).size, 0);
});

test('every turn-closing reply stays held through repairs and review', () => {
  const events = [message('first'), { id: 'v1', kind: 'validating' }, { id: 'r', kind: 'repairing' }, message('fixing'), message('second'), { id: 'v2', kind: 'validating' }, { id: 'rv', kind: 'reviewing' }];
  const run = { status: 'reviewing', events, workerTurns: [worker('completed'), worker('completed'), { role: 'reviewer', status: 'running' }] };
  assert.deepEqual([...heldReplies(run)], ['first', 'second']);
});
