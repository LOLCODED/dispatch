import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../web/lib/commands.mjs';

test('/todo keeps multi-line text; /forget stays single-line; other text is not a command', () => {
  assert.deepEqual(parseCommand('/todo Fix header\nKeep mobile'), { name: 'todo', text: 'Fix header\nKeep mobile' });
  assert.deepEqual(parseCommand('/todo'), { name: 'todo', text: '' });
  assert.deepEqual(parseCommand('/forget prisma'), { name: 'forget', text: 'prisma' });
  assert.equal(parseCommand('/forget a\nb'), null);
  assert.equal(parseCommand('/todos now'), null);
  assert.equal(parseCommand('/task Fix header'), null);
  assert.equal(parseCommand('please /todo this'), null);
});
