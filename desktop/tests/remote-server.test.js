const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { RemoteServer, localAddress } = require('../src/main/remote-server');

async function fixture(t, overrides = {}) {
  let now = 1000000;
  const commands = [];
  const remote = new RemoteServer({ name: 'Test computer', now: () => now,
    getState: () => ({ title: '한국어 영상', hasMedia: true, playing: false, currentTime: 3, duration: 12, volume: 1 }),
    command: async value => { commands.push(value); }, ...overrides });
  assert.equal(remote.info().enabled, false);
  const info = await remote.start('192.168.0.5');
  t.after(() => remote.stop());
  const base = `http://127.0.0.1:${remote.port}`;
  async function request(route, method = 'GET', data, token, headers = {}) {
    return new Promise((resolve, reject) => {
      const request = http.request(base + route, { method, headers: { ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } }, response => {
        let text = ''; response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(text) }));
      });
      request.on('error', reject); request.end(data !== undefined ? JSON.stringify(data) : undefined);
    });
  }
  const pair = () => request('/api/pair', 'POST', { code: remote.info().code });
  return { remote, info, base, request, pair, commands, advance: ms => { now += ms; } };
}

test('remote remains opt-in; pair authorizes read and control; tokens and code revoke', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/state')).status, 401);
  assert.equal((await f.request('/api/command', 'POST', { command: 'play' })).status, 401);
  const paired = await f.pair(); assert.equal(paired.status, 200);
  const token = paired.data.token; assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal((await f.request('/api/pair', 'POST', { code: f.info.code })).status, 401, 'one-time code');
  const state = await f.request('/api/state', 'GET', undefined, token);
  assert.equal(state.data.title, '한국어 영상'); assert.equal(state.data.protocolVersion, 1);
  assert.equal((await f.request('/api/command', 'POST', { command: 'pause' }, token)).status, 200);
  assert.deepEqual(f.commands, [{ command: 'pause' }]);
  assert.equal((await f.request('/api/session', 'DELETE', undefined, token)).status, 200);
  assert.equal((await f.request('/api/state', 'GET', undefined, token)).status, 401);
});

test('remote rejects cross-site requests and rebinding host before issuing credentials', async t => {
  const f = await fixture(t);
  for (const headers of [{ Origin: 'https://untrusted.test' }, { Host: `untrusted.test:${f.remote.port}` }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await f.request('/api/pair', 'POST', { code: f.info.code }, null, headers)).status, 403);
  }
  assert.equal((await f.pair()).status, 200);
});

test('codes expire at 2 minutes, rate limiting spans clients, tokens expire at 8 hours', async t => {
  const f = await fixture(t);
  f.advance(120000); assert.equal((await f.pair()).status, 401);
  f.remote.renewCode();
  for (let i = 0; i < 4; i++) assert.equal((await f.request('/api/pair', 'POST', { code: 'xxxxxx' })).status, 401);
  assert.equal((await f.pair()).status, 429);
  f.advance(60001); const token = (await f.pair()).data.token;
  f.advance(8 * 3600000 + 1);
  assert.equal((await f.request('/api/state', 'GET', undefined, token)).status, 401);
});

test('only constrained media controls are accepted, never arbitrary paths or execution', async t => {
  const f = await fixture(t); const token = (await f.pair()).data.token;
  for (const body of [{ command: 'open', path: '/etc/passwd' }, { command: 'exec', value: 'ls' }, { command: 'volume', value: 1.1 },
    { command: 'seek', value: -5 }, { command: 'seek', value: '20' }, { command: 'subtitle', trackId: {} }, { command: 'cast-connect', deviceId: '' }, null]) {
    assert.equal((await f.request('/api/command', 'POST', body, token)).status, 400);
  }
  assert.equal((await f.request('/api/command', 'POST', { command: 'subtitle', trackId: null }, token)).status, 200);
});

test('long operations return acceptance, expose failure, allow cancel, and do not clear newer busy state', async t => {
  const operations = [];
  const f = await fixture(t, { command: value => new Promise((resolve, reject) => operations.push({ resolve, reject, value })) });
  const token = (await f.pair()).data.token;
  assert.equal((await f.request('/api/command', 'POST', { command: 'cast-connect', deviceId: 'tv' }, token)).status, 202);
  assert.equal((await f.request('/api/state', 'GET', undefined, token)).data.preparing, true);
  assert.equal((await f.request('/api/command', 'POST', { command: 'play' }, token)).status, 409);
  const cancel = f.request('/api/command', 'POST', { command: 'cast-stop' }, token);
  while (operations.length < 2) await new Promise(r => setImmediate(r));
  operations[0].reject(new Error('cancelled'));
  await new Promise(r => setImmediate(r)); assert.equal(f.remote.busy, true);
  operations[1].resolve(); assert.equal((await cancel).status, 200);
  await f.request('/api/command', 'POST', { command: 'seek', value: 20 }, token);
  operations[2].reject(new Error('변환 실패')); await new Promise(r => setImmediate(r));
  assert.equal((await f.request('/api/state', 'GET', undefined, token)).data.lastError, '변환 실패');
});

test('closing and reopening requires fresh pairing and never revives old tokens', async t => {
  const f = await fixture(t); const token = (await f.pair()).data.token;
  f.remote.stop(); assert.equal(f.remote.info().enabled, false);
  await f.remote.start('192.168.0.5');
  const response = await fetch(`http://127.0.0.1:${f.remote.port}/api/state`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 401);
});

test('stopping while listening starts settles callers and permits a clean restart', async t => {
  const remote = new RemoteServer({ getState: () => ({}), command: async () => {} });
  t.after(() => remote.stop());
  const starting = remote.start('192.168.0.5');
  const rejected = assert.rejects(starting, /취소/);
  remote.stop(); await rejected;
  const [one, two] = await Promise.all([remote.start('192.168.0.5'), remote.start('192.168.0.5')]);
  assert.equal(one.url, two.url); assert.match(one.code, /^\d{6}$/);
});

test('expired clients do not exhaust the pairing limit', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 8; index++) {
    f.remote.renewCode(); assert.equal((await f.pair()).status, 200); f.advance(60001);
  }
  assert.equal(f.remote.tokens.size, 8);
  f.advance(8 * 3600000); f.remote.renewCode();
  assert.equal((await f.pair()).status, 200); assert.equal(f.remote.tokens.size, 1);
});

test('serves only fixed remote assets with restrictive CSP and no cache', async t => {
  const f = await fixture(t);
  const page = await fetch(f.base);
  assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(await page.text(), /컴퓨터 리모컨/);
  assert.equal((await fetch(f.base + '/../../package.json')).status, 401);
});

test('LAN address filtering excludes public, link-local, malformed and IPv6 input', () => {
  for (const ip of ['10.0.0.1', '192.168.1.2', '172.16.0.1', '172.31.255.254', '127.0.0.1', '::ffff:192.168.1.2']) assert.equal(localAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '192.169.0.1', '169.254.1.1', '::1', '192.168.999.1', 'example.com']) assert.equal(localAddress(ip), false, ip);
});
