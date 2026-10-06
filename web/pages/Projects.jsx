import { useState } from 'react';
import { motion } from 'motion/react';
import { settle } from '@/lib/motion';
import { Brain, Check, FlaskConical, Folder, FolderOpen, FolderPlus, FolderSearch, GitBranch, GitPullRequest, Link2, Pencil, Plug, Plus, ScrollText, Search, ShieldCheck, SkipForward, Ticket, Undo2 } from 'lucide-react';
import { SettingsLayout } from '@/components/SettingsLayout';
import { SettingsTabs } from '@/components/SettingsTabs';
import { FolderBrowser } from '@/components/FolderBrowser';
import { IconButton } from '@/components/IconButton';
import { SearchSelect } from '@/components/SearchSelect';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/Checkbox';
import { RiskTab } from '@/components/repository/RiskTab';
import { ChecksTab } from '@/components/repository/ChecksTab';
import { ShortcutsTab } from '@/components/repository/ShortcutsTab';
import { RulesTab } from '@/components/repository/RulesTab';
import { ExtrasTab, extrasOn } from '@/components/repository/ExtrasTab';
import { NotesTab } from '@/components/repository/NotesTab';
import { LinkedTab } from '@/components/repository/LinkedTab';
import { useProjectForm } from '@/components/repository/use-project-form';
import { BatchAdd } from '@/components/repository/BatchAdd';
import { branchChoices, checkIds, formChanged, newCommands } from '@/lib/project-form.mjs';
import { api, Link, navigate, useWorkspace } from '@/lib/workspace';
import { usedConnectors } from '@/lib/connectors.mjs';

const RepositoryChip = ({ project }) => project.git === false ? <span className="meta-chip"><Folder size={12} aria-hidden="true"/>Folder</span> : <span className="meta-chip"><GitBranch size={12} aria-hidden="true"/>{project.baseBranch}</span>;

function ProjectRow({ project, index }) {
  const { state } = useWorkspace();
  return <motion.li className="project-row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ ...settle, delay: index * 0.03 }}>
    <div className="project-row-main"><strong>{project.name}</strong><code className="break-all">{project.repositoryPath}</code></div>
    <div className="project-chips">
      <RepositoryChip project={project}/>
      <span className="meta-chip"><FlaskConical size={12} aria-hidden="true"/>{project.validation.length} {project.validation.length === 1 ? 'check' : 'checks'}</span>
      {project.review && <span className="meta-chip"><ShieldCheck size={12} aria-hidden="true"/>Review</span>}
      {project.memory !== false && <span className="meta-chip"><Brain size={12} aria-hidden="true"/>Notes</span>}
      {project.instructions?.length > 0 && <span className="meta-chip"><ShieldCheck size={12} aria-hidden="true"/>{project.instructions.length} {project.instructions.length === 1 ? 'rule' : 'rules'}</span>}
      {usedConnectors(state.connectors, project.connectors).map(connector => <span key={connector.id} className="meta-chip">{connector.delivers ? <GitPullRequest size={12} aria-hidden="true"/> : <Ticket size={12} aria-hidden="true"/>}{connector.name}</span>)}
    </div>
    <IconButton label={`Edit ${project.name}`} icon={Pencil} href={`/admin/projects/${project.id}`} variant="outline"/>
  </motion.li>;
}

export function Projects() {
  const { state } = useWorkspace(), [adding, setAdding] = useState(false), [notice, setNotice] = useState('');
  const projects = state.projects.filter(project => project.id !== state.homeProjectId);
  const actions = <><IconButton label="Add several repositories" icon={FolderPlus} variant="outline" aria-pressed={adding} onClick={() => setAdding(!adding)}/><IconButton label="Add repository" icon={Plus} variant="outline" href="/admin/projects/new"/></>;
  return <SettingsLayout title="Repositories" description="Local checkouts dispatch can work on, and the checks each result must pass." actions={actions}>
    {adding && <BatchAdd projects={state.projects} onAdded={count => { setAdding(false); setNotice(`Added ${count} ${count === 1 ? 'repository' : 'repositories'}. Open one to adjust its checks.`); }}/>}
    {notice && <p className="muted" role="status">{notice}</p>}
    <section className="panel">{projects.length ? <ol className="project-list">{projects.map((project, index) => <ProjectRow key={project.id} project={project} index={index}/>)}</ol> : <p className="empty">Connect a local Git repository or a plain folder to start working on tickets.</p>}</section>
  </SettingsLayout>;
}

