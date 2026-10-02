import { useState } from 'react';
import { HardDrive, Plug, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ConnectionRow } from '@/components/ConnectionRow';
import { IconButton } from '@/components/IconButton';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/Select';
import { providers } from '@/lib/providers.mjs';
import { useWorkspace } from '@/lib/workspace';

const endpointLimit = 8;
const agents = [
  { id: 'claude', name: 'Claude Code', note: 'Works with Ollama and any server that also speaks the Anthropic API (LM Studio, llama.cpp, vLLM). Runs inside Claude Code’s sandbox, so any Agent access setting works.' },
  { id: 'opencode', name: 'OpenCode', note: 'No sandbox: dispatch runs it only with Full access. On first use it downloads its OpenAI-compatible connector package.' },
  { id: 'pi', name: 'pi', note: 'Smallest prompt, so it suits small context windows. No sandbox: dispatch runs it only with Full access.' },
];
const blank = { name: '', kind: 'ollama', url: 'http://127.0.0.1:11434' };

function endpointStatus(endpoint, status, models) {
  if (!endpoint.id) return 'Not saved';
  if (!status) return 'Checking…';
  if (!status.reachable) return 'Not reachable';
  return `Connected · ${models} model${models === 1 ? '' : 's'}`;
}

function EndpointRow({ endpoint, index, status, models, busy, onChange, onRemove }) {
  const label = endpoint.name || `Endpoint ${index + 1}`;
  return <li className="endpoint-row">
    <div className="endpoint-fields">
      <Input aria-label={`${label} name`} placeholder="Name" value={endpoint.name} disabled={busy} onChange={event => onChange({ name: event.target.value })}/>
      <Select aria-label={`${label} kind`} value={endpoint.kind} disabled={busy} onChange={event => onChange({ kind: event.target.value })}>
        <option value="ollama">Ollama</option>
        <option value="server">LM Studio, llama.cpp or vLLM</option>
      </Select>
      <Input className="mono-input" aria-label={`${label} URL`} placeholder={endpoint.kind === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234'} value={endpoint.url} disabled={busy} onChange={event => onChange({ url: event.target.value })}/>
      <IconButton label={`Remove ${label}`} icon={Trash2} disabled={busy} onClick={onRemove}/>
    </div>
    <Badge variant="outline" data-reachable={status?.reachable ?? undefined}>{endpointStatus(endpoint, status, models)}</Badge>
  </li>;
}

function LocalAgent({ busy, onChange }) {
  const { state } = useWorkspace(), current = agents.find(agent => agent.id === state.localAgent) ?? agents[0];
  return <div className="local-agent">
    <div className="setting-row"><label htmlFor="local-agent">Agent</label><Select id="local-agent" value={current.id} disabled={busy} onChange={event => onChange(event.target.value)}>
      {agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
    </Select></div>
    <p className="muted">A model on its own only writes text. An agent CLI turns that text into file edits, commands and dispatch tool calls such as the browser, and dispatch hands each task to one rather than running its own loop. Install the one you pick; no account is needed, and it talks only to the endpoints below. {current.note}</p>
  </div>;
}

function Endpoints({ connection, busy, onSave }) {
  const { state } = useWorkspace(), saved = state.localEndpoints ?? [];
  const [draft, setDraft] = useState(null), endpoints = draft ?? saved;
  const statuses = new Map((connection?.endpoints ?? []).map(status => [status.id, status]));
  const modelCount = id => (state.modelCatalog?.models ?? []).filter(model => model.provider === 'local-models' && model.model.startsWith(`${id}/`)).length;
  const save = () => onSave(endpoints).then(ok => { if (ok) setDraft(null); });
  return <div className="local-endpoints">
    <div className="setting-row"><span>Endpoints</span><span className="setting-value">
      <IconButton label="Add endpoint" icon={Plus} disabled={busy || endpoints.length >= endpointLimit} onClick={() => setDraft([...endpoints, blank])}/>
      <IconButton label="Save and connect" icon={Plug} disabled={busy || !draft} onClick={save}/>
    </span></div>
    {endpoints.length > 0 && <ol className="endpoint-list" aria-label="Local endpoints">{endpoints.map((endpoint, index) => <EndpointRow key={endpoint.id ?? `new-${index}`} endpoint={endpoint} index={index} busy={busy}
      status={draft ? null : statuses.get(endpoint.id)} models={modelCount(endpoint.id)}
      onChange={change => setDraft(endpoints.map((item, at) => at === index ? { ...item, ...change } : item))} onRemove={() => setDraft(endpoints.filter((_, at) => at !== index))}/>)}</ol>}
    <p className="muted">Ollama (CLI or Docker), LM Studio, llama.cpp or vLLM, on this machine or another. Models need tool support and at least a 32k context. Prompts and code are sent to these URLs.</p>
  </div>;
}

export function LocalModels({ connection, busy, onCheck, onToggle, onSave, onAgent }) {
  const { state } = useWorkspace(), enabled = state.providerSettings?.['local-models'] === true;
  const setup = providers.find(provider => provider.id === 'local-models').setup;
  return <section className="panel" id="local-models"><div className="section-heading"><h2>Local models</h2><IconButton label="Check local connections" icon={RefreshCw} disabled={busy || !enabled} onClick={onCheck}/></div>
    <ul className="row-list connection-list"><ConnectionRow icon={HardDrive} name="Local models" label="Use local models" setup={setup} enabled={enabled} connection={connection && { ...connection, detail: null }} busy={busy} onToggle={onToggle}/></ul>
    {enabled && <><LocalAgent busy={busy} onChange={onAgent}/><Endpoints connection={connection} busy={busy} onSave={onSave}/></>}
  </section>;
}
