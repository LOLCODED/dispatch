import { runProcess } from './process.mjs';
import { createHash } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { join } from 'node:path';

export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function commandOnPath(command, { path = process.env.PATH ?? '', platform = process.platform, executable = file => { try { accessSync(file, constants.X_OK); return statSync(file).isFile(); } catch { return false; } } } = {}) {
  const names = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''].map(extension => command + extension) : [command];
  return path.split(platform === 'win32' ? ';' : ':').some(dir => dir && names.some(name => executable(join(dir, name))));
}
export function cliProblem(name, command, result, install) {
  if (/\bENOENT\b/.test(result.output)) return `${name} (${command}) is not on dispatch's PATH. ${install}`;
  const outcome = result.timedOut ? 'did not answer in time' : `exited with ${result.exitCode}`;
  const reason = result.output.trim().split('\n').map(line => line.trim()).filter(Boolean).at(-1)?.slice(0, 300);
  return `${command} --version ${outcome}${reason ? `: ${reason}` : ''}. Check that ${command} runs in your terminal, then refresh.`;
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
const namedEntities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const codePoint = number => Number.isInteger(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : '';
const decodeEntity = (match, name) => name[0] !== '#' ? namedEntities[name.toLowerCase()] ?? match : codePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
const linkText = (match, href, text) => { const label = text.replace(/<[^>]*>/g, '').trim(); return !href || label === href ? label || href : `${label} (${href})`; };

// Tracker fields are HTML; the agent reads bullets, inline code and link targets, so those survive as text.
export function plainText(value) {
  return String(value ?? '')
    .replace(/<a\b[^>]*?href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a\s*>/gi, linkText)
    .replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/?code\b[^>]*>/gi, '`')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|ul|ol|pre|blockquote)\s*>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '').replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, decodeEntity)
    .split('\n').map(line => line.trimEnd()).join('\n').replace(/\n{2,}(?=- )/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
export const textTicket = input => ({ key: `text:${digest(input.trim())}`, title: input.trim().split('\n')[0].slice(0, 120), description: input.trim(), acceptance: '', sourceUrl: null });
