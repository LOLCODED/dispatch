import { Select } from '@/components/Select';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown, Columns2, Copy, FolderTree, Plus, Rows3 } from 'lucide-react';
import { diffstat, fileTree, lineReference, parseDiff } from '@/lib/diff.mjs';
import { highlight, languageFor } from '@/lib/highlight.mjs';
import { referenceType } from '@/components/run/Artifacts';
import { IconButton } from '@/components/IconButton';

function startDrag(event, reference) {
  event.dataTransfer.setData(referenceType, lineReference(reference));
  event.dataTransfer.setData('text/plain', lineReference(reference));
  event.dataTransfer.effectAllowed = 'copy';
}

function referenceProps(reference, onReference, selection) {
  if (!reference) return {};
  return { draggable: true, tabIndex: 0, 'aria-label': `Reference ${reference.file} line ${reference.line} in chat`, 'aria-keyshortcuts': 'Enter', title: 'Click, then Shift-click another line to select a range; drag into chat or press Enter',
    onMouseDown: event => { if (event.shiftKey) event.preventDefault(); },
    onClick: event => selection.select(reference, event.shiftKey),
    onDragStart: event => startDrag(event, selection.reference(reference)), onKeyDown: event => {
      if (event.key === 'Enter') { event.preventDefault(); onReference(selection.reference(reference)); }
      if (event.key === ' ') { event.preventDefault(); selection.select(reference, event.shiftKey); }
      if (event.key === 'Escape') selection.clear();
    } };
}

function Code({ text, language }) {
  return <code>{highlight(text, language).map((token, index) => token.type ? <span className={`syntax-${token.type}`} key={index}>{token.text}</span> : token.text)}</code>;
}

function Line({ line, side, file, language, onReference, selection, addable }) {
  const reference = line && onReference ? { file, line: line.number, text: line.text, side } : null;
  const add = event => { event.stopPropagation(); onReference(selection.reference(reference)); };
  return <div className={`diff-line ${line?.changed ? side : ''} ${!line ? 'diff-empty' : ''} ${reference ? 'referable' : ''} ${reference && selection.includes(reference) ? 'is-selected' : ''}`} {...referenceProps(reference, onReference, selection)}>
    <span className="diff-number">{line?.number}</span>
    {addable && reference && <button type="button" className="diff-add" tabIndex={-1} aria-label={`Add ${file} line ${line.number} to chat`} onClick={add}><Plus size={12} aria-hidden="true"/></button>}
    <span className="diff-sign" aria-hidden="true">{line?.changed ? side === 'before' ? '−' : '+' : ' '}</span><Code text={line?.text} language={language}/>
  </div>;
}

function Rows({ file, unified, onReference, addable = false }) {
  const [range, setRange] = useState(null);
  const active = range?.rows === file.rows ? range : null;
  const includes = reference => active && reference.side === active.anchor.side && reference.line >= Math.min(active.anchor.line, active.end.line) && reference.line <= Math.max(active.anchor.line, active.end.line);
  const selection = {
    includes,
    clear: () => setRange(null),
    select: (reference, extend) => setRange({ rows: file.rows, anchor: extend && active?.anchor.side === reference.side ? active.anchor : reference, end: reference }),
    reference: reference => {
      if (!includes(reference)) return reference;
      const lines = file.rows.flatMap(row => row[reference.side] && includes({ side: reference.side, line: row[reference.side].number }) ? [row[reference.side]] : []);
      return { ...reference, line: lines[0].number, endLine: lines.at(-1).number, text: lines.map(line => line.text).join('\n') };
    },
  };
  const props = { file: file.name, language: languageFor(file.name), onReference, selection, addable };
  return file.rows.map((row, index) => {
    if (row.kind === 'hunk' || row.kind === 'note') return <div className={`diff-${row.kind}`} key={index}>{row.text}</div>;
    if (!unified) return <div className={`diff-row ${row.kind}`} key={index}><Line line={row.before} side="before" {...props}/><Line line={row.after} side="after" {...props}/></div>;
    if (row.kind === 'context') return <div className="diff-row context" key={index}><Line line={row.after} side="after" {...props}/></div>;
    return <div className="diff-row change" key={index}>{row.before && <Line line={row.before} side="before" {...props}/>}{row.after && <Line line={row.after} side="after" {...props}/>}</div>;
  });
}

function Output({ file, unified, onReference, addable }) {
  return <div className={`diff-output ${unified ? 'diff-unified' : 'diff-split'}`} aria-label={`Changes in ${file.name}`}>
    {!unified && <div className="diff-column-head"><span>Before</span><span>After</span></div>}
    <Rows file={file} unified={unified} onReference={onReference} addable={addable}/>
  </div>;
}

const sectionRef = sections => name => element => { if (element) sections.current.set(name, element); else sections.current.delete(name); };
const Counts = ({ file }) => <span className="diff-count"><span>+{file.additions}</span><span>−{file.deletions}</span></span>;
const UnifiedToggle = ({ unified, setUnified }) => <IconButton label="Unified view" icon={unified ? Columns2 : Rows3} aria-pressed={unified} onClick={() => setUnified(!unified)}/>;

