import { SwitchRow } from '@/components/Switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useConnectorCatalog } from '@/components/Connections';
import { effectiveAction, overridden, setAction, setSetting, setUsed, settingValue } from '@/lib/connectors.mjs';
import { useState } from 'react';
import { Ban, ChevronUp, Database, Eye, PenLine, Plus, Settings2, Trash2 } from 'lucide-react';
import { Select } from '@/components/Select';
import { IconButton } from '@/components/IconButton';
import { newDatabase } from '@/lib/project-form.mjs';

function Services({ form, update }) {
  const services = form.services ?? [];
  return <section className="tab-section"><h3>Services</h3>
    <p className="muted">Background processes the agent can start, stop and read logs from with dispatch_service, outside the sandbox, for example a worker or a mock API. Dev server logs are always available as app.</p>
    <Label htmlFor="services">One per line as id: command</Label>
    <Textarea id="services" className="mono-input" rows={Math.min(6, Math.max(2, services.length + 1))} placeholder="worker: npm run worker" value={services.join('\n')} onChange={event => update({ services: event.target.value.split('\n') })}/>
  </section>;
}

const accessLevels = [['none', 'No access', Ban], ['read', 'Read only', Eye], ['write', 'Read and write', PenLine]];
const field = (id, label, value, onChange, placeholder) => <div className="field"><Label htmlFor={id}>{label}</Label><Input id={id} className="mono-input" placeholder={placeholder} value={value} onChange={event => onChange(event.target.value)}/></div>;
const choice = (id, label, value, onChange, options) => <div className="field"><Label htmlFor={id}>{label}</Label><Select id={id} value={value} onChange={event => onChange(event.target.value)}>{options.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</Select></div>;

function AccessToggle({ database, set }) {
  return <div className="icon-toggle" role="group" aria-label={`${database.name} access for the agent`}>{accessLevels.map(([level, label, icon]) => <IconButton type="button" key={level} label={label} icon={icon} aria-pressed={database.access === level} onClick={() => set({ access: level })}/>)}</div>;
}

function QueryCommands({ id, database, set }) {
  return <>
    {field(`${id}-query`, 'Query command', database.query, query => set({ query }), 'mysql --batch -e {sql}')}
    <div className="form-columns">
      {choice(`${id}-format`, 'Output', database.format, format => set({ format }), [['csv', 'CSV'], ['tsv', 'Tab-separated']])}
      {field(`${id}-null`, 'NULL is printed as', database.nullMarker, nullMarker => set({ nullMarker }), 'NULL')}
    </div>
    <p className="muted">{'{sql}'} is replaced by the query. A read-only database needs a read-only user here.</p>
  </>;
}

function TaskCommands({ id, perTask, set }) {
  return <>
    {field(`${id}-create`, 'Create', perTask.create, create => set({ create }), 'docker run -d --name app-{task} -p {port}:5432 postgres:16')}
    {field(`${id}-drop`, 'Drop', perTask.drop, drop => set({ drop }), 'docker rm -f app-{task}')}
    <div className="field"><Label htmlFor={`${id}-env`}>Variables</Label><Textarea id={`${id}-env`} className="mono-input" rows={2} placeholder="DATABASE_URL=postgres://postgres@127.0.0.1:{port}/postgres" value={perTask.env} onChange={event => set({ env: event.target.value })}/></div>
    <p className="muted">{'{task}'} is unique to the task, {'{port}'} a free local port.</p>
    {field(`${id}-snapshot`, 'Snapshot', perTask.snapshot, snapshot => set({ snapshot }), 'scripts/db-snapshot {snapshot}')}
    {field(`${id}-changes`, 'Changes', perTask.changes, changes => set({ changes }), 'scripts/db-changes {snapshot}')}
    <p className="muted">Optional, to show what a run changed in the data. Snapshot saves the database's state into the folder {'{snapshot}'}; changes prints its differences from it as JSON.</p>
  </>;
}

function TaskCopy({ id, database, onChange, connectors, form, update }) {
  const perTask = database.perTask, set = change => onChange({ ...database, perTask: { ...perTask, ...change } });
  const providers = [...connectors.filter(connector => connector.provisions).map(connector => [connector.id, connector.name]), ['commands', 'Commands']];
  const choose = provider => {
    const connector = connectors.find(item => item.id === provider), action = connector?.actions.find(item => item.hooks.includes('database.provision'));
    onChange({ ...database, perTask: { ...perTask, provider } });
    if (action) update({ connectors: setAction(form.connectors, connector, action, true) });
  };
  return <>
    <ul className="row-list"><li><SwitchRow label="Own copy for each task" description="Created with the worktree and removed with it." checked={perTask.on} onChange={on => set({ on })}/></li></ul>
    {perTask.on && <div className="database-nested">
      {choice(`${id}-copy`, 'Copied by', perTask.provider, choose, [['', 'Choose…'], ...providers])}
      {perTask.provider === 'commands' && <TaskCommands id={id} perTask={perTask} set={set}/>}
      {field(`${id}-migrate`, 'Migrate command', perTask.migrate, migrate => set({ migrate }), 'npm run db:migrate')}
    </div>}
  </>;
}

function ConnectorOptions({ id, database, set, connector }) {
  const options = connector?.databaseOptions ?? [];
  if (!options.length) return <p className="muted">Set where {connector?.name ?? database.connector} reads it in that connector's settings below.</p>;
  const value = option => database.options[option.key] ?? option.default, change = (option, next) => set({ options: { ...database.options, [option.key]: next } });
  return <ul className="row-list">{options.map(option => option.type === 'boolean'
    ? <li key={option.key}><SwitchRow label={option.label} description={option.description} checked={value(option)} onChange={next => change(option, next)}/></li>
    : <li key={option.key} className="connector-setting"><label htmlFor={`${id}-${option.key}`}>{option.label}</label>{option.description && <small>{option.description}</small>}<Input id={`${id}-${option.key}`} className="mono-input" value={value(option)} onChange={event => change(option, event.target.value)} spellCheck={false}/></li>)}</ul>;
}

function databaseSummary(database, connectors) {
  const named = id => connectors.find(connector => connector.id === id)?.name ?? id;
  const engine = database.engine === 'commands' ? 'Commands' : database.engine ? named(database.engine) : connectors.filter(connector => connector.queries).length === 1 ? connectors.find(connector => connector.queries).name : 'No engine';
  const connection = database.source === 'connector' ? named(database.connector) : database.envFile || 'No env file';
  return [engine, connection, database.perTask.on && 'copy per task'].filter(Boolean).join(' · ');
}

function DatabaseDetails({ id, database, set, onChange, connectors, form, update, copyTaken }) {
  const engines = [...connectors.filter(connector => connector.queries).map(connector => [connector.id, connector.name]), ['commands', 'Commands']];
  const sources = [['env', 'Env file'], ...connectors.filter(connector => connector.databases).map(connector => [`connector:${connector.id}`, connector.name])];
  return <div className="database-nested">
    {field(`${id}-name`, 'Name', database.name, name => set({ name: name.toLowerCase() }), 'local')}
    <div className="form-columns">
      {choice(`${id}-engine`, 'Engine', database.engine || (engines.length === 2 ? engines[0][0] : ''), engine => set({ engine }), engines)}
      {choice(`${id}-source`, 'Connection', database.source === 'connector' ? `connector:${database.connector}` : 'env', value => set(value === 'env' ? { source: 'env' } : { source: 'connector', connector: value.slice('connector:'.length) }), sources)}
    </div>
    {database.engine === 'commands' && <QueryCommands id={id} database={database} set={set}/>}
    {database.source === 'connector' ? <ConnectorOptions id={id} database={database} set={set} connector={connectors.find(item => item.id === database.connector)}/>
      : <div className="form-columns">
        {field(`${id}-env-file`, 'Env file', database.envFile, envFile => set({ envFile }), '.env.development')}
        {field(`${id}-variable`, 'Variables', database.variable, variable => set({ variable }), 'DATABASE_URL')}
      </div>}
    {(!copyTaken || database.perTask.on) && <TaskCopy id={id} database={database} onChange={onChange} connectors={connectors} form={form} update={update}/>}
  </div>;
}

function DatabaseRow({ index, database, open, onToggle, onChange, onRemove, connectors, form, update, copyTaken }) {
  const id = `database-${index}`, set = change => onChange({ ...database, ...change }), label = database.name || 'database';
  return <li className={`database-row${open ? ' is-open' : ''}${database.access === 'none' ? ' is-off' : ''}`}>
    <div className="database-line">
      <Database size={15} aria-hidden="true" className="database-icon"/>
      <code className="database-title">{label}</code>
      <span className="database-summary">{databaseSummary(database, connectors)}</span>
      <AccessToggle database={database} set={set}/>
      <IconButton type="button" label={open ? `Close ${label}` : `Edit ${label}`} icon={open ? ChevronUp : Settings2} aria-expanded={open} onClick={onToggle}/>
      <IconButton type="button" label={`Remove ${label}`} icon={Trash2} onClick={onRemove}/>
    </div>
    {open && <DatabaseDetails id={id} database={database} set={set} onChange={onChange} connectors={connectors} form={form} update={update} copyTaken={copyTaken}/>}
  </li>;
}

function Databases({ form, update, connectors }) {
  const databases = form.databases ?? [], [open, setOpen] = useState(() => new Set()), change = next => update({ databases: next });
  const replace = (index, next) => change(databases.map((item, position) => position === index ? next : item));
  const toggle = index => setOpen(current => { const next = new Set(current); if (!next.delete(index)) next.add(index); return next; });
  const add = () => { const name = ['local', 'staging', 'prod', 'test'].find(item => !databases.some(database => database.name === item)) ?? `db${databases.length + 1}`; change([...databases, newDatabase(name)]); setOpen(current => new Set(current).add(databases.length)); };
  const remove = index => { change(databases.filter((_, position) => position !== index)); setOpen(new Set()); };
  return <section className="tab-section"><div className="section-heading"><h3>Databases</h3><IconButton type="button" label="Add a database" icon={Plus} onClick={add}/></div>
    <p className="muted">What the agent may query with dispatch_sql, per database. Connection strings stay hidden.</p>
    {databases.length ? <ul className="row-list database-list">{databases.map((database, index) => <DatabaseRow key={index} index={index} database={database} open={open.has(index)} onToggle={() => toggle(index)} onChange={next => replace(index, next)} onRemove={() => remove(index)} connectors={connectors} form={form} update={update} copyTaken={databases.some((item, position) => position !== index && item.perTask.on)}/>)}</ul> : <p className="muted">No databases.</p>}
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
    <Databases form={form} update={update} connectors={connectors}/>
    {form.git !== false && <Services form={form} update={update}/>}
    {connectors.length > 0 && <section className="tab-section"><h3>Connectors</h3><ul className="row-list">
      {connectors.map(connector => <ConnectorRows key={connector.id} form={form} connector={connector} update={update}/>)}
    </ul></section>}
  </>;
}
