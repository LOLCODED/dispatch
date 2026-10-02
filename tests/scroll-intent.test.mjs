import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { scrollY: 0 };
globalThis.document ??= { documentElement: {} };
globalThis.Element ??= class {};
const { wheelListener } = await import('../web/lib/scroll-intent.js');

test('a wheel event inside the first gesture gap after page load still starts a gesture', () => {
  const fired = [], listener = wheelListener((direction, fromTop) => { fired.push([direction, fromTop]); return true; });
  listener({ deltaY: 120, timeStamp: 50, target: null });
  listener({ deltaY: 120, timeStamp: 90, target: null });
  listener({ deltaY: -120, timeStamp: 400, target: null });
  assert.deepEqual(fired, [['down', true], ['up', true]]);
});
