import { useEffect, useMemo, useState } from 'react';
import { Bot, ChevronDown, Code, MousePointer2, Plus, Sparkles, Terminal, Ticket, Trash2 } from 'lucide-react';
import { ConnectionRow } from '@/components/ConnectionRow';
import { connectorIcon } from '@/components/ConnectorIcon';
import { IconButton } from '@/components/IconButton';
import { Input } from '@/components/ui/input';
import { SwitchRow } from '@/components/Switch';
import { providers } from '@/lib/providers.mjs';
import { api, useWorkspace } from '@/lib/workspace';

const providerIcons = { codex: Terminal, claude: Sparkles, cursor: MousePointer2, opencode: Code, pi: Bot };
export const agentProviders = providers.filter(provider => provider.id !== 'local-models');

const refreshWorkspace = () => window.dispatchEvent(new Event('dispatch-refresh'));

// Action lists and settings load only where they are shown; the workspace poll carries names alone.
export function useConnectorCatalog() {
  const [catalog, setCatalog] = useState([]);
  useEffect(() => {
    const load = () => api('/api/connectors').then(setCatalog).catch(() => {});
    load(); window.addEventListener('dispatch-refresh', load);
    return () => window.removeEventListener('dispatch-refresh', load);
  }, []);
  return catalog;
}

export function useConnections(perform) {
  const [connections, setConnections] = useState(null), [catalog, setCatalog] = useState(null);
  const load = async () => setConnections(await api('/api/connections'));
  const check = () => perform(load);
  useEffect(() => { check(); }, []);
  const toggle = (id, enabled) => perform(async () => {
    await api('/api/providers', { id, enabled });
    if (enabled) { await load(); setCatalog(await api('/api/models/refresh', {})); }
    else setCatalog(null);
    refreshWorkspace();
  });
  const saveEndpoints = endpoints => perform(async () => {
    await api('/api/local-endpoints', { endpoints });
    refreshWorkspace();
    await load(); setCatalog(await api('/api/models/refresh', {}));
    return true;
  });
  const chooseLocalAgent = agent => perform(async () => { await api('/api/local-agent', { agent }); refreshWorkspace(); await load(); });
  const toggleConnector = (id, enabled) => perform(async () => { await api('/api/connectors', { id, enabled }); refreshWorkspace(); await load(); });
  const setConnectorAction = (id, action, enabled) => perform(async () => { await api('/api/connectors', { id, actions: { [action]: enabled } }); refreshWorkspace(); });
  return { connections, catalog, setCatalog, check, reload: load, toggle, saveEndpoints, chooseLocalAgent, toggleConnector, setConnectorAction };
}

export function ProviderList({ connections, busy, onToggle }) {
  const { state } = useWorkspace();
  return <ul className="row-list connection-list">{agentProviders.map(provider => <ConnectionRow key={provider.id} icon={providerIcons[provider.id]} name={provider.name} setup={provider.setup} enabled={state.providerSettings?.[provider.id] === true} connection={connections?.[provider.id]} busy={busy} onToggle={enabled => onToggle(provider.id, enabled)}/>)}</ul>;
}

function ConnectorActions({ connector, busy, onAction }) {
  return <ul className="row-list connector-actions">{connector.actions.map(action => <li key={action.id} className="nested">
    <SwitchRow label={action.label} description={[action.description, action.access === 'write' ? 'Writes outside dispatch.' : 'Reads only.'].filter(Boolean).join(' ')} checked={action.enabled} disabled={busy} onChange={enabled => onAction(connector.id, action.id, enabled)}/>
  </li>)}</ul>;
}

function ConnectorRow({ connector, connection, busy, onToggle, onAction }) {
  const [open, setOpen] = useState(false), icon = useMemo(() => connectorIcon(connector.icon, Ticket), [connector.icon]);
  return <>
    <ConnectionRow icon={icon} name={connector.name} setup={connector.description ?? `${connector.name} connector.`} enabled={connection?.enabled ?? connector.enabled} checked={connector.enabled} connection={connection} busy={busy} onToggle={onToggle}>
      {onAction && <IconButton label={open ? `Hide what ${connector.name} can do` : `Show what ${connector.name} can do`} icon={ChevronDown} aria-expanded={open} className="disclosure" data-open={open || undefined} onClick={() => setOpen(!open)}/>}
    </ConnectionRow>
    {open && <li><ConnectorActions connector={connector} busy={busy} onAction={onAction}/><p className="muted">These are the defaults for every repository; a repository can switch an action off or on for itself under Extras.</p></li>}
  </>;
}

export function ConnectorList({ connections, busy, onToggle, onAction }) {
  const catalog = useConnectorCatalog();
  return <ul className="row-list connection-list">{catalog.map(connector => <ConnectorRow key={connector.id} connector={connector} connection={connections?.connectors?.[connector.id]} busy={busy} onToggle={enabled => onToggle(connector.id, enabled)} onAction={onAction}/>)}</ul>;
}

const pluginState = plugin => plugin.error ? `Did not load: ${plugin.error}` : plugin.loaded ? `${plugin.name} (${plugin.id})` : 'Not loaded';

export function ConnectorFolders({ busy, perform, onChange }) {
  const [plugins, setPlugins] = useState([]), [path, setPath] = useState('');
  const load = async () => setPlugins(await api('/api/connectors/plugins'));
  useEffect(() => { perform(load); }, []);
  const changed = async () => { refreshWorkspace(); await load(); await onChange?.(); };
  const add = event => { event.preventDefault(); perform(async () => { await api('/api/connectors/plugins', { path: path.trim() }); setPath(''); await changed(); }); };
  const remove = plugin => perform(async () => { await api(`/api/connectors/plugins/${plugin.id}/remove`, {}); await changed(); });
  return <div className="connector-folders">
    {plugins.length > 0 && <ul className="row-list">{plugins.map(plugin => <li key={plugin.path} className="setting-row">
      <span><code className="break-all">{plugin.path}</code><small className="muted"> · {pluginState(plugin)}</small></span>
      {plugin.id && <IconButton label={`Remove ${plugin.name ?? plugin.id}`} icon={Trash2} disabled={busy} onClick={() => remove(plugin)}/>}
    </li>)}</ul>}
    <form className="setting-row" onSubmit={add}>
      <label className="sr-only" htmlFor="connector-path">Connector folder</label>
      <Input id="connector-path" value={path} onChange={event => setPath(event.target.value)} placeholder="/absolute/path/to/connector" spellCheck={false}/>
      <IconButton type="submit" label="Add connector" icon={Plus} disabled={busy || !path.trim()}/>
    </form>
  </div>;
}
