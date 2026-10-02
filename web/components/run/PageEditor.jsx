import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/workspace';
import { componentType, describeElement, dropTarget, editLine, elementType, imagePoint, percentBox, sameTarget } from '@/lib/page-edit.mjs';

function useComponents(runId) {
  const [state, setState] = useState({ components: [], loading: true, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    api(`/api/runs/${runId}/components`, undefined, controller.signal).then(result => setState({ components: result.components, loading: false, error: '' })).catch(failure => { if (!controller.signal.aborted) setState({ components: [], loading: false, error: failure.message }); });
    return () => controller.abort();
  }, [runId]);
  return state;
}

function startDrag(event, type, payload) { event.dataTransfer.setData(type, JSON.stringify(payload)); event.dataTransfer.effectAllowed = type === elementType ? 'move' : 'copy'; }

function Palette({ runId, picked, onPick, onDragStart, onDragEnd }) {
  const { components, loading, error } = useComponents(runId);
  if (loading) return <p className="page-palette muted">Finding components…</p>;
  if (error) return <p className="page-palette error">{error}</p>;
  if (!components.length) return <p className="page-palette muted">No components found under a components folder in this worktree.</p>;
  return <ul className="page-palette" aria-label="Repository components">{components.map(component => <li key={`${component.path}:${component.name}`}>
    <button type="button" className={`page-chip ${picked === component ? 'is-picked' : ''}`} draggable title={component.path} aria-pressed={picked === component} onClick={() => onPick(component)} onDragStart={event => { startDrag(event, componentType, component); onDragStart(component); }} onDragEnd={onDragEnd}>{component.name}</button>
  </li>)}</ul>;
}

function ElementBox({ element, size, picked, targeted, dragging, ...handlers }) {
  return <button type="button" className={`page-element ${picked ? 'is-picked' : ''} ${targeted ? 'is-target' : ''} ${dragging ? 'is-dragging' : ''}`} style={percentBox(element.box, size)} draggable data-label={`${element.tag}${element.text ? ` · ${element.text}` : ''}`} aria-label={describeElement(element)} aria-pressed={picked} {...handlers}/>;
}

function DropMarker({ target, size }) {
  const { box } = target.element, vertical = target.axis === 'vertical', after = target.position === 'after';
  const style = vertical
    ? { left: `${box.x / size.width * 100}%`, width: `${box.width / size.width * 100}%`, top: `${(after ? box.y + box.height : box.y) / size.height * 100}%` }
    : { top: `${box.y / size.height * 100}%`, height: `${box.height / size.height * 100}%`, left: `${(after ? box.x + box.width : box.x) / size.width * 100}%` };
  return <span className={`page-marker ${vertical ? 'is-vertical' : 'is-horizontal'}`} style={style} aria-hidden="true"/>;
}

// Drag and drop describes the change; the agent still writes the code. Keyboard: M picks an element, Enter on a chip picks a component, B or A places it before or after the focused element.
export function PageEditor({ runId, src, artifact, step, edits, onEdits }) {
  const [size, setSize] = useState(null), [drag, setDrag] = useState(null), [picked, setPicked] = useState(null), [target, setTarget] = useState(null), image = useRef(null);
  const elements = step.elements;
  const record = edit => onEdits([...edits, editLine({ ...edit, url: step.url })]);
  const point = event => imagePoint({ x: event.clientX, y: event.clientY }, image.current.getBoundingClientRect(), size);
  const accepts = event => size && (event.dataTransfer.types.includes(elementType) || event.dataTransfer.types.includes(componentType));
  const endDrag = () => { setDrag(null); setTarget(null); };
  const over = event => { if (!accepts(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = drag?.kind === 'move' ? 'move' : 'copy'; const next = dropTarget(elements, point(event), drag?.element ?? null); setTarget(current => sameTarget(current, next) ? current : next); };
  const leave = event => { if (!event.currentTarget.contains(event.relatedTarget)) setTarget(null); };
  const drop = event => { if (!accepts(event)) return; event.preventDefault(); const at = dropTarget(elements, point(event), drag?.element ?? null); if (at && drag) record({ ...drag, target: at.element, position: at.position }); endDrag(); };
  const place = (position, element) => { if (!picked) return false; record({ ...picked, target: element, position }); setPicked(null); return true; };
  const keys = (event, element) => {
    const key = event.key.toLowerCase();
    if (key === 'm') setPicked({ kind: 'move', element });
    else if ((key === 'b' || key === 'a') && picked) place(key === 'b' ? 'before' : 'after', element);
    else if (key === 'escape' && picked) setPicked(null);
    else return;
    event.preventDefault(); event.stopPropagation();
  };
  return <div className="page-editor">
    <span className="page-frame" onDragOver={over} onDragLeave={leave} onDrop={drop}>
      <img ref={image} src={src} alt={artifact.name} onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}/>
      {size && elements.map((element, index) => <ElementBox key={index} element={element} size={size} picked={picked?.element === element} targeted={target?.element === element} dragging={drag?.element === element}
        onDragStart={event => { startDrag(event, elementType, index); setDrag({ kind: 'move', element }); }} onDragEnd={endDrag} onClick={() => { if (!place('after', element)) record({ kind: 'select', element }); }} onKeyDown={event => keys(event, element)}/>)}
      {size && target && <DropMarker target={target} size={size}/>}
    </span>
    <Palette runId={runId} picked={picked?.component ?? null} onPick={component => setPicked(current => current?.component === component ? null : { kind: 'insert', component })} onDragStart={component => setDrag({ kind: 'insert', component })} onDragEnd={endDrag}/>
    {edits.length > 0 && <ol className="page-edits" aria-label="Edits">{edits.map((line, index) => <li key={index}>{line}</li>)}</ol>}
  </div>;
}
