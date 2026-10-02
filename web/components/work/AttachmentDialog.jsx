import { Dialog } from 'radix-ui';
import { useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';

export function AttachmentDialog({ title, children, editor = false, onClose }) {
  const returnFocus = useRef(document.activeElement);
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="attachment-overlay"/>
      <Dialog.Content className={`attachment-dialog${editor ? ' attachment-editor' : ''}`} aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
        <div className="section-heading"><Dialog.Title>{title}</Dialog.Title><IconButton label="Close attachment" icon={X} onClick={onClose}/></div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
