import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveAction, overridden, setAction, setSetting, setUsed, settingValue, ticketReader, usedConnectors } from '../web/lib/connectors.mjs';

const comment = { id: 'comment', access: 'write', enabled: false }, read = { id: 'read', access: 'read', enabled: true };
const tracker = { id: 'example', name: 'Example', tickets: true, actions: [read, comment], settings: [] };
const remote = { key: 'remote', type: 'string', default: 'origin' };

test('a repository override is kept only while it differs from the global default', () => {
  let settings = setUsed({}, tracker, true);
  assert.deepEqual(settings, { example: { enabled: true, actions: {}, settings: {} } });
  assert.equal(effectiveAction(settings, tracker, comment), false);
  settings = setAction(settings, tracker, comment, true);
  assert.deepEqual([effectiveAction(settings, tracker, comment), overridden(settings, tracker, comment)], [true, true]);
  settings = setAction(settings, tracker, comment, false);
  assert.deepEqual(settings.example.actions, {}); assert.equal(overridden(settings, tracker, comment), false);
  settings = setAction(settings, tracker, read, false);
  assert.deepEqual(settings.example.actions, { read: false });
  assert.equal(effectiveAction({}, tracker, { id: 'x', access: 'read' }), true); assert.equal(effectiveAction({}, tracker, { id: 'y', access: 'write' }), false);
});

test('connector settings store only values that differ from their default', () => {
  let settings = setSetting({}, tracker, remote, 'upstream');
  assert.equal(settingValue(settings, tracker, remote), 'upstream');
  settings = setSetting(settings, tracker, remote, 'origin');
  assert.deepEqual(settings.example.settings, {}); assert.equal(settingValue(settings, tracker, remote), 'origin');
});

test('used connectors and the ticket reader follow the repository switch', () => {
  const github = { id: 'github', name: 'GitHub', delivers: true, tickets: false };
  assert.deepEqual(usedConnectors([tracker, github], { github: { enabled: true } }).map(connector => connector.id), ['github']);
  assert.equal(ticketReader([tracker, github], { github: { enabled: true } }), undefined);
  assert.equal(ticketReader([tracker, github], { example: { enabled: true } }).id, 'example');
});
