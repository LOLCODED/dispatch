import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

const folderCommands = { darwin: 'open', win32: 'explorer' };
export const openTargets = ['editor', 'folder'];
export const knownEditors = [
  { command: 'code', name: 'Visual Studio Code' },
  { command: 'cursor', name: 'Cursor' },
  { command: 'windsurf', name: 'Windsurf' },
  { command: 'zed', name: 'Zed' },
  { command: 'zeditor', name: 'Zed' },
  { command: 'codium', name: 'VSCodium' },
  { command: 'subl', name: 'Sublime Text' },
  { command: 'idea', name: 'IntelliJ IDEA' },
  { command: 'webstorm', name: 'WebStorm' },
  { command: 'kate', name: 'Kate' },
  { command: 'gnome-text-editor', name: 'GNOME Text Editor' },
  { command: 'gedit', name: 'gedit' },
];

function executable(file) {
  try { accessSync(file, constants.X_OK); return true; } catch { return false; }
}

export function onPath(command, { platform, env }) {
  const suffixes = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map(suffix => suffix.toLowerCase()) : [''];
  return (env.PATH ?? '').split(delimiter).filter(Boolean).some(dir => suffixes.some(suffix => executable(join(dir, command + suffix))));
}

export function installedEditors({ platform = process.platform, env = process.env } = {}) {
  return knownEditors.filter(editor => onPath(editor.command, { platform, env }));
}

export function editorCommand(editor, { platform = process.platform, env = process.env } = {}) {
  const override = env.DISPATCH_EDITOR?.trim();
  if (override) return override;
  const installed = installedEditors({ platform, env });
  if (editor) {
    if (!installed.some(item => item.command === editor)) throw new Error(`${editor} is not installed or not on PATH. Choose another editor in Settings → Editor.`);
    return editor;
  }
  return installed[0]?.command ?? 'code';
}

export function openCommand(target, path, { platform = process.platform, env = process.env, editor } = {}) {
  if (target === 'editor') return { command: editor || env.DISPATCH_EDITOR?.trim() || 'code', args: [path] };
  if (target === 'folder') return { command: folderCommands[platform] ?? 'xdg-open', args: [path] };
  throw new Error(`Open target must be one of ${openTargets.join(', ')}.`);
}

export function openPath(target, path, { spawnProcess = spawn, editor, ...options } = {}) {
  const { command, args } = openCommand(target, path, { ...options, editor: target === 'editor' ? editorCommand(editor, options) : undefined });
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { cwd: path, detached: true, stdio: 'ignore', shell: false });
    const hint = target === 'editor' ? ' Choose an installed editor in Settings → Editor.' : '';
    child.once('error', error => reject(new Error(error.code === 'ENOENT' ? `${command} is not installed or not on PATH.${hint}` : `${command} could not start: ${error.message}`)));
    child.once('spawn', () => { child.unref(); resolve({ command }); });
  });
}