function CompactDiff({ files, unified, setUnified, onReference, actions }) {
  const sections = useRef(new Map()), selectId = useId(), [selected, setSelected] = useState(0);
  const index = Math.min(selected, files.length - 1), file = files[index];
  const jumpToFile = event => {
    const position = Number(event.target.value);
    setSelected(position);
    const section = sections.current.get(files[position]?.name);
    if (section) { section.open = true; section.scrollIntoView({ block: 'start', behavior: 'instant' }); }
  };
  return <>
    <div className="diff-toolbar">
      {files.length > 1 ? <><label htmlFor={selectId} className="sr-only">Changed file</label><Select id={selectId} value={index} onChange={jumpToFile}>{files.map((item, position) => <option value={position} key={item.name}>{item.name}</option>)}</Select></> : <span className="diff-file-name">{file.name}</span>}
      <UnifiedToggle unified={unified} setUnified={setUnified}/>
      {actions}
    </div>
    {files.map(item => <details className="diff-file" key={item.name} open ref={sectionRef(sections)(item.name)}>
      <summary><span className="diff-file-name" title={item.name}>{item.name}</span><Counts file={item}/></summary>
      {!item.rows.length && !!item.metadata.length && <p className="diff-metadata">{item.metadata.join('\n')}</p>}
      <Output file={item} unified={unified} onReference={onReference}/>
    </details>)}
  </>;
}

function FileTree({ files, onJump }) {
  return <nav className="diff-tree" aria-label="Changed files">{fileTree(files).map(({ folder, files: entries }) => <div key={folder} className="diff-tree-folder">
    {folder && <span className="diff-tree-path">{folder}</span>}
    {entries.map(entry => <button type="button" key={entry.path} className="diff-tree-file" title={entry.path} onClick={() => onJump(entry.path)}><span>{entry.name}</span><Counts file={entry}/></button>)}
  </div>)}</nav>;
}

function PrFile({ file, unified, onReference, register }) {
  const [open, setOpen] = useState(true);
  const copy = () => navigator.clipboard?.writeText(file.name).catch(() => {});
  return <section className={`pr-file ${open ? '' : 'is-collapsed'}`} ref={register}>
    <header className="pr-file-head">
      <IconButton label={open ? `Collapse ${file.name}` : `Expand ${file.name}`} icon={ChevronDown} aria-expanded={open} onClick={() => setOpen(!open)}/>
      <span className="diff-file-name" title={file.name}>{file.name}</span>
      <IconButton label="Copy path" icon={Copy} onClick={copy}/>
      <Counts file={file}/>
      <span className="diffstat" aria-hidden="true">{diffstat(file.additions, file.deletions).map((kind, index) => <i key={index} className={kind}/>)}</span>
    </header>
    {open && !file.rows.length && !!file.metadata.length && <p className="diff-metadata">{file.metadata.join('\n')}</p>}
    {open && <Output file={file} unified={unified} onReference={onReference} addable/>}
  </section>;
}

function PrDiff({ files, wide, unified, setUnified, onReference, actions }) {
  const sections = useRef(new Map()), [treeChoice, setTreeChoice] = useState(null), tree = treeChoice ?? wide;
  const add = files.reduce((sum, file) => sum + file.additions, 0), remove = files.reduce((sum, file) => sum + file.deletions, 0);
  const jump = name => sections.current.get(name)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  return <div className={`pr-diff ${tree ? 'has-tree' : ''}`}>
    <div className="pr-summary">
      <IconButton label={tree ? 'Hide the file tree' : 'Show the file tree'} icon={FolderTree} aria-pressed={tree} onClick={() => setTreeChoice(!tree)}/>
      <span>{files.length} {files.length === 1 ? 'file' : 'files'} changed</span>
      <span className="diff-count"><span>+{add}</span><span>−{remove}</span></span>
      <span className="pr-summary-actions"><UnifiedToggle unified={unified} setUnified={setUnified}/>{actions}</span>
    </div>
    {tree && <FileTree files={files} onJump={jump}/>}
    <div className="pr-files">{files.map(file => <PrFile key={file.name} file={file} unified={unified} onReference={onReference} register={sectionRef(sections)(file.name)}/>)}</div>
  </div>;
}

function useWidth() {
  const ref = useRef(null), [width, setWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

const prWidth = 640, treeWidth = 900;

// Narrow tiles keep the compact list; wider ones read like a pull request, with the file tree beside the files once there is room.
export function DiffView({ patch, onReference, defaultUnified = false, actions = null }) {
  const files = useMemo(() => parseDiff(patch), [patch]);
  const [unified, setUnified] = useState(defaultUnified), [ref, width] = useWidth();
  const props = { files, unified, setUnified, onReference, actions };
  return <div className="diff-view" ref={ref}>
    {!files.length ? <p className="muted">{patch ? 'Patch preview is unavailable. Open the raw patch.' : 'No changes from the base commit yet.'}</p>
      : width >= prWidth ? <PrDiff {...props} wide={width >= treeWidth}/> : <CompactDiff {...props}/>}
  </div>;
}
