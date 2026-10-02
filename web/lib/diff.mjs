// Parse Git's unified patch as data. Metadata and binary changes remain visible.
export function parseDiff(patch = '') {
  const files = [];
  let file, before = 0, after = 0, inHunk = false, removed = [], added = [];
  const flush = () => {
    if (!file) return;
    for (let i = 0; i < Math.max(removed.length, added.length); i++) file.rows.push({ kind: 'change', before: removed[i] ?? null, after: added[i] ?? null });
    removed = []; added = [];
  };
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      file = { name: line.slice(11), beforePath: '', afterPath: '', metadata: [], rows: [], additions: 0, deletions: 0 };
      files.push(file); inHunk = false;
    } else if (!file) continue;
    else if (!inHunk && line.startsWith('--- ')) file.beforePath = line.slice(4);
    else if (!inHunk && line.startsWith('+++ ')) {
      file.afterPath = line.slice(4);
      file.name = (file.afterPath === '/dev/null' ? file.beforePath : file.afterPath).replace(/^[ab]\//, '');
    } else if (/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(line)) {
      flush();
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      before = Number(match[1]); after = Number(match[2]); inHunk = true;
      file.rows.push({ kind: 'hunk', text: line });
    } else if (inHunk && line.startsWith('-')) { removed.push({ number: before++, text: line.slice(1), changed: true }); file.deletions++; }
    else if (inHunk && line.startsWith('+')) { added.push({ number: after++, text: line.slice(1), changed: true }); file.additions++; }
    else if (inHunk && line.startsWith(' ')) {
      flush(); file.rows.push({ kind: 'context', before: { number: before++, text: line.slice(1) }, after: { number: after++, text: line.slice(1) } });
    } else if (inHunk && line.startsWith('\\')) { flush(); file.rows.push({ kind: 'note', text: line }); }
    else if (!inHunk && line) file.metadata.push(line);
  }
  flush(); return files;
}

export const lineReference = ({ file, line, endLine, text }) => `${file}:${line}${endLine && endLine !== line ? `-${endLine}` : ''}\n> ${text.trim().replaceAll('\n', '\n> ')}`;

// Changed files grouped by folder, in the order the patch lists them.
export function fileTree(files) {
  const folders = new Map();
  files.forEach((file, index) => {
    const slash = file.name.lastIndexOf('/'), folder = slash < 0 ? '' : file.name.slice(0, slash);
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push({ index, name: file.name.slice(slash + 1), path: file.name, additions: file.additions, deletions: file.deletions });
  });
  return [...folders].map(([folder, entries]) => ({ folder, files: entries }));
}

export function diffstat(additions, deletions, blocks = 5) {
  const total = additions + deletions;
  if (!total) return Array(blocks).fill('neutral');
  const added = Math.round(blocks * additions / total), removed = Math.min(blocks - added, Math.round(blocks * deletions / total));
  return Array.from({ length: blocks }, (_, index) => index < added ? 'added' : index < added + removed ? 'removed' : 'neutral');
}
