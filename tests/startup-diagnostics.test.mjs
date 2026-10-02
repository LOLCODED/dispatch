import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeVersionProblem } from '../src/node-version.mjs';
import { cliProblem } from '../src/local-tools.mjs';
import { pathHint } from '../bin/install.mjs';
import { CodexAdapter } from '../src/codex.mjs';
import { ClaudeAdapter } from '../src/claude.mjs';

test('an outdated Node.js is named with the required range', () => {
  assert.equal(nodeVersionProblem('24.0.0', '>=24'), null);
  assert.equal(nodeVersionProblem('25.1.0', '>=24'), null);
  assert.match(nodeVersionProblem('20.11.1', '>=24'), /needs Node\.js >=24, but this is Node\.js 20\.11\.1/);
});

test('a CLI probe failure says whether the command is missing or what it printed', () => {
  assert.match(cliProblem('Codex CLI', 'codex', { exitCode: -2, output: 'spawn codex ENOENT' }, 'Install it, then refresh.'), /^Codex CLI \(codex\) is not on dispatch's PATH\. Install it/);
  const failed = cliProblem('Codex CLI', 'codex', { exitCode: 1, output: 'at Module._compile\nSyntaxError: Unexpected token\n\n' }, 'Install it.');
  assert.equal(failed, 'codex --version exited with 1: SyntaxError: Unexpected token. Check that codex runs in your terminal, then refresh.');
  assert.match(cliProblem('pi', 'pi', { exitCode: null, timedOut: true, output: '' }, ''), /^pi --version did not answer in time\. /);
});

test('adapters report the probe failure and treat a missing login as available', async () => {
  const codex = new CodexAdapter({ execute: async () => ({ exitCode: 1, output: 'Error: Cannot find module @openai/codex' }) });
  assert.match((await codex.capabilities()).detail, /exited with 1: Error: Cannot find module @openai\/codex/);
  const claude = new ClaudeAdapter({ execute: async (command, args) => args[0] === '--version' ? { exitCode: 0, output: '2.0.0' } : { exitCode: 1, output: 'Not logged in' } });
  assert.deepEqual(await claude.capabilities(), { available: true, authenticated: false, version: '2.0.0', detail: 'Run claude auth login in your terminal, then refresh.' });
  assert.equal(await new ClaudeAdapter({ execute: async () => ({ exitCode: -2, output: 'spawn claude ENOENT' }) }).version(), null);
});

test('install explains how to reach the dispatch command when its folder is not on PATH', () => {
  assert.equal(pathHint('/home/a/.local/bin/dispatch', '/usr/bin:/home/a/.local/bin'), '');
  assert.match(pathHint('/Users/a/.local/bin/dispatch', '/usr/bin:/bin'), /export PATH="\/Users\/a\/\.local\/bin:\$PATH"/);
});
