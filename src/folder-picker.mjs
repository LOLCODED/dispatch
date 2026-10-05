import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { InputError } from './engine.mjs';
import { localPath } from './folders.mjs';
import { onPath } from './open-path.mjs';

const title = 'Choose a repository folder';
// One POSIX path per line, so several folders can be added in one go.
const macMultiple = `set picked to choose folder with prompt "Choose repository folders" with multiple selections allowed\nset out to ""\nrepeat with item in picked\nset out to out & POSIX path of item & linefeed\nend repeat\nreturn out`;
const windowsScript = `Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = '${title}'; if ($dialog.ShowDialog() -eq 'OK') { $dialog.SelectedPath }`;
const linuxPickers = [
  { command: 'kdialog', args: start => ['--title', title, '--getexistingdirectory', start] },
  { command: 'zenity', args: start => ['--file-selection', '--directory', `--title=${title}`, `--filename=${start}/`] },
];
const cancelled = 1;
let pending = null;

function linuxPicker(env) {
  if (!env.DISPLAY && !env.WAYLAND_DISPLAY) throw new InputError('The dispatch server has no desktop session to show a folder dialog in. Type the path in Settings → Repositories instead.', 501);
  const pickers = /kde/i.test(env.XDG_CURRENT_DESKTOP ?? '') ? linuxPickers : linuxPickers.toReversed();
  const picker = pickers.find(item => onPath(item.command, { platform: 'linux', env }));
  if (!picker) throw new InputError('No folder dialog found. Install kdialog or zenity, or type the path in Settings → Repositories.', 501);
  return picker;
}

export function folderPickerCommand({ platform = process.platform, env = process.env, start = homedir(), multiple = false } = {}) {
  if (platform === 'darwin') return { command: 'osascript', args: ['-e', multiple ? macMultiple : `POSIX path of (choose folder with prompt "${title}")`] };
  if (platform === 'win32') return { command: 'powershell', args: ['-NoProfile', '-STA', '-Command', windowsScript] };
  const picker = linuxPicker(env);
  return { command: picker.command, args: picker.args(start) };
}

function runPicker(command, args, spawnProcess, multiple) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true });
    let output = '', errors = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { errors = (errors + chunk).slice(-2000); });
    child.once('error', error => reject(new InputError(error.code === 'ENOENT' ? `${command} is not installed or not on PATH.` : `${command} could not start: ${error.message}`)));
    child.once('close', code => {
      const paths = output.split('\n').map(line => line.trim()).filter(Boolean).map(localPath), path = paths[0] ?? null;
      if (code === 0) resolve(multiple ? { path, paths } : { path });
      else if (code === cancelled) resolve(multiple ? { path: null, paths: [] } : { path: null });
      else reject(new InputError(`The folder dialog failed: ${errors.trim().split('\n').at(-1) || `${command} exited with ${code}`}`));
    });
  });
}

export function pickFolder({ spawnProcess = spawn, ...options } = {}) {
  if (pending) throw new InputError('A folder dialog is already open.', 409);
  const { command, args } = folderPickerCommand(options);
  pending = runPicker(command, args, spawnProcess, options.multiple === true).finally(() => { pending = null; });
  return pending;
}
