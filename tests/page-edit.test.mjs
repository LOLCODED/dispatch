import test from 'node:test';
import assert from 'node:assert/strict';
import { axisOf, describeElement, dropTarget, editLine, elementAt, imagePoint, pagePath, percentBox, sameTarget } from '../web/lib/page-edit.mjs';

const element = (tag, text, selector, x, y, width, height) => ({ tag, text, selector, box: { x, y, width, height } });
const section = element('section', 'Pricing', 'main > section:nth-of-type(2)', 0, 400, 1280, 400);
const heading = element('h2', 'Pricing', 'main > section:nth-of-type(2) > h2', 100, 420, 400, 40);
const paragraph = element('p', 'Plans for every team', 'main > section:nth-of-type(2) > p', 100, 480, 600, 24);
const buttonA = element('a', 'Get started', 'main > section:nth-of-type(2) > div > a:nth-of-type(1)', 100, 520, 140, 40);
const buttonB = element('a', 'Talk to sales', 'main > section:nth-of-type(2) > div > a:nth-of-type(2)', 260, 520, 140, 40);
const elements = [section, heading, paragraph, buttonA, buttonB];

test('the innermost element wins and a dragged element with its contents never becomes a target', () => {
  assert.equal(elementAt(elements, { x: 120, y: 430 }), heading);
  assert.equal(elementAt(elements, { x: 900, y: 700 }), section);
  assert.equal(elementAt(elements, { x: 2000, y: 2000 }), null);
  assert.equal(elementAt(elements, { x: 120, y: 430 }, heading), section);
  assert.equal(elementAt(elements, { x: 120, y: 430 }, section), null);
});

test('drop position follows the layout axis of the target and its siblings', () => {
  assert.equal(axisOf(heading, elements), 'vertical'); assert.equal(axisOf(buttonA, elements), 'horizontal');
  assert.deepEqual(dropTarget(elements, { x: 120, y: 425 }, paragraph), { element: heading, position: 'before', axis: 'vertical' });
  assert.deepEqual(dropTarget(elements, { x: 120, y: 455 }, paragraph), { element: heading, position: 'after', axis: 'vertical' });
  assert.deepEqual(dropTarget(elements, { x: 110, y: 540 }, paragraph), { element: buttonA, position: 'before', axis: 'horizontal' });
  assert.deepEqual(dropTarget(elements, { x: 230, y: 540 }, paragraph), { element: buttonA, position: 'after', axis: 'horizontal' });
  assert.equal(dropTarget(elements, { x: 5000, y: 5000 }), null);
  assert.ok(sameTarget({ element: heading, position: 'after' }, { element: heading, position: 'after' }));
  assert.ok(!sameTarget({ element: heading, position: 'after' }, { element: heading, position: 'before' }));
  assert.ok(sameTarget(null, null)); assert.ok(!sameTarget(null, { element: heading, position: 'after' }));
});

test('edit lines name the elements, the component and the page', () => {
  assert.equal(describeElement(heading), '<h2> “Pricing” (main > section:nth-of-type(2) > h2)');
  assert.equal(describeElement(element('img', '', 'header > img', 0, 0, 10, 10)), '<img> (header > img)');
  assert.equal(editLine({ kind: 'move', element: heading, target: buttonA, position: 'after', url: 'http://127.0.0.1:5173/pricing?plan=team' }), 'Move <h2> “Pricing” (main > section:nth-of-type(2) > h2) to after <a> “Get started” (main > section:nth-of-type(2) > div > a:nth-of-type(1)) on /pricing?plan=team.');
  assert.equal(editLine({ kind: 'insert', component: { name: 'Testimonials', path: 'src/components/Testimonials.tsx' }, target: section, position: 'before', url: 'http://127.0.0.1:5173/' }), 'Insert the Testimonials component (src/components/Testimonials.tsx) before <section> “Pricing” (main > section:nth-of-type(2)) on /.');
  assert.equal(editLine({ kind: 'select', element: paragraph, url: null }), 'Selected <p> “Plans for every team” (main > section:nth-of-type(2) > p).');
  assert.equal(pagePath('not a url'), '');
});

test('boxes map to percentages of the screenshot and pointer positions map back to its pixels', () => {
  assert.deepEqual(percentBox({ x: 320, y: 200, width: 640, height: 400 }, { width: 1280, height: 800 }), { left: '25%', top: '25%', width: '50%', height: '50%' });
  assert.deepEqual(imagePoint({ x: 150, y: 120 }, { left: 100, top: 20, width: 640, height: 400 }, { width: 1280, height: 800 }), { x: 100, y: 200 });
});
