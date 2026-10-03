import { useState } from 'react';
import { ArrowDown, ArrowUp, Cpu, Plug, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { SettingsLayout } from '@/components/SettingsLayout';
import { SettingsTabs } from '@/components/SettingsTabs';
import { LocalModels } from '@/components/LocalModels';
import { ConnectorFolders, ConnectorList, ProviderList, useConnections } from '@/components/Connections';
import { IconButton } from '@/components/IconButton';
import { ModelPicker } from '@/components/ModelPicker';
import { SwitchRow } from '@/components/Switch';
import { useAction } from '@/lib/use-action';
import { api, useWorkspace } from '@/lib/workspace';
import { useStored } from '@/lib/preferences';
import { executionKey, readExecution } from '@/lib/execution';
import { modelKey, providerName } from '@/lib/providers.mjs';

const refreshWorkspace = () => window.dispatchEvent(new Event('dispatch-refresh'));

function Providers({ connections, busy, onCheck, onToggle }) {
  return <section className="panel" id="providers"><div className="section-heading"><h2>Providers</h2><IconButton label="Check connections" icon={RefreshCw} disabled={busy} onClick={onCheck}/></div>
    <ProviderList connections={connections} busy={busy} onToggle={onToggle}/>
    <p className="muted">Turning a provider on lets dispatch check its CLI and list its models; nothing runs until you dispatch. Connection checks do not start a model task. Credentials stay with each CLI.</p>
  </section>;
}

function Connectors({ connections, busy, perform, onCheck, onReload, onToggle, onAction }) {
  return <section className="panel" id="connectors"><div className="section-heading"><h2>Connectors</h2><IconButton label="Check connector connections" icon={RefreshCw} disabled={busy} onClick={onCheck}/></div>
    <ConnectorList connections={connections} busy={busy} onToggle={onToggle} onAction={onAction}/>
    <p className="muted">Turning a connector on lets dispatch check its login. A repository uses it only after you turn it on in that repository’s Extras; reading actions start on and writing actions start off. Credentials stay with each CLI.</p>
    <ConnectorFolders busy={busy} perform={perform} onChange={onReload}/>
    <p className="muted">Add a connector from a folder on this machine. It runs inside dispatch with your permissions, so add only code you trust. See docs/INTEGRATIONS.md to write one.</p>
  </section>;
}

function DefaultModel({ models }) {
  const [execution, setExecution] = useStored(executionKey, readExecution, JSON.stringify);
  return <div className="setting-row"><span>Composer starts with</span><ModelPicker label="Default model" value={execution} models={models?.models ?? []} onChange={setExecution}/></div>;
}

const sameEntry = (a, b) => a.provider === b.provider && a.model === b.model;

function TierRow({ tier, index, count, models, busy, onChange, onMove, onRemove }) {
  return <li className="tier-row">
    <span className="tier-index" aria-hidden="true">{index + 1}</span>
    <ModelPicker label={`Tier ${index + 1} model`} defaultLabel="Choose a model" value={tier} models={models} onChange={value => value && onChange(value)}/>
    <IconButton label="Move up" icon={ArrowUp} disabled={busy || index === 0} onClick={() => onMove(-1)}/>
    <IconButton label="Move down" icon={ArrowDown} disabled={busy || index === count - 1} onClick={() => onMove(1)}/>
    <IconButton label="Remove tier" icon={Trash2} disabled={busy} onClick={onRemove}/>
  </li>;
}

function AutoTiers({ models, busy, perform }) {
  const { state } = useWorkspace(), [edited, setEdited] = useState(null), tiers = edited ?? state.autoTiers ?? [], catalog = models?.models ?? [];
  const save = next => perform(async () => {
    setEdited(next);
    try { setEdited((await api('/api/models/tiers', { tiers: next })).autoTiers); } catch (failure) { setEdited(null); throw failure; }
    refreshWorkspace();
  });
  const unused = catalog.find(model => !tiers.some(tier => sameEntry(tier, model)));
  const move = (index, by) => { const next = [...tiers]; [next[index], next[index + by]] = [next[index + by], next[index]]; save(next); };
  return <div className="auto-tiers">
    <div className="setting-row"><span>Auto tiers</span><IconButton label="Add tier" icon={Plus} disabled={busy || !unused || tiers.length >= 8} onClick={() => save([...tiers, { provider: unused.provider, model: unused.model, effort: unused.defaultReasoningEffort ?? null }])}/></div>
    {tiers.length > 0 && <ol className="tier-list" aria-label="Auto tiers">{tiers.map((tier, index) => <TierRow key={`${index}:${tier.provider}:${tier.model}`} tier={tier} index={index} count={tiers.length} models={catalog} busy={busy}
      onChange={value => save(tiers.map((item, at) => at === index ? value : item))} onMove={by => move(index, by)} onRemove={() => save(tiers.filter((_, at) => at !== index))}/>)}</ol>}
    <p className="muted">Lightest first. Auto starts on the first tier; when checks or review still fail after the repair, it gets one more attempt on the next tier. Models missing from the last refresh are skipped. With no tiers, Auto uses the provider’s default.</p>
  </div>;
}

function ModelList({ models, busy, onToggle }) {
  const all = models?.allModels ?? [], on = new Set((models?.models ?? []).map(modelKey));
  const groups = [...new Set(all.map(model => model.provider))];
  if (!all.length) return null;
  return <div className="model-list">
    <div className="setting-row"><span>Available models</span><span className="model-count">{on.size} of {all.length} on</span></div>
    {groups.map(provider => <ul key={provider} className="row-list" aria-label={`${providerName(provider)} models`}>
      {groups.length > 1 && <li className="model-group">{providerName(provider)}</li>}
      {all.filter(model => model.provider === provider).map(model => <li key={modelKey(model)}>
        <SwitchRow label={model.displayName ?? model.model} checked={on.has(modelKey(model))} disabled={busy} onChange={enabled => onToggle(model, enabled)}/>
      </li>)}
    </ul>)}
    <p className="muted">Models you turn off leave the model pickers and Auto tiers. They stay off when you refresh.</p>
  </div>;
}

function Models({ models, busy, perform, onRefresh, onToggle }) {
  return <section className="panel" id="models"><div className="section-heading"><h2>Models</h2><IconButton label="Refresh models" icon={RefreshCw} disabled={busy} onClick={onRefresh}/></div>
    <p className="muted" role="status">{models?.message}{models?.fetchedAt && ` Last checked ${new Date(models.fetchedAt).toLocaleString()}.`}</p>
    <DefaultModel models={models}/>
    <AutoTiers models={models} busy={busy} perform={perform}/>
    <ModelList models={models} busy={busy} onToggle={onToggle}/>
    <p className="muted">Choose a model and reasoning level in the composer, or switch it on the run page from the next turn. Replies and repairs keep the session unless the provider changes.</p>
  </section>;
}

export function Integrations() {
  const { state } = useWorkspace(), { busy, error, perform } = useAction();
  const { connections, catalog, setCatalog, check, reload, toggle, saveEndpoints, chooseLocalAgent, toggleConnector, setConnectorAction } = useConnections(perform);
  const refresh = () => perform(async () => setCatalog(await api('/api/models/refresh', {})));
  const toggleModel = (model, enabled) => perform(async () => { setCatalog(await api('/api/models/enabled', { provider: model.provider, model: model.model, enabled })); refreshWorkspace(); });
  const tabs = [
    { value: 'providers', label: 'Providers', icon: Plug, content: <Providers connections={connections} busy={busy} onCheck={check} onToggle={toggle}/> },
    { value: 'models', label: 'Models', icon: Cpu, content: <>
      <Models models={catalog ?? state.modelCatalog} busy={busy} perform={perform} onRefresh={refresh} onToggle={toggleModel}/>
      <LocalModels connection={connections?.['local-models']} busy={busy} onCheck={check} onToggle={enabled => toggle('local-models', enabled)} onSave={saveEndpoints} onAgent={chooseLocalAgent}/>
    </> },
    { value: 'connectors', label: 'Connectors', icon: Unplug, content: <Connectors connections={connections} busy={busy} perform={perform} onCheck={check} onReload={reload} onToggle={toggleConnector} onAction={setConnectorAction}/> },
  ];
  return <SettingsLayout title="Integrations" description="Providers, models and connectors.">
    <SettingsTabs label="Integration sections" tabs={tabs}/>
    {error && <p role="alert" className="error">{error}</p>}
  </SettingsLayout>;
}
