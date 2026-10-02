import test from 'node:test';
import assert from 'node:assert/strict';
import { highlight, languageFor } from '../web/lib/highlight.mjs';

const typed = tokens => tokens.filter(token => token.type).map(token => [token.type, token.text]);

test('highlight colours JavaScript tokens and keeps every character', () => {
  const text = "const total = sum(items.map(x => x.price), 0x1F); // 'done'";
  const tokens = highlight(text, languageFor('web/app.mjs'));
  assert.equal(tokens.map(token => token.text).join(''), text);
  assert.deepEqual(typed(tokens), [['keyword', 'const'], ['function', 'sum'], ['function', 'map'], ['number', '0x1F'], ['comment', "// 'done'"]]);
});
test('highlight picks rules by file type and leaves unknown files plain', () => {
  assert.deepEqual(typed(highlight('<Button size="sm">', 'jsx')), [['tag', 'Button'], ['string', '"sm"']]);
  assert.deepEqual(typed(highlight('  color: var(--x); /* x */', languageFor('a.css'))), [['property', 'color'], ['function', 'var'], ['comment', '/* x */']]);
  assert.deepEqual(typed(highlight('def run(): # go', languageFor('tool.py'))), [['keyword', 'def'], ['function', 'run'], ['comment', '# go']]);
  assert.deepEqual(typed(highlight('  "name": true', languageFor('package.json'))), [['property', '"name"'], ['keyword', 'true']]);
  assert.equal(languageFor('Dockerfile'), 'hash'); assert.equal(languageFor('notes.txt'), null);
  assert.deepEqual(highlight('<script>unsafe</script>', null), [{ text: '<script>unsafe</script>' }]);
  assert.deepEqual(highlight('', 'clike'), []);
});
