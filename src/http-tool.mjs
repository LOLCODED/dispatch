const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const maxBody = 24000, timeoutMs = 30000;

export const httpTool = {
  name: 'dispatch_http', kind: 'http',
  description: 'Send an HTTP request to this task’s app, outside the sandbox: app:/path for this worktree, app:<name>/path for a linked repository. dispatch starts the dev server and shows every request and response to the operator. Use it to exercise API changes.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['url'], properties: {
    method: { type: 'string', enum: methods }, url: { type: 'string', maxLength: 2000 },
    headers: { type: 'object', additionalProperties: { type: 'string', maxLength: 4000 } }, body: { type: 'string', maxLength: 100000 },
  } },
};

// Only the task's own dev servers are reachable: the URL must be app:, and the resolved address must stay on loopback.
export async function httpCall({ args, resolveUrl, signal, fetchImpl = fetch }) {
  if (!/^app:/i.test(String(args.url ?? ''))) throw new Error('Use app:/path or app:<name>/path; dispatch_http only reaches this task’s apps.');
  const target = new URL(await resolveUrl(args.url));
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) throw new Error('dispatch_http only reaches local dev servers.');
  const method = args.method ?? 'GET', started = Date.now();
  const response = await fetchImpl(target, { method, headers: args.headers ?? {}, body: ['GET', 'HEAD'].includes(method) ? undefined : args.body, redirect: 'manual', signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]) });
  const text = method === 'HEAD' ? '' : await response.text(), shown = text.length > maxBody ? `${text.slice(0, maxBody)}\n… ${text.length - maxBody} more characters` : text, durationMs = Date.now() - started;
  const headers = ['content-type', 'location', 'set-cookie'].map(name => response.headers.get(name) && `${name}: ${response.headers.get(name)}`).filter(Boolean).join('\n');
  const view = { type: 'http', request: { method, url: args.url, resolved: target.href, headers: args.headers ?? {}, body: args.body ?? '' }, response: { status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers), body: text } };
  return { content: [{ type: 'text', text: `${method} ${target.pathname}${target.search} → ${response.status} ${response.statusText} in ${durationMs} ms\n${headers}\n\n${shown}`.trim() }], isError: false, view };
}

