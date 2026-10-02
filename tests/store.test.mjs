import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Store } from '../src/store.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'dispatch-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { store: new Store(directory), read: () => JSON.parse(readFileSync(join(directory, 'state.json'), 'utf8')) };
}

test('saveSoon coalesces a burst of writes into one file write', async t => {
  const { store, read } = fixture(t);
  for (let i = 0; i < 50; i++) { store.state.runs.push({ id: String(i) }); store.saveSoon(); }
  assert.equal(store.writes, 0);
  await sleep(150);
  assert.equal(store.writes, 1); assert.equal(read().runs.length, 50);
});

test('save writes immediately and cancels a pending coalesced write', async t => {
  const { store, read } = fixture(t);
  store.state.runs.push({ id: 'a' }); store.saveSoon();
  store.state.runs.push({ id: 'b' }); store.save();
  assert.equal(store.writes, 1); assert.equal(read().runs.length, 2);
  await sleep(150);
  assert.equal(store.writes, 1);
});

test('flush writes pending changes and is a no-op when nothing is pending', async t => {
  const { store, read } = fixture(t);
  store.flush(); assert.equal(store.writes, 0);
  store.state.runs.push({ id: 'a' }); store.saveSoon(); store.flush();
  assert.equal(store.writes, 1); assert.equal(read().runs.length, 1);
  await sleep(150); assert.equal(store.writes, 1);
});
