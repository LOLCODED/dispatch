import { SwitchRow } from '@/components/Switch';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/lib/workspace';

const maxLinked = 4;

function UrlVariable({ project, value, onChange }) {
  return <label className="linked-env">URL variable
    <Input className="mono-input" aria-label={`URL variable for ${project.name}`} placeholder="VITE_API_URL" value={value} onChange={event => onChange(event.target.value)}/>
    <small className="muted">Optional. In the live browser, {project.name}’s dev server starts first and this app gets its address in this variable.</small>
  </label>;
}

function changedTogether(suggestions = [], id) {
  return new Map(suggestions.filter(item => item.ids.includes(id)).map(item => [item.ids.find(other => other !== id), item.count]));
}

export function LinkedTab({ id, form, update }) {
  const { state } = useWorkspace(), together = changedTogether(state.linkSuggestions, id);
  const others = state.projects.filter(project => project.id !== id).sort((a, b) => (together.get(b.id) ?? 0) - (together.get(a.id) ?? 0));
  const toggle = (projectId, on) => update({ linked: on ? [...form.linked, projectId] : form.linked.filter(item => item !== projectId) });
  const setVariable = (projectId, name) => update({ linkedEnv: { ...form.linkedEnv, [projectId]: name } });
  return <section className="tab-section"><p className="muted">Tasks here can also change these repositories. A Git repository gets its own worktree, checks, pull request and landing; a plain folder is edited in place and checked there.</p>
    {others.length ? <ul className="row-list">{others.map(project => {
      const on = form.linked.includes(project.id);
      return <li key={project.id}>
        <SwitchRow label={project.name} description={<><code className="break-all">{project.repositoryPath}</code>{together.has(project.id) && !on && <span className="link-suggestion">Changed together in {together.get(project.id)} tasks; link it so tasks here bring it along.</span>}</>} checked={on} disabled={!on && form.linked.length >= maxLinked} onChange={next => toggle(project.id, next)}/>
        {on && form.browser && <UrlVariable project={project} value={form.linkedEnv[project.id] ?? ''} onChange={name => setVariable(project.id, name)}/>}
      </li>;
    })}</ul> : <p className="muted">Connect another repository to link it here.</p>}
  </section>;
}
