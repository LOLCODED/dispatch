export function Checkbox({ checked, onChange, children, required, disabled }) {
  return <label className="check-label"><input type="checkbox" required={required} disabled={disabled} checked={checked} onChange={event => onChange(event.target.checked)}/>{children}</label>;
}
