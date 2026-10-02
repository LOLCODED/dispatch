import test from 'node:test';
import assert from 'node:assert/strict';
import { diffWanted, layoutPolicy, layoutReaction, previewLayout, relevantTiles } from '../web/lib/run-layouts.mjs';

const run = { canDiff: true, hasChanges: false, checks: false, driving: false, browsed: false };

test('an unknown layout falls back to the default', () => {
  assert.equal(layoutPolicy('nope'), layoutPolicy('default'));
});

test('vibe offers the diff button before any diff is loaded, and games always', () => {
  assert.deepEqual(relevantTiles(layoutPolicy('vibe'), run), ['chat', 'games', 'diff']);
  assert.deepEqual(relevantTiles(layoutPolicy('default'), run), ['chat']);
});

test('only vibe keeps the browser after browsing ends', () => {
  const after = { ...run, browsed: true };
  assert.ok(relevantTiles(layoutPolicy('vibe'), after).includes('browser'));
  assert.ok(!relevantTiles(layoutPolicy('default'), after).includes('browser'));
  assert.ok(!relevantTiles(layoutPolicy('technical'), after).includes('browser'));
});

test('the diff opens on ready in default, on the first change in technical, and never in vibe', () => {
  assert.equal(diffWanted(layoutPolicy('default'), 'implementing', true), false);
  assert.equal(diffWanted(layoutPolicy('default'), 'ready', true), true);
  assert.equal(diffWanted(layoutPolicy('technical'), 'implementing', true), true);
  assert.equal(diffWanted(layoutPolicy('vibe'), 'ready', true), false);
  assert.deepEqual(layoutReaction(layoutPolicy('technical'), 'diff'), [['focus', 'diff']]);
  assert.deepEqual(layoutReaction(layoutPolicy('default'), 'diff'), [['open', 'diff']]);
});

test('technical never puts the browser in full screen; vibe only when nothing else is busy', () => {
  assert.deepEqual(layoutReaction(layoutPolicy('technical'), 'browse'), [['open', 'browser']]);
  assert.deepEqual(layoutReaction(layoutPolicy('default'), 'browse', { busy: true }), [['full', 'browser']]);
  assert.deepEqual(layoutReaction(layoutPolicy('vibe'), 'browse'), [['full', 'browser']]);
  assert.deepEqual(layoutReaction(layoutPolicy('vibe'), 'browse', { busy: true }), [['open', 'browser']]);
  assert.deepEqual(layoutReaction(layoutPolicy('vibe'), 'browse', { full: 'games' }), [['open', 'browser']]);
});

test('questions bring the chat forward except in vibe, which pins an answer bar instead', () => {
  assert.deepEqual(layoutReaction(layoutPolicy('default'), 'question', { full: 'browser' }), [['exitFull'], ['show', 'chat']]);
  assert.deepEqual(layoutReaction(layoutPolicy('vibe'), 'question', { full: 'games' }), []);
  assert.deepEqual(layoutReaction(layoutPolicy('default'), 'said', { full: 'browser' }), [['exitFull'], ['show', 'chat']]);
  assert.deepEqual(layoutReaction(layoutPolicy('vibe'), 'said', { full: 'browser' }), []);
});

test('the settings preview follows the same rules as the run page', () => {
  assert.deepEqual(previewLayout('default', 2).visible, ['browser']);
  assert.deepEqual(previewLayout('default', 3).visible, ['chat', 'browser']);
  assert.deepEqual(previewLayout('default', 6).visible, ['chat', 'diff']);
  assert.deepEqual(previewLayout('technical', 1).visible, ['diff', 'chat']);
  assert.deepEqual(previewLayout('technical', 2).visible, ['diff', 'chat', 'browser']);
  assert.equal(previewLayout('vibe', 4).bar, true);
  assert.deepEqual(previewLayout('vibe', 6).visible, ['browser']);
});
