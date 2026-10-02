import { lstatSync, rmdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Claude Code's Linux sandbox (bubblewrap) protects these paths by bind-mounting /dev/null over them,
// and leaves an empty file behind in the worktree wherever the path did not exist yet.
const claudeDirectory = ['agents', 'commands', 'hooks', 'launch.json', 'loop.md', 'output-styles', 'routines', 'scheduled_tasks.json', 'settings.json', 'settings.local.json', 'skills', 'workflows'].map(name => `.claude/${name}`);
export const sandboxPaths = ['.bash_profile', '.bashrc', '.gitconfig', '.gitmodules', '.idea', '.mcp.json', '.profile', '.ripgreprc', '.vscode', '.zprofile', '.zshrc', ...claudeDirectory];

const emptyFile = path => { try { const stat = lstatSync(path); return stat.isFile() && stat.size === 0; } catch { return false; } };

export async function sandboxPlaceholders(workspace, git, options = {}) {
  const candidates = sandboxPaths.filter(path => emptyFile(join(workspace, path)));
  if (!candidates.length) return [];
  const tracked = new Set((await git(['ls-files', '-z', '--', ...candidates.map(path => `:(literal)${path}`)], options)).split('\0').filter(Boolean));
  return candidates.filter(path => !tracked.has(path));
}

export async function removeSandboxPlaceholders(workspace, git, options = {}) {
  const placeholders = await sandboxPlaceholders(workspace, git, options);
  for (const path of placeholders) rmSync(join(workspace, path), { force: true });
  if (placeholders.some(path => path.startsWith('.claude/'))) { try { rmdirSync(join(workspace, '.claude')); } catch {} }
  return placeholders;
}

export const excludePlaceholders = placeholders => placeholders.map(path => `:(exclude,literal)${path}`);
