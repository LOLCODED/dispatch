import test from 'node:test';
import assert from 'node:assert/strict';
import { commandToken, parseCommand } from '../web/lib/commands.mjs';

test('/todo keeps multi-line text; /forget stays single-line; other text is not a command', () => {
  assert.deepEqual(parseCommand('/todo Fix header\nKeep mobile'), { name: 'todo', text: 'Fix header\nKeep mobile' });
  assert.deepEqual(parseCommand('/todo'), { name: 'todo', text: '' });
  assert.deepEqual(parseCommand('/forget prisma'), { name: 'forget', text: 'prisma' });
  assert.equal(parseCommand('/forget a\nb'), null);
  assert.equal(parseCommand('/todos now'), null);
  assert.equal(parseCommand('/task Fix header'), null);
  assert.equal(parseCommand('please /todo this'), null);
});

test('commandToken splits a recognised command from the text around it', () => {
  assert.deepEqual(commandToken('  /todo Fix header'), { lead: '  ', name: '/todo', rest: ' Fix header' });
  assert.deepEqual(commandToken('/forget'), { lead: '', name: '/forget', rest: '' });
  assert.equal(commandToken('/todos now'), null);
  assert.equal(commandToken('/forget a\nb'), null);
});
