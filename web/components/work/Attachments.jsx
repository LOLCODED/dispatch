import { useCallback, useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { AttachmentDialog } from '@/components/work/AttachmentDialog';
import { contextImagePayload, contextImageProblem, pastedImageFiles, readContextImages } from '@/lib/context-images.mjs';
import { contextFileAccept, contextFilePayload, contextFileProblem, readContextFiles } from '@/lib/context-files.mjs';

const keptAttachments = new Map();

// Pasted images and documents outgrow localStorage, so they persist in memory across in-app navigation only.
function useKeptList(key) {
  const [list, setList] = useState(() => keptAttachments.get(key) ?? []);
  const update = useCallback(next => setList(current => {
    const value = typeof next === 'function' ? next(current) : next;
    keptAttachments.set(key, value);
    return value;
  }), [key]);
  return [list, update];
}

function useDocuments(key, setError) {
  const [files, setFiles] = useKeptList(`${key}:documents`), [reading, setReading] = useState(false), pending = useRef(false);
  const add = async selected => {
    if (!selected.length || pending.current) return;
    const problem = contextFileProblem(selected, files.length);
    if (problem) { setError(problem); return; }
    pending.current = true; setReading(true);
    try { const added = await readContextFiles(selected); setFiles(current => [...current, ...added]); setError(''); }
    catch { setError('Could not read the attached documents.'); }
    finally { pending.current = false; setReading(false); }
  };
  return { files, reading, add, remove: id => setFiles(current => current.filter(file => file.id !== id)), clear: () => setFiles([]) };
}

function usePastedImages(key, setError) {
  const [images, setImages] = useKeptList(`${key}:images`);
  const paste = event => {
    const files = pastedImageFiles(event.clipboardData);
    if (!files.length) return false;
    event.preventDefault();
    const problem = contextImageProblem(files, images.length);
    if (problem) { setError(problem); return true; }
    readContextImages(files).then(added => { setImages(current => [...current, ...added]); setError(''); }, () => setError('Could not read the pasted image.'));
    return true;
  };
  const remove = id => setImages(current => current.filter(image => image.id !== id));
  return { images, paste, remove, clear: () => setImages([]) };
}

export function useAttachments(key, setError) {
  const pasted = usePastedImages(key, setError), documents = useDocuments(key, setError);
  return {
    pasted, documents,
    any: pasted.images.length > 0 || documents.files.length > 0,
    payload: () => ({ ...(pasted.images.length ? { images: contextImagePayload(pasted.images) } : {}), ...(documents.files.length ? { files: contextFilePayload(documents.files) } : {}) }),
    clear: () => { pasted.clear(); documents.clear(); },
  };
}

export function savedTaskImages(attachments) {
  if (attachments.documents.files.length) throw new Error('Saved tasks keep text and images only. dispatch now, or remove the documents first.');
  const { images } = attachments.payload();
  return images ? { images } : {};
}

function PastedImages({ images, onRemove }) {
  const [preview, setPreview] = useState(null);
  if (!images.length) return null;
  return <><ul className="composer-images" aria-label="Pasted images">{images.map((image, index) => <li key={image.id}>
    <button type="button" className="image-preview" aria-label={`Preview image ${index + 1}`} onClick={() => setPreview(image)}><img src={image.url} alt={`Pasted image ${index + 1}`}/></button>
    <IconButton className="image-remove" label={`Remove image ${index + 1}`} icon={X} onClick={() => onRemove(image.id)}/>
  </li>)}</ul>{preview && <AttachmentDialog title="Image preview" onClose={() => setPreview(null)}><img src={preview.url} alt="Attached image"/></AttachmentDialog>}</>;
}

export function AttachmentList({ attachments, busy }) {
  const { pasted, documents } = attachments;
  return <>
    <PastedImages images={pasted.images} onRemove={pasted.remove}/>
    {documents.files.length > 0 && <ul className="composer-texts composer-documents" aria-label="Attached documents">{documents.files.map(file => <li key={file.id}>
      <span className="break-all">{file.name} · {(file.size / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB</span>
      <IconButton label={`Remove ${file.name}`} icon={X} disabled={busy} onClick={() => documents.remove(file.id)}/>
    </li>)}</ul>}
    {documents.reading && <p role="status" className="muted">Reading documents…</p>}
  </>;
}

export function AttachButton({ attachments, disabled }) {
  const input = useRef(null), { documents } = attachments, off = disabled || documents.reading;
  return <>
    <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="Choose documents" accept={contextFileAccept} multiple disabled={off} onChange={event => { documents.add([...event.target.files]); event.target.value = ''; }}/>
    <IconButton label="Attach documents · up to 4 files, 5 MB each" icon={Paperclip} disabled={off} onClick={() => input.current?.click()}/>
  </>;
}
