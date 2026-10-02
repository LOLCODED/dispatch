import { useMemo, useState } from 'react';
import { RepositoryMultiSelect } from '@/components/work/RepositoryMultiSelect';
import { FolderDropdown } from '@/components/work/FolderBar';
import { boardView, folderTree } from '@/lib/board.mjs';
import { suggestFolder } from '@/lib/folder-suggestion.mjs';
import { boardScopeKey } from '@/lib/board-actions';
import { preference } from '@/lib/workspace';

function folderPaths(folders) {
  const byId = new Map(folders.map(folder => [folder.id, folder]));
  const path = folder => { const names = [], seen = new Set(); for (let at = folder; at && !seen.has(at.id); at = byId.get(at.parentId)) { seen.add(at.id); names.unshift(at.name); } return names.join(' / '); };
  return folderTree(folders).map(({ folder }) => ({ id: folder.id, label: path(folder) }));
}

function filedTasks(state) {
  const runs = state.runs.filter(run => run.mode === 'live'), tasks = (state.tasks ?? []).filter(task => !task.runId);
  return Object.values(boardView({ runs, tasks, board: state.board })).flat().filter(entry => entry.item.folderId).map(entry => ({ title: entry.title, folderId: entry.item.folderId }));
}

// The board scope is a filter, so new work defaults to the folder the operator is looking at; otherwise the typed text suggests one.
export function useFolderTarget(state, input) {
  const [picked, setPicked] = useState(null), folders = state.board?.folders ?? [];
  const filed = useMemo(() => filedTasks(state), [state]);
  const scope = preference(boardScopeKey);
  const auto = folders.some(folder => folder.id === scope) ? scope : suggestFolder({ text: input, at: new Date().toISOString() }, folders, filed)?.folder.id ?? '';
  const folderId = picked !== null && (picked === '' || folders.some(folder => folder.id === picked)) ? picked : auto;
  return { folders, folderId, pick: setPicked, reset: () => setPicked(null) };
}

// A repository's saved links are the default companions of a task that starts there; the operator can untick them.
export function withLinked(id, projects) {
  const project = projects.find(item => item.id === id);
  return [id, ...(project?.linked ?? []).filter(linked => linked !== id && projects.some(item => item.id === linked))];
}

export function RepositoryPicker({ projects, value, disabled, onChange, onChooseFolder, onUsePath }) {
  return <><label className="sr-only" htmlFor="composer-repository">Repository</label><RepositoryMultiSelect projects={projects} value={value} disabled={disabled} onChange={onChange} onChooseFolder={onChooseFolder} onUsePath={onUsePath}/></>;
}

export function FolderPicker({ target, disabled }) {
  return <FolderDropdown composer folders={target.folders} value={target.folderId} disabled={disabled} emptyLabel="No folder" label={folderPaths(target.folders).find(folder => folder.id === target.folderId)?.label} onChange={value => target.pick(value ?? '')}/>;
}
