import { SwitchRow } from '@/components/Switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useConnectorCatalog } from '@/components/Connections';
import { effectiveAction, overridden, setAction, setSetting, setUsed, settingValue } from '@/lib/connectors.mjs';

function Network({ form, update }) {
  const network = form.network ?? { hosts: [], localPorts: false }, set = change => update({ network: { ...network, ...change } });
  return <section className="tab-section"><h3>Network for the agent</h3>
    <p className="muted">The agent's own commands run in a sandbox with the network off. Setup and checks run outside it already. Hosts listed here are reachable from the sandbox, for example your package registry. Applies to Claude Code; other agents keep the network off.</p>
    <Label htmlFor="network-hosts">Allowed hosts, one per line</Label>
    <Textarea id="network-hosts" className="mono-input" rows={Math.min(6, Math.max(2, network.hosts.length + 1))} placeholder="registry.npmjs.org" value={network.hosts.join('\n')} onChange={event => set({ hosts: event.target.value.split('\n') })}/>
    <ul className="row-list"><li><SwitchRow label="Let it start local servers" description="Allows listening on local ports, so the agent can run a dev server or a test database itself. macOS only." checked={network.localPorts} onChange={localPorts => set({ localPorts })}/></li></ul>
  </section>;
}

export const extrasOn = form => [form.review, form.browser, form.memory, form.trackRemote, form.dispatchCoAuthor, form.allowSensitiveFiles, ...Object.values(form.connectors ?? {}).map(connector => connector?.enabled)].filter(Boolean).length;

function ConnectorSetting({ form, connector, setting, update }) {
  const value = settingValue(form.connectors, connector, setting), change = next => update({ connectors: setSetting(form.connectors, connector, setting, next) });
  if (setting.type === 'boolean') return <li className="nested"><SwitchRow label={setting.label} description={setting.description} checked={value} onChange={change}/></li>;
  const id = `connector-${connector.id}-${setting.key}`;
  return <li className="nested connector-setting"><label htmlFor={id}>{setting.label}</label>{setting.description && <small>{setting.description}</small>}<Input id={id} value={value} onChange={event => change(event.target.value)} spellCheck={false}/></li>;
}

function ConnectorRows({ form, connector, update }) {
  const used = form.connectors?.[connector.id]?.enabled === true;
  return <>
    <li><SwitchRow label={`Use ${connector.name}`} description={connector.description} checked={used} onChange={enabled => update({ connectors: setUsed(form.connectors, connector, enabled) })}/></li>
    {used && connector.actions.map(action => <li key={action.id} className="nested"><SwitchRow label={action.label} description={[action.description, action.access === 'write' ? 'Writes outside dispatch.' : null, overridden(form.connectors, connector, action) ? 'Differs from the default in Settings.' : null].filter(Boolean).join(' ')} checked={effectiveAction(form.connectors, connector, action)} onChange={value => update({ connectors: setAction(form.connectors, connector, action, value) })}/></li>)}
    {used && connector.settings.map(setting => <ConnectorSetting key={setting.key} form={form} connector={connector} setting={setting} update={update}/>)}
  </>;
}

export function ExtrasTab({ form, update }) {
  const connectors = useConnectorCatalog().filter(connector => form.git || !connector.delivers);
  return <>
    <section className="tab-section"><ul className="row-list">
      <li><SwitchRow label="Second opinion" description="After checks pass, a separate read-only agent reviews the change." checked={form.review} onChange={review => update({ review })}/></li>
      <li><SwitchRow label="Live browser" description="The agent gets a browser to show you UI changes while it works." checked={form.browser} onChange={browser => update({ browser })}/></li>
      {form.browser && <li className="nested"><SwitchRow label="Show the browser window" description="Also open a real window on this machine." checked={form.headed} onChange={headed => update({ headed })}/></li>}
      <li><SwitchRow label="Remember things" description="Keep notes from earlier tasks and reuse them. Stored outside the repository." checked={form.memory} onChange={memory => update({ memory })}/></li>
      {form.git && <li><SwitchRow label={`Start from origin/${form.base || 'base'}`} description="Fetch first so each run starts from the latest pushed code." checked={form.trackRemote} onChange={trackRemote => update({ trackRemote })}/></li>}
      <li><SwitchRow label="Write sensitive files without asking" description="Claude Code asks before writing files such as .npmrc or .env; when this is off, you approve each one during the run. Files under .git or .claude always ask." checked={form.allowSensitiveFiles} onChange={allowSensitiveFiles => update({ allowSensitiveFiles })}/></li>
      {form.git && <li><SwitchRow label="dispatch as co-author" description="Commits carry a Co-authored-by trailer for dispatch, so code hosts show it beside you." checked={form.dispatchCoAuthor} onChange={dispatchCoAuthor => update({ dispatchCoAuthor })}/></li>}
    </ul></section>
    <Network form={form} update={update}/>
    {connectors.length > 0 && <section className="tab-section"><h3>Connectors</h3><ul className="row-list">
      {connectors.map(connector => <ConnectorRows key={connector.id} form={form} connector={connector} update={update}/>)}
    </ul></section>}
  </>;
}