function NewRepositoryRow({ path }) {
  const [access, setAccess] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const create = async git => { setBusy(true); setError(''); try { const project = await api('/api/projects/create', { repositoryPath: path, confirmed: true, access: access ? 'full' : 'inherit', git }); window.dispatchEvent(new Event('dispatch-refresh')); navigate(`/admin/projects/${project.id}`); } catch (failure) { setError(failure.message); setBusy(false); } };
  return <section className="repository-offer" aria-label="New repository">
    <p>New at <code className="break-all">{path}</code> · a Git repository (folder, git init) or a plain folder (no Git); either starts with the browser smoke check</p>
    <Checkbox checked={access} onChange={setAccess}>Full access for this project: the agent can install packages (no sandbox, network on)</Checkbox>
    <div className="verdict-actions"><IconButton label="Create repository" icon={GitBranch} variant="default" disabled={busy} onClick={() => create(true)}/><IconButton label="Create folder (no Git)" icon={FolderPlus} variant="outline" disabled={busy} onClick={() => create(false)}/></div>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function TargetBranches({ form, update, branches }) {
  return <div className="field"><Label htmlFor="target-branches">Other target branches</Label>
    <SearchSelect id="target-branches" icon={GitBranch} multiple limit={5} placeholder="None" searchLabel="Search branches" value={form.targets} onChange={event => update({ targets: event.target.value })}>{branches.filter(branch => branch !== form.base).map(branch => <option key={branch}>{branch}</option>)}</SearchSelect>
    <small className="muted">Offered after the base branch when landing or opening pull requests. Worktrees always start from the base branch.</small>
  </div>;
}

// The system folder dialog when the server can show one; the in-page browser otherwise.
async function chooseFolder(onPath, fallback) {
  try { const { path } = await api('/api/folders/pick', {}); if (path) onPath(path); } catch { fallback(); }
}

function Basics({ state }) {
  const [browse, setBrowse] = useState(false), { form, update, info, busy, inspect, changePath, error } = state;
  return <section className="basics">
    <div className="field"><Label htmlFor="repo-path">Local repository path</Label>
      <div className="inline-field"><Input id="repo-path" value={form.path} onChange={event => changePath(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !busy) { event.preventDefault(); inspect(); } }} placeholder="~/code/project" required/><IconButton type="button" label="Inspect" icon={Search} variant="outline" onClick={() => inspect()} disabled={busy}/><IconButton type="button" label="Browse folders" icon={FolderOpen} variant="outline" onClick={() => setBrowse(!browse)}/><IconButton type="button" label="Choose folder in the system dialog" icon={FolderSearch} variant="outline" disabled={busy} onClick={() => chooseFolder(path => { changePath(path); inspect(path); }, () => setBrowse(true))}/></div>
      {browse && <FolderBrowser initialPath={form.path || '~'} onChoose={path => { setBrowse(false); inspect(path); }}/>}
      {/does not exist/.test(error) && form.path.trim() && <NewRepositoryRow path={form.path.trim()}/>}
    </div>
    {info && <div className="form-columns">
      <div className="field"><Label htmlFor="repo-name">Name</Label><Input id="repo-name" value={form.name} onChange={event => update({ name: event.target.value })} required/></div>
      {info.git === false ? <p className="field muted">Plain folder: the agent works in place; dispatch snapshots it for checks. No branches, commits, landing or pull requests.</p>
        : <div className="field"><Label htmlFor="base-branch">Base branch</Label><SearchSelect id="base-branch" icon={GitBranch} limit={5} searchLabel="Search branches" value={form.base} onChange={event => update({ base: event.target.value, targets: form.targets.filter(branch => branch !== event.target.value) })}>{branchChoices(info, form).map(branch => <option key={branch}>{branch}</option>)}</SearchSelect></div>}
      {info.git !== false && <TargetBranches form={form} update={update} branches={branchChoices(info, form)}/>}
    </div>}
  </section>;
}

