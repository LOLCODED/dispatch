import { useEffect, useState } from 'react';
import { api, navigate } from '@/lib/workspace';
import { useAction } from '@/lib/use-action';
import { blankForm, formFromInspect, formFromProject, projectPayload } from '@/lib/project-form.mjs';

export function useProjectForm(id, project) {
  const [form, setForm] = useState(() => blankForm(new URLSearchParams(location.search).get('path') ?? '')), [saved, setSaved] = useState(null), [info, setInfo] = useState(null);
  const { busy, error, setError, perform } = useAction();
  const update = changes => setForm(current => ({ ...current, ...changes }));
  useEffect(() => {
    if (!project) return;
    const initial = formFromProject(project);
    setForm(initial); setSaved(initial);
    const controller = new AbortController();
    api('/api/projects/inspect', { repositoryPath: project.repositoryPath }, controller.signal).then(setInfo).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [id, project?.id]);
  const inspect = (path = form.path) => perform(async () => {
    const data = await api('/api/projects/inspect', { repositoryPath: path });
    setInfo(data);
    setForm(current => id ? { ...current, path: data.repositoryPath, base: data.branches.includes(current.base) ? current.base : data.baseBranch } : formFromInspect(data));
  });
  const save = () => perform(async () => {
    const result = await api(`/api/projects${id ? '/' + id : ''}`, projectPayload(form, info.repositoryPath));
    window.dispatchEvent(new Event('dispatch-refresh'));
    if (!id) return navigate('/');
    const next = formFromProject(result);
    setForm(next); setSaved(next);
  });
  const changePath = path => { update({ path }); setInfo(null); };
  return { form, update, info, saved, busy, error, inspect, save, changePath, discard: () => setForm(saved) };
}
