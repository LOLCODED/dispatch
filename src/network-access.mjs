import { InputError } from './engine.mjs';

const maxHosts = 30;
const hostPattern = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
export const noNetwork = { hosts: [], localPorts: false };

export function networkSettings(value) {
  if (value === undefined || value === null) return { ...noNetwork };
  if (typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['hosts', 'localPorts'].includes(key))) throw new InputError('Network access supports hosts and localPorts.');
  const hosts = value.hosts ?? [];
  if (!Array.isArray(hosts) || hosts.length > maxHosts || hosts.some(host => typeof host !== 'string' || !hostPattern.test(host.trim()))) throw new InputError(`Allow at most ${maxHosts} hosts, each a name like registry.npmjs.org or *.example.com.`);
  if (value.localPorts !== undefined && typeof value.localPorts !== 'boolean') throw new InputError('Local ports must be true or false.');
  return { hosts: [...new Set(hosts.map(host => host.trim().toLowerCase()))], localPorts: value.localPorts === true };
}

// A turn may reach what any repository in its task allows; the sandbox stays on and everything else stays blocked.
// A repository still saved gives its current list, so a host the operator adds mid-conversation reaches the next turn.
export function taskNetwork(run, saved = []) {
  const current = (id, copy) => saved.find(project => project.id === id) ?? copy;
  const settings = [current(run.projectId, run.project), ...(run.linked ?? []).map(member => current(member.projectId, member.project))].map(project => project?.network ?? noNetwork);
  return { hosts: [...new Set(settings.flatMap(item => item.hosts ?? []))], localPorts: settings.some(item => item.localPorts === true) };
}

