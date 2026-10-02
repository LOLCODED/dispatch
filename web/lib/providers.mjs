export const providers = [
  { id: 'codex', name: 'Codex', setup: 'Uses the installed Codex CLI and its existing login. Sign in with codex login, then check connections.' },
  { id: 'claude', name: 'Claude Code', setup: 'Uses the installed Claude Code CLI and its existing login. Work runs inside Claude Code’s sandbox.' },
  { id: 'cursor', name: 'Cursor', setup: 'Uses the installed Cursor CLI (cursor-agent) and its existing login. Commands run inside Cursor’s sandbox; dispatch tools and questions are not available yet.' },
  { id: 'opencode', name: 'OpenCode', setup: 'Uses the installed OpenCode CLI with the models and logins you set up in it, hosted or local. It has no sandbox, so dispatch runs it only when Agent access is Full access.' },
  { id: 'pi', name: 'pi', setup: 'Uses the installed pi CLI with the models and logins you set up in it, hosted or local. It has no sandbox, so dispatch runs it only when Agent access is Full access.' },
  { id: 'local-models', name: 'Local models', setup: 'Runs models you host yourself (Ollama, LM Studio, llama.cpp, vLLM) on this machine or another, driven by an agent CLI you choose. Nothing is sent to a hosted service.' },
];

export const providerName = id => providers.find(provider => provider.id === id)?.name ?? 'Agent';

export const modelKey = model => model ? `${model.provider ?? 'codex'}:${model.model}` : '';

export function providerConnected(provider, catalog, settings) {
  return settings?.[provider.id] === true && Boolean(catalog?.models?.some(model => model.provider === provider.id));
}

export function canAddProvider(catalog, settings) {
  return providers.some(provider => !providerConnected(provider, catalog, settings));
}

export const agentName = run => providerName(run?.execution?.provider ?? run?.provider ?? 'codex');
