import { SwitchRow } from '@/components/Switch';
import { Badge } from '@/components/ui/badge';

export function connectionStatus(enabled, connection) {
  if (!enabled) return 'Off';
  if (!connection) return 'Checking…';
  return connection.available && connection.authenticated ? 'Connected' : 'Setup needed';
}

export function ConnectionRow({ icon: Icon, name, label = name, setup, enabled, checked = enabled, connection, busy, onToggle, children }) {
  return <li className="connection-row" data-on={checked || undefined}>
    <SwitchRow label={<span className="connection-name"><Icon aria-hidden="true"/>{label}</span>} description={enabled && connection?.detail ? connection.detail : setup} checked={checked} disabled={busy} onChange={onToggle}>
      <Badge variant="outline">{connectionStatus(enabled, connection)}</Badge>
      {children}
    </SwitchRow>
    {enabled && connection?.version && <small className="connection-version">{connection.version}</small>}
  </li>;
}
