const serve = `import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  const file = path === '/' ? 'index.html' : path.slice(1);
  try {
    const body = await readFile(join('public', file));
    response.setHeader('content-type', types[extname(file)] ?? 'text/plain');
    response.end(body);
  } catch {
    response.statusCode = 404; response.end('Not found');
  }
}).listen(Number(process.env.PORT) || 3000, '127.0.0.1');
`;

const todos = `export const add = (list, text) => text.trim() ? [...list, { id: crypto.randomUUID(), text: text.trim(), done: false }] : list;
export const toggle = (list, id) => list.map(todo => todo.id === id ? { ...todo, done: !todo.done } : todo);
export const remaining = list => list.filter(todo => !todo.done).length;
`;

const filteredTodos = `${todos}export const visible = (list, filter) => filter === 'active' ? list.filter(todo => !todo.done) : filter === 'done' ? list.filter(todo => todo.done) : list;
`;

const test = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add, remaining, toggle } from '../public/todos.mjs';

test('adds, toggles and counts todos', () => {
  const list = add(add([], 'Buy oat milk'), 'Book dentist');
  assert.equal(remaining(toggle(list, list[0].id)), 1);
  assert.equal(add(list, '   ').length, 2);
});
`;

const style = `:root { font-family: ui-sans-serif, system-ui, sans-serif; color: #1c1917; background: #f5f5f4; }
body { margin: 0; display: grid; place-items: start center; min-height: 100vh; }
main { width: min(440px, 100% - 32px); margin-top: 56px; background: #fff; border: 1px solid #e7e5e4; border-radius: 10px; padding: 24px; }
h1 { margin: 0 0 16px; font-size: 22px; letter-spacing: -0.01em; }
form { display: flex; gap: 8px; }
input[type=text] { flex: 1; font: inherit; padding: 9px 12px; border: 1px solid #d6d3d1; border-radius: 6px; }
button { font: inherit; padding: 9px 14px; border: 0; border-radius: 6px; background: #1c1917; color: #fff; cursor: pointer; }
ul { list-style: none; padding: 0; margin: 16px 0 0; }
li { display: flex; align-items: center; gap: 10px; padding: 10px 2px; border-top: 1px solid #f0efee; }
li.done span { color: #a8a29e; text-decoration: line-through; }
footer { display: flex; justify-content: space-between; align-items: center; margin-top: 14px; color: #78716c; font-size: 14px; }
.filters { display: flex; gap: 4px; }
.filters button { background: transparent; color: #57534e; padding: 4px 10px; }
.filters button[aria-pressed=true] { background: #f5f5f4; color: #1c1917; font-weight: 600; }
`;

const page = filters => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Todos</title><link rel="stylesheet" href="style.css"></head>
<body>
<main>
  <h1>Todos</h1>
  <form id="new"><input id="text" type="text" placeholder="What needs doing?" aria-label="New todo"><button>Add</button></form>
  <ul id="list"></ul>
  <footer><span id="count"></span>${filters ? `<div class="filters" role="group" aria-label="Filter"><button type="button" data-filter="all" aria-pressed="true">All</button><button type="button" data-filter="active" aria-pressed="false">Active</button><button type="button" data-filter="done" aria-pressed="false">Done</button></div>` : ''}</footer>
</main>
<script type="module" src="app.mjs"></script>
</body>
</html>
`;

const app = filters => `import { add, remaining, toggle${filters ? ', visible' : ''} } from './todos.mjs';

let list = add(add(add([], 'Buy oat milk'), 'Book the dentist'), 'Water the plants');
list = toggle(list, list[2].id);${filters ? `\nlet filter = 'all';` : ''}

function render() {
  const items = ${filters ? 'visible(list, filter)' : 'list'}.map(todo => {
    const item = document.createElement('li'), box = document.createElement('input'), text = document.createElement('span');
    box.type = 'checkbox'; box.checked = todo.done; box.setAttribute('aria-label', todo.text);
    box.addEventListener('change', () => { list = toggle(list, todo.id); render(); });
    text.textContent = todo.text; item.className = todo.done ? 'done' : '';
    item.append(box, text); return item;
  });
  document.querySelector('#list').replaceChildren(...items);
  document.querySelector('#count').textContent = remaining(list) + ' left';
}

document.querySelector('#new').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.querySelector('#text');
  list = add(list, input.value); input.value = ''; render();
});${filters ? `
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  render();
}));` : ''}
render();
`;

export const baseFiles = {
  'package.json': JSON.stringify({ name: 'todo-app', private: true, type: 'module', scripts: { dev: 'node serve.mjs', test: 'node --test' } }, null, 2) + '\n',
  '.gitignore': 'node_modules\n',
  'serve.mjs': serve,
  'public/index.html': page(false),
  'public/app.mjs': app(false),
  'public/todos.mjs': todos,
  'public/style.css': style,
  'test/todos.test.mjs': test,
};

export const filterFiles = {
  'public/index.html': page(true),
  'public/app.mjs': app(true),
  'public/todos.mjs': filteredTodos,
};
