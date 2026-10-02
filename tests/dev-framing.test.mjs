import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.mjs';
import { liveFixture } from './live-double.mjs';

function request(server, headers = {}) {
  return new Promise(resolve => {
    const result = { headers: {} };
    const res = {
      socket: { localPort: 4327 },
      setHeader: (name, value) => { result.headers[name.toLowerCase()] = value; },
      writeHead: status => { result.status = status; },
      end: () => resolve(result),
    };
    server.emit('request', { method: 'GET', url: '/api/state', headers: { host: '127.0.0.1:4327', ...headers } }, res);
  });
}

test('only development previews permit loopback frame ancestors', async t => {
  const { engine } = await liveFixture(t);
  for (const devFraming of [false, true]) {
    const server = createServer(engine, { devFraming });
    const response = await request(server);
    assert.equal(response.status, 200);
    const policy = response.headers['content-security-policy'];
    const ancestors = policy.split(';').find(part => part.trim().startsWith('frame-ancestors')).trim();
    assert.equal(ancestors, devFraming ? "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*" : "frame-ancestors 'self'");
    assert.match(policy, /frame-src http:\/\/127\.0\.0\.1:\*/);
    assert.equal((await request(server, { origin: 'https://foreign.example' })).status, 403);
    assert.equal((await request(server, { host: 'foreign.example' })).status, 403);
  }
});