const tabs = [
  { value: 'checks', label: 'Checks', icon: FlaskConical, count: form => checkIds(form).length, Panel: ChecksTab },
  { value: 'risk', label: 'Risk & tests', icon: FlaskConical, Panel: RiskTab },
  { value: 'shortcuts', label: 'Shortcuts', icon: SkipForward, count: form => form.scopes.length, Panel: ShortcutsTab },
  { value: 'rules', label: 'Agent rules', icon: ScrollText, count: form => form.instructions.length + form.protectedPaths.length, Panel: RulesTab },
  { value: 'linked', label: 'Linked', icon: Link2, count: form => form.linked.length, Panel: LinkedTab },
  { value: 'extras', label: 'Extras', icon: Plug, count: form => `${extrasOn(form)} on`, Panel: ExtrasTab },
  { value: 'notes', label: 'Notes', icon: Brain, Panel: NotesTab },
];

function RepositoryTabs({ id, state }) {
  const { form, update, info } = state;
  return <SettingsTabs label="Repository settings" tabs={tabs.map(({ count, Panel, ...tab }) => ({ ...tab, count: count?.(form), content: <Panel id={id} enabled={form.memory} form={form} update={update} info={info}/> }))}/>;
}

function SaveBar({ id, state }) {
  const { form, saved, busy, error, discard } = state, commands = newCommands(form, saved);
  if (!formChanged(form, saved) && !error) return null;
  return <div className="save-bar" role="region" aria-label="Unsaved changes">
    <div className="save-bar-text">{commands.length ? <><span className="save-warning">dispatch will run {commands.length === 1 ? 'this command' : 'these commands'} on your machine:</span> {commands.map(line => <code key={line}>{line}</code>)}</> : <span>Unsaved changes</span>}
      {error && <p className="error" role="alert">{error}</p>}</div>
    {id && <IconButton type="button" label="Discard changes" icon={Undo2} onClick={discard}/>}
    <IconButton type="submit" label="Save repository" icon={Check} variant="default" disabled={busy}/>
  </div>;
}

export function ProjectForm({ id }) {
  const { state, loaded } = useWorkspace(), project = state.projects.find(item => item.id === id), form = useProjectForm(id, project), [editing, setEditing] = useState(false);
  if (id && loaded && !project) return <SettingsLayout title="Repository not found"><Link href="/admin/projects">← Repositories</Link></SettingsLayout>;
  const heading = id ? { title: form.form.name || project?.name || 'Repository', description: <span className="repo-meta"><code className="break-all">{form.form.path}</code><RepositoryChip project={{ git: form.form.git, baseBranch: form.form.base }}/></span>, actions: <IconButton label="Edit name, branch and location" icon={Pencil} aria-pressed={editing} onClick={() => setEditing(!editing)}/> }
    : { title: 'Connect a repository', description: 'Pick a local folder. dispatch looks inside and suggests the rest.' };
  return <SettingsLayout {...heading}>
    <form onSubmit={event => { event.preventDefault(); if (form.info) form.save(); }} className="project-form">
      {(!id || editing) && <Basics state={form}/>}
      {form.info ? <><RepositoryTabs id={id} state={form}/><SaveBar id={id} state={form}/></> : form.error && <p className="error" role="alert">{form.error}</p>}
    </form>
  </SettingsLayout>;
}
