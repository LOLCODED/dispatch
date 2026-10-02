// Line-at-a-time syntax colouring for diffs. Tokens are plain text; state such as block comments does not carry across lines.
const words = list => String.raw`(?<![\w$.])(?:${list.trim().split(/\s+/).join('|')})(?![\w$])`;
const blockComment = String.raw`\/\*.*?(?:\*\/|$)`;
const doubleQuoted = String.raw`"(?:\\.|[^"\\])*"?`;
const quoted = String.raw`${doubleQuoted}|'(?:\\.|[^'\\])*'?`;
const template = String.raw`\`(?:\\.|[^\`\\])*\`?`;
const number = String.raw`(?<![\w$.])(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)n?(?![\w$])`;
const call = String.raw`(?<![\w$])[A-Za-z_$][\w$]*(?=\s*\()`;
const type = String.raw`(?<![\w$])[A-Z][\w$]*`;

const clikeWords = words(`
  abstract as async await break case catch class const continue debugger default defer delete do else enum export extends
  false final finally fn for from func function go if impl implements import in instanceof interface let match mod mut new
  null nil of package private protected pub public return self static struct super switch this throw throws trait true try
  typeof undefined use var void where while yield`);
const hashWords = words(`
  and as assert async await begin break case class continue def del do done elif else elsif end ensure esac except export
  False fi finally for from function global if import in is lambda local module nil None nonlocal not or pass raise require
  rescue return self then True try unless until while with yield`);
const sqlWords = words(`
  add all alter and as asc begin by case check column commit constraint create default delete desc distinct drop else end
  exists foreign from group having if in index inner insert into is join key left like limit not null offset on or order
  outer primary references returning right rollback select set table then transaction union unique update values view when
  where with`);

const clike = { comment: String.raw`\/\/.*|${blockComment}`, string: `${quoted}|${template}`, keyword: clikeWords, number, function: call, type };
const rules = {
  clike,
  jsx: { comment: clike.comment, string: clike.string, tag: String.raw`(?<=<\/?)[A-Za-z][\w.-]*`, keyword: clikeWords, number, function: call, type },
  hash: { comment: '#.*', string: quoted, keyword: hashWords, number, function: call },
  css: { comment: blockComment, string: quoted, keyword: String.raw`@[\w-]+|!important`, property: String.raw`(?<=^\s*|[{;]\s*)(?<![\w-])-{0,2}[\w-]+(?=\s*:[^{]*$)`, number: String.raw`#[\da-fA-F]{3,8}(?![\w-])|(?<![\w#-])\d*\.?\d+(?:%|[a-zA-Z]+)?`, function: String.raw`(?<![\w-])[\w-]+(?=\()` },
  markup: { comment: String.raw`<!--.*?(?:-->|$)`, tag: String.raw`(?<=<\/?)[\w:-]+`, attr: String.raw`(?<=\s)[\w:.@-]+(?==)`, string: String.raw`(?<==\s*)(?:"[^"]*"?|'[^']*'?)` },
  json: { comment: clike.comment, property: String.raw`${doubleQuoted}(?=\s*:)`, string: doubleQuoted, keyword: words('true false null'), number },
  yaml: { comment: String.raw`(?<=^|\s)[#;].*`, type: String.raw`^\s*\[\[?[^\]]*\]\]?`, property: String.raw`(?<=^\s*(?:-\s+)?)[\w.-]+(?=\s*[:=](?:\s|$))`, string: quoted, keyword: words('true false null yes no on off'), number },
  sql: { comment: String.raw`--.*|${blockComment}`, string: quoted, keyword: sqlWords, number, function: call },
  markdown: { keyword: String.raw`^#{1,6}\s.*`, number: String.raw`^\s*(?:[-*+]|\d+\.)(?=\s)`, string: '`[^`]*`?', function: String.raw`\[[^\]]*\]\([^)]*\)` },
};
const patterns = Object.fromEntries(Object.entries(rules).map(([language, groups]) => [language,
  new RegExp(Object.entries(groups).map(([name, source]) => `(?<${name}>${source})`).join('|'), language === 'sql' ? 'gi' : 'g')]));

const extensions = Object.fromEntries(Object.entries({
  clike: 'js mjs cjs ts mts cts java c h cc cpp hpp cs go rs swift kt kts scala dart php groovy',
  jsx: 'jsx tsx',
  hash: 'py rb sh bash zsh fish ps1 pl r mk dockerfile makefile gemfile rakefile gitignore dockerignore env',
  css: 'css scss less',
  markup: 'html htm xml svg vue svelte',
  json: 'json jsonc',
  yaml: 'yml yaml toml ini cfg conf',
  sql: 'sql',
  markdown: 'md mdx markdown',
}).flatMap(([language, list]) => list.split(' ').map(extension => [extension, language])));

export function languageFor(path = '') {
  const name = path.split('/').pop().toLowerCase();
  return extensions[name.split('.').pop()] ?? null;
}

const longestHighlightedLine = 2000;

export function highlight(text = '', language = null) {
  const pattern = patterns[language];
  if (!pattern || !text || text.length > longestHighlightedLine) return text ? [{ text }] : [];
  const tokens = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) tokens.push({ text: text.slice(last, match.index) });
    tokens.push({ text: match[0], type: Object.keys(match.groups).find(name => match.groups[name] !== undefined) });
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return tokens;
}
