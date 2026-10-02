import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Download, FileArchive, MessageSquarePlus, SquareDashedMousePointer, Undo2, X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { PageEditor } from '@/components/run/PageEditor';
import { stepThrough } from '@/lib/evidence.mjs';
import { percentBox } from '@/lib/page-edit.mjs';

export const referenceType = 'application/x-dispatch-reference';

export const artifactUrl = (runId, artifact) => `/api/runs/${runId}/artifacts/${artifact.id}`;
export const isImage = artifact => artifact.mimeType?.startsWith('image/');
export const pointerLabel = ({ action, x, y }) => `${action.replace(/_/g, ' ')} at ${x}, ${y}`;
export const artifactReference = artifact => `Screenshot: ${artifact.name} (${artifact.check ?? 'evidence'}, attempt ${artifact.attempt ?? 1})`;

function startDrag(event, artifact) {
  event.dataTransfer.setData(referenceType, artifactReference(artifact));
  event.dataTransfer.setData('text/plain', artifactReference(artifact));
  event.dataTransfer.effectAllowed = 'copy';
}

function ArtifactDetails({ artifact }) {
  return <>{artifact.check} · attempt {artifact.attempt}{artifact.pointer && ` · ${pointerLabel(artifact.pointer)}`}</>;
}

export function PointerImage({ src, artifact, target = null, ...props }) {
  const [size, setSize] = useState(null), { pointer } = artifact;
  const inside = pointer && size && pointer.x <= size.width && pointer.y <= size.height;
  const box = target && size && target.width > 0 ? percentBox(target, size) : null;
  return <span className="pointer-frame">
    <img src={src} alt={artifact.name} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} {...props}/>
    {inside && <span className="agent-cursor" style={{ left: `${pointer.x / size.width * 100}%`, top: `${pointer.y / size.height * 100}%` }} aria-hidden="true"/>}
    {box && <span className="target-box" style={box} aria-hidden="true"/>}
  </span>;
}

function ArtifactThumb({ runId, artifact, onOpen }) {
  const url = artifactUrl(runId, artifact), caption = <><span>{artifact.name}</span><small><ArtifactDetails artifact={artifact}/></small></>;
  if (!isImage(artifact)) return <a className="artifact" href={url} download><span className="artifact-file"><FileArchive aria-hidden="true"/></span>{caption}</a>;
  return <button type="button" className="artifact" draggable onDragStart={event => startDrag(event, artifact)} onClick={() => onOpen?.({ runId, artifact })} aria-label={`Preview ${artifact.name}`}>
    <img src={`${url}?inline`} alt="" loading="lazy" draggable={false}/>{caption}
  </button>;
}

const openWithin = (onOpen, artifacts) => preview => onOpen?.({ ...preview, items: artifacts.filter(isImage) });

export function ArtifactGallery({ runId, artifacts, onOpen }) {
  if (!artifacts.length) return <p className="muted">Screenshots, videos, and traces appear when browser checks return them.</p>;
  return <div className="artifact-gallery">{artifacts.map(artifact => <ArtifactThumb key={artifact.id} runId={runId} artifact={artifact} onOpen={openWithin(onOpen, artifacts)}/>)}</div>;
}

const collapsedEvidence = 8;

function EvidenceTile({ runId, artifact, onOpen }) {
  const url = artifactUrl(runId, artifact);
  if (!isImage(artifact)) return <a className="evidence-tile evidence-file" href={url} download title={artifact.name} aria-label={`Download ${artifact.name}`}><FileArchive size={16} aria-hidden="true"/><span>{artifact.name.split('.').pop()}</span></a>;
  return <button type="button" className="evidence-tile" draggable onDragStart={event => startDrag(event, artifact)} onClick={() => onOpen({ runId, artifact })} title={artifact.name} aria-label={`Preview ${artifact.name}`}><img src={`${url}?inline`} alt="" loading="lazy" draggable={false}/></button>;
}

