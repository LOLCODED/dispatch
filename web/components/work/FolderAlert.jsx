import { useState } from 'react';
import { FolderInput, Folders, X } from 'lucide-react';
import { IconButton } from '@/components/IconButton';
import { useAction } from '@/lib/use-action';
import { api, preference, savePreference } from '@/lib/workspace';

const dismissalKey = 'dispatch-folder-alert-dismissed-until', minimum = 3;

export function FolderAlert({ suggestions }) {
  const [dismissedUntil, setDismissedUntil] = useState(() => Number(preference(dismissalKey, '0'))), { busy, error, perform } = useAction();
  if (suggestions.length < minimum || dismissedUntil > Date.now()) return null;
  const dismiss = () => {
    const until = Date.now() + 24 * 60 * 60 * 1000;
    savePreference(dismissalKey, String(until)); setDismissedUntil(until);
  };
  const moveAll = () => perform(async () => {
    for (const { entry, folder } of suggestions) await api(`/api/board/items/${entry.key}`, { folderId: folder.id });
    window.dispatchEvent(new Event('dispatch-refresh'));
  });
  return <aside className="folder-alert" aria-label="Folder suggestions">
    <Folders size={14} aria-hidden="true"/>
    <span>{suggestions.length} unfiled tasks have a suggested folder</span>
    <IconButton label={`Move all ${suggestions.length} to their suggested folders`} icon={FolderInput} size="icon-xs" disabled={busy} onClick={moveAll}/>
    <IconButton label="Remind me tomorrow" icon={X} size="icon-xs" onClick={dismiss}/>
    {error && <p className="error" role="alert">{error}</p>}
  </aside>;
}
