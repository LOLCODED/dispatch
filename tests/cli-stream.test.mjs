import test from 'node:test';
import assert from 'node:assert/strict';
import { browserPointer, browserTool } from '../src/cli-stream.mjs';

test('browser tools include Chrome automation servers', () => {
  assert.ok(browserTool('mcp__claude-in-chrome__computer')); assert.ok(browserTool('playwright/browser_click')); assert.ok(!browserTool('mcp__github__create_pr'));
});

test('browser pointers are read from coordinate arrays and x/y arguments only when valid', () => {
  assert.deepEqual(browserPointer('computer', { action: 'left_click', coordinate: [10.6, 20] }), { x: 11, y: 20, action: 'left_click' });
  assert.deepEqual(browserPointer('browser_mouse_move_xy', { x: 1, y: 2 }), { x: 1, y: 2, action: 'move' });
  assert.deepEqual(browserPointer('browser_scroll', { x: 0, y: 0 }), { x: 0, y: 0, action: 'pointer' });
  for (const input of [null, 'x', {}, { coordinate: [1] }, { coordinate: ['1', 2] }, { x: NaN, y: 1 }, { x: -1, y: 1 }, { x: 1, y: 20001 }, { ref: 'e12' }]) assert.equal(browserPointer('browser_click', input), null);
});
