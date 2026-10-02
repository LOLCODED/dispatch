import { runProcess } from './process.mjs';
import { createHash } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { join } from 'node:path';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function commandOnPath(command, { path = process.env.PATH ?? '', platform = process.platform, executable = file => { try { accessSync(file, constants.X_OK); return statSync(file).isFile(); } catch { return false; } } } = {}) {
  const names = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''].map(extension => command + extension) : [command];
  return path.split(platform === 'win32' ? ';' : ':').some(dir => dir && names.some(name => executable(join(dir, name))));
}
export function localEnvironment(extra = {}) {
  const env = {};
  for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'SHELL', 'CODEX_HOME', 'XDG_CONFIG_HOME']) if (process.env[name]) env[name] = process.env[name];
  return { ...env, ...extra };
}
export async function git(cwd, args, { gitDir, ...options } = {}, execute = runProcess) {
  const result = await execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...(gitDir ? ['--git-dir', gitDir] : []), ...args], { cwd, inheritEnv: false, env: localEnvironment({ GIT_TERMINAL_PROMPT: '0' }), ...options });
  if (result.exitCode !== 0 || result.timedOut || result.cancelled) throw Object.assign(new Error(`Git ${args[0]} failed: ${result.output.slice(-2000)}`), { result });
  return result.output.trimEnd();
}
export function plainText(value) {
  return String(value ?? '').replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity]).trim();
}
export const textTicket = input => ({ key: `text:${digest(input.trim())}`, title: input.trim().split('\n')[0].slice(0, 120), description: input.trim(), acceptance: '', sourceUrl: null });
