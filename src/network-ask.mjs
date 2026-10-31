const denial = /deny network-outbound ([a-z0-9.-]+\.[a-z]{2,})(?::(\d+))?/gi;
const webPorts = new Set([undefined, '80', '443']);
const maxHosts = 10;

export const networkActions = { allow: 'allow-network', keep: 'keep-network' };
export const retryWithHosts = 'The sandbox hosts the operator approved apply from this turn. Retry what the sandbox refused. If it still fails, the cause is outside the sandbox: do not change the network again; finish the change and list what the operator must do after DISPATCH_REMAINING.';

// Claude Code's sandbox refuses an unlisted host without asking anyone and reports it in the command's output. Only web
// requests go through its proxy, so a refused database or SSH port would stay refused however the host is listed.
export const deniedHosts = output => [...new Set([...String(output ?? '').matchAll(denial)].filter(match => webPorts.has(match[2])).map(match => match[1].toLowerCase()))];

export const mergeHosts = (known = [], more = []) => [...new Set([...known, ...more])].slice(0, maxHosts);

export const openNetworkAsk = run => ['ready', 'blocked'].includes(run?.status) && !run.supersededBy && Boolean(run.networkAsk?.hosts?.length) && !run.networkAsk.resolution;

export function networkQuestion(ask) {
  const hosts = ask.hosts.join(', '), one = ask.hosts.length === 1;
  return {
    question: `The sandbox blocked ${hosts} during this turn. Allow ${one ? 'it' : 'them'} for ${ask.repository} and continue?`,
    options: [
      { label: 'Allow and continue (Recommended)', description: `Adds ${hosts} to ${ask.repository}'s sandbox hosts and starts a turn that can reach ${one ? 'it' : 'them'}.`, action: networkActions.allow },
      { label: 'Keep blocked', description: 'Leave the sandbox as it is; the run stays where it stopped.', action: networkActions.keep },
    ],
  };
}

export const actionRequest = (runId, action) => [`/api/runs/${runId}/${Object.values(networkActions).includes(action) ? 'network' : 'remaining'}`, { action }];
