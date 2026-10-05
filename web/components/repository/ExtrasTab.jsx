import { SwitchRow } from '@/components/Switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useConnectorCatalog } from '@/components/Connections';
import { effectiveAction, overridden, setAction, setSetting, setUsed, settingValue } from '@/lib/connectors.mjs';

function Services({ form, update }) {
  const services = form.services ?? [];
  return <section className="tab-section"><h3>Services</h3>
    <p className="muted">Background processes the agent can start, stop and read logs from with dispatch_service, outside the sandbox, for example a worker or a mock API. Dev server logs are always available as app.</p>
    <Label htmlFor="services">One per line as id: command</Label>
    <Textarea id="services" className="mono-input" rows={Math.min(6, Math.max(2, services.length + 1))} placeholder="worker: npm run worker" value={services.join('\n')} onChange={event => update({ services: event.target.value.split('\n') })}/>
  </section>;
}

const formats = [['csv', 'CSV'], ['tsv', 'Tab-separated']];
function Choices({ label, options, value, onChoose }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map(([id, name]) => <Button key={id} type="button" variant="ghost" aria-pressed={value === id} onClick={() => onChoose(id)}>{name}</Button>)}</div>;
}

function QueryCommands({ database, set }) {
  return <>
    <div className="field"><Label htmlFor="database-query">Query command</Label><Input id="database-query" className="mono-input" placeholder="mysql --batch -e {sql}" value={database.query} onChange={event => set({ query: event.target.value })}/></div>
    <p className="muted">Runs in the task's copy with the connection variables set; {'{sql}'} is replaced by the query, or it is added as the last argument. Print a header row, then one row per line. Use a read-only database user: dispatch cannot make an unknown engine read-only.</p>
    <div className="form-columns">
      <div className="field"><Label id="database-format">Output</Label><Choices label="Output format" options={formats} value={database.format} onChoose={format => set({ format })}/></div>
      <div className="field"><Label htmlFor="database-null">NULL is printed as</Label><Input id="database-null" className="mono-input" placeholder="NULL" value={database.nullMarker} onChange={event => set({ nullMarker: event.target.value })}/></div>
    </div>
  </>;
}

function Database({ form, update, connectors }) {
  const database = form.database, set = change => update({ database: { ...database, ...change } });
  const engines = [...connectors.filter(connector => connector.queries).map(connector => [connector.id, connector.name]), ['commands', 'Commands']];
  const engine = database.engine || (engines.length === 2 ? engines[0][0] : ''), sources = [['env', 'Env file'], ...connectors.filter(connector => connector.databases).map(connector => [`connector:${connector.id}`, connector.name])];
  return <section className="tab-section"><h3>Database for queries</h3>
    <p className="muted">Gives the agent dispatch_sql: queries against a development database, with results shown in the run as a table. A connector speaks the database's engine; with Commands you give your own client command instead. Connection strings are never shown.</p>
    <div className="field"><Label>Engine</Label><Choices label="Database engine" options={engines} value={engine} onChoose={id => set({ engine: id })}/></div>
    {engine === 'commands' && <QueryCommands database={database} set={set}/>}
    <div className="field"><Label>Connection from</Label><Choices label="Connection from" options={sources} value={database.source === 'connector' ? `connector:${database.connector}` : 'env'} onChoose={id => set(id === 'env' ? { source: 'env' } : { source: 'connector', connector: id.slice('connector:'.length) })}/></div>
    {database.source === 'connector' ? <p className="muted">{connectors.find(item => item.id === database.connector)?.name ?? database.connector} provides it; set where it reads from in that connector's settings below.</p>
      : <div className="form-columns">
        <div className="field"><Label htmlFor="database-env-file">Env file</Label><Input id="database-env-file" className="mono-input" placeholder=".env.development" value={database.envFile} onChange={event => set({ envFile: event.target.value })}/></div>
        <div className="field"><Label htmlFor="database-variable">Variables</Label><Input id="database-variable" className="mono-input" placeholder="DATABASE_URL" value={database.variable} onChange={event => set({ variable: event.target.value })}/></div>
      </div>}
  </section>;
}

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
    <Database form={form} update={update} connectors={connectors}/>
    {form.git !== false && <Services form={form} update={update}/>}
    {connectors.length > 0 && <section className="tab-section"><h3>Connectors</h3><ul className="row-list">
      {connectors.map(connector => <ConnectorRows key={connector.id} form={form} connector={connector} update={update}/>)}
    </ul></section>}
  </>;
}
