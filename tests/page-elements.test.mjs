import test from 'node:test';
import assert from 'node:assert/strict';
import { boundElements } from '../src/browser-tool.mjs';

test('page elements are validated, clipped and kept within the step line budget', () => {
  assert.equal(boundElements(undefined), null); assert.deepEqual(boundElements([]), []);
  const kept = boundElements([
    { tag: 'h1', text: 'Hello', selector: 'h1', box: { x: 10.4, y: 20.6, width: 300, height: 40 } },
    { tag: 'div', role: 'button', text: 'x'.repeat(100), selector: 's'.repeat(200), box: { x: 0, y: 0, width: 1, height: 1 } },
    { tag: 'p', text: 'no box' }, { tag: 7, box: { x: 0, y: 0, width: 1, height: 1 } }, { tag: 'a', box: { x: 'nan', y: 0, width: 1, height: 1 } }, null,
  ]);
  assert.deepEqual(kept, [
    { tag: 'h1', text: 'Hello', selector: 'h1', box: { x: 10, y: 21, width: 300, height: 40 } },
    { tag: 'div', role: 'button', text: 'x'.repeat(60), selector: 's'.repeat(160), box: { x: 0, y: 0, width: 1, height: 1 } },
  ]);
  const many = boundElements(Array.from({ length: 500 }, (_, index) => ({ tag: 'p', text: `Paragraph ${index} ${'y'.repeat(50)}`, selector: `main > p:nth-of-type(${index + 1})`, box: { x: 0, y: index * 30, width: 1200, height: 24 } })));
  assert.ok(many.length > 0 && many.length <= 120); assert.ok(JSON.stringify(many).length <= 12_000);
  assert.equal(many[0].text, `Paragraph 0 ${'y'.repeat(50)}`.slice(0, 60));
});
