import { useId } from 'react';
import { Switch as Primitive } from 'radix-ui';

export function SwitchRow({ label, description, checked, onChange, disabled, children }) {
  const id = useId();
  return <div className="switch-row" data-disabled={disabled || undefined}>
    <Primitive.Root id={id} className="switch" checked={checked} onCheckedChange={onChange} disabled={disabled} aria-describedby={description ? `${id}-description` : undefined}><Primitive.Thumb className="switch-thumb"/></Primitive.Root>
    <div className="switch-text"><label htmlFor={id}>{label}</label>{description && <small id={`${id}-description`}>{description}</small>}</div>
    {children}
  </div>;
}
