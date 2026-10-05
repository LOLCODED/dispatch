export const backendKinds = { dispatch_http: 'http', dispatch_service: 'logs', dispatch_sql: 'sql', dispatch_ci: 'ci' };
export const backendFilters = [['http', 'HTTP'], ['logs', 'Logs'], ['sql', 'SQL'], ['ci', 'CI']];

export const isBackendCall = step => step.kind === 'tool.call' && Object.hasOwn(backendKinds, step.name);

const firstLine = text => String(text ?? '').trim().split('\n')[0].slice(0, 160);
const titles = {
  http: input => `${input.method ?? 'GET'} ${input.url ?? ''}`,
  logs: input => [input.action, input.service].filter(Boolean).join(' '),
  sql: input => firstLine(input.query),
  ci: input => `${input.action ?? 'status'} ${input.target ?? 'branch'}`,
};

// Pairs each backend tool call with its result, oldest first; a call without a result yet is still running.
export function backendEntries(steps) {
  const results = new Map(steps.filter(step => step.kind === 'tool.result').map(step => [step.callId, step]));
  return steps.filter(isBackendCall).map(call => {
    const kind = backendKinds[call.name], result = results.get(call.callId);
    return { id: call.id, kind, at: call.at, title: titles[kind](call.input ?? {}), output: result?.output ?? null, isError: result?.isError === true, durationMs: result?.durationMs ?? null, pending: !result };
  });
}