export function EvidenceGroup({ runId, artifacts, onOpen }) {
  const [expanded, setExpanded] = useState(false), hidden = expanded ? 0 : Math.max(0, artifacts.length - collapsedEvidence);
  const open = openWithin(onOpen, artifacts);
  return <div className="evidence-grid">
    {artifacts.slice(0, artifacts.length - hidden).map(artifact => <EvidenceTile key={artifact.id} runId={runId} artifact={artifact} onOpen={open}/>)}
    {hidden > 0 && <button type="button" className="evidence-tile evidence-more" onClick={() => setExpanded(true)} aria-label={`Show ${hidden} more`}>+{hidden}</button>}
  </div>;
}

function LightboxNavigation({ items, artifact, onStep }) {
  if (!items || items.length < 2) return null;
  return <span className="lightbox-navigation">
    <IconButton label="Previous screenshot" icon={ChevronLeft} onClick={() => onStep(-1)}/>
    <small>{items.findIndex(item => item.id === artifact.id) + 1} / {items.length}</small>
    <IconButton label="Next screenshot" icon={ChevronRight} onClick={() => onStep(1)}/>
  </span>;
}

function EditActions({ editing, edits, onEditing, onEdits, onAdd }) {
  const count = edits.length;
  return <>
    <IconButton label={editing ? 'Stop editing' : 'Edit the page'} icon={SquareDashedMousePointer} aria-pressed={editing} onClick={() => onEditing(!editing)}/>
    {editing && count > 0 && <IconButton label="Remove last edit" icon={Undo2} onClick={() => onEdits(edits.slice(0, -1))}/>}
    {editing && <IconButton label={`Add ${count} edit${count === 1 ? '' : 's'} to the reply`} icon={MessageSquarePlus} disabled={!count} onClick={onAdd}/>}
  </>;
}

const editHint = 'drag an element to move it, drop a component to insert it, click an element to mention it';

export function Lightbox({ preview, onClose, onReference, onNavigate }) {
  const closeRef = useRef(null), open = Boolean(preview), [editing, setEditing] = useState(false), [edits, setEdits] = useState([]);
  const editable = Boolean(preview?.step?.elements?.length);
  const step = delta => preview?.items && onNavigate({ ...preview, artifact: stepThrough(preview.items, preview.artifact, delta) });
  const stepRef = useRef(step); stepRef.current = step;
  useEffect(() => { setEditing(false); setEdits([]); }, [preview?.artifact.id]);
  useEffect(() => { if (open) closeRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = event => { if (event.key === 'Escape') onClose(); else if (event.key === 'ArrowLeft') stepRef.current(-1); else if (event.key === 'ArrowRight') stepRef.current(1); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);
  return <AnimatePresence>{preview && <motion.div className="lightbox" role="dialog" aria-modal="true" aria-label={`Preview of ${preview.artifact.name}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.figure initial={{ scale: 0.96, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 12 }}>
      {editing && editable
        ? <PageEditor key={preview.artifact.id} runId={preview.runId} src={`${artifactUrl(preview.runId, preview.artifact)}?inline`} artifact={preview.artifact} step={preview.step} edits={edits} onEdits={setEdits}/>
        : <PointerImage key={preview.artifact.id} src={`${artifactUrl(preview.runId, preview.artifact)}?inline`} artifact={preview.artifact} draggable onDragStart={event => startDrag(event, preview.artifact)}/>}
      <figcaption>
        <span><strong>{preview.artifact.name}</strong><small><ArtifactDetails artifact={preview.artifact}/> · {editing && editable ? editHint : 'drag into the chat to reference it'}</small></span>
        <span className="lightbox-actions">
          <LightboxNavigation items={preview.items} artifact={preview.artifact} onStep={step}/>
          {editable && <EditActions editing={editing} edits={edits} onEditing={setEditing} onEdits={setEdits} onAdd={() => { onReference(edits.join('\n')); onClose(); }}/>}
          {!(editing && editable) && <IconButton label="Reference in chat" icon={MessageSquarePlus} onClick={() => { onReference(artifactReference(preview.artifact)); onClose(); }}/>}
          <IconButton label="Download" icon={Download} href={artifactUrl(preview.runId, preview.artifact)} download/>
          <IconButton ref={closeRef} label="Close preview" icon={X} onClick={onClose}/>
        </span>
      </figcaption>
    </motion.figure>
  </motion.div>}</AnimatePresence>;
}
