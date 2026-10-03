import { useEffect, useLayoutEffect, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { commandToken } from '@/lib/commands.mjs';

const mirrored = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'paddingTop', 'paddingLeft', 'paddingBottom', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];

function mirror(field, backdrop) {
  const style = getComputedStyle(field);
  for (const property of mirrored) backdrop.style[property] = style[property];
  const scrollbar = field.offsetWidth - field.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
  backdrop.style.paddingRight = `${parseFloat(style.paddingRight) + scrollbar}px`;
  backdrop.scrollTop = field.scrollTop;
}

// A textarea cannot colour part of its text, so a mirrored backdrop paints the command while the field's own text turns transparent.
export function CommandTextarea({ ref, value, accent = true, onScroll, ...props }) {
  const field = useRef(null), backdrop = useRef(null), token = accent ? commandToken(value) : null, active = Boolean(token);
  const attach = node => { field.current = node; if (typeof ref === 'function') ref(node); else if (ref) ref.current = node; };
  useLayoutEffect(() => { if (token && field.current && backdrop.current) mirror(field.current, backdrop.current); });
  useEffect(() => {
    if (!active || !field.current) return undefined;
    const observer = new ResizeObserver(() => { if (field.current && backdrop.current) mirror(field.current, backdrop.current); });
    observer.observe(field.current);
    return () => observer.disconnect();
  }, [active]);
  return <div className="command-field" data-command={token ? '' : undefined}>
    {token && <div ref={backdrop} className="command-backdrop" aria-hidden="true">{token.lead}<span className="command-name">{token.name}</span>{token.rest}{'\n'}</div>}
    <Textarea ref={attach} value={value} onScroll={event => { if (backdrop.current) backdrop.current.scrollTop = event.currentTarget.scrollTop; onScroll?.(event); }} {...props}/>
  </div>;
}
