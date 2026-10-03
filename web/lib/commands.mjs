const forget = /^\/forget(?:\s+([\s\S]+))?$/, todo = /^\/todo(?:\s+([\s\S]+))?$/;

export function parseCommand(input) {
  const text = String(input ?? '').trim();
  const saved = todo.exec(text);
  if (saved) return { name: 'todo', text: (saved[1] ?? '').trim() };
  if (text.includes('\n')) return null;
  const match = forget.exec(text);
  if (!match) return null;
  return { name: 'forget', text: (match[1] ?? '').trim() };
}

const prefix = /^(\s*)(\/(?:todo|forget))/;

export function commandToken(input) {
  const text = String(input ?? '');
  if (!parseCommand(text)) return null;
  const [, lead, name] = prefix.exec(text);
  return { lead, name, rest: text.slice(lead.length + name.length) };
}
