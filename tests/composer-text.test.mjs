import test from 'node:test';
import assert from 'node:assert/strict';
import { attachPastedText, composerText, ticketTextLimit } from '../web/lib/composer-text.mjs';

test('attached pasted text preserves instructions and previous attachments while replacing the selection', () => {
  const pasted = 'Long pasted context\n'.repeat(100);
  const next = attachPastedText('Before selected after', ['First attachment'], pasted, 7, 15);
  assert.equal(next.visible, 'Before  after');
  assert.equal(composerText(next.visible, next.attachments), `Before  after\n\nFirst attachment\n\n${pasted}`);
});

test('attachment-only tickets retain the full text and oversized pastes are rejected without truncation', () => {
  const text = 'x'.repeat(ticketTextLimit);
  const next = attachPastedText('', [], text, 0, 0);
  assert.equal(composerText(next.visible, next.attachments), text);
  assert.equal(attachPastedText('Instructions', [], text, 0, 0), null);
  assert.equal(attachPastedText('', [text], 'more', 0, 0), null);
});
